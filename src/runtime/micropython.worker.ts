/// <reference lib="webworker" />

import {
  MICROPYTHON_BUILD_VARIANT,
  MICROPYTHON_SOURCE_COMMIT,
  MICROPYTHON_SOURCE_VERSION,
  loadMicroPython,
  type MicroPythonInstance,
} from "../vendor/micropython";
import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { ConnectedDeviceRuntime } from "../connections/connected-device-runtime";
import { resolveConnectionGraph } from "../connections/connection-model";
import {
  MANAGED_PICO_2_W_PRESET_ID,
  createConnectionPreset,
  mergeConnectionGraphs,
} from "../connections/connection-presets";
import { DeviceHost } from "../device-api/device-host";
import type { UartPeerPort } from "../device-api/types";
import { createMachineModule } from "../simulation/machine-module";
import {
  connectSharedUartInput,
  synchronizeI2cTargetPort,
  synchronizeUartPeer,
} from "../simulation/device-port-adapters";
import {
  ANALOG_VALUE_INPUT_ID,
  BME280_HUMIDITY_INPUT_ID,
  BME280_PRESSURE_INPUT_ID,
  BME280_TEMPERATURE_INPUT_ID,
  BUTTON_PRESSED_INPUT_ID,
  GT_502MGG_ALTITUDE_CM_INPUT_ID,
  GT_502MGG_GENERATE_INPUT_ID,
  GT_502MGG_LATITUDE_E7_INPUT_ID,
  GT_502MGG_LONGITUDE_E7_INPUT_ID,
  SharedDeviceInputs,
  UART_RECEIVE_INPUT_ID,
  type SharedDeviceInputTransfer,
} from "../simulation/shared-device-inputs";
import { VirtualGpioBoard } from "../simulation/virtual-gpio";
import { VirtualI2cBus } from "../simulation/virtual-i2c";
import {
  MAX_SCRIPT_CHARACTERS,
  RUNTIME_PROTOCOL_VERSION,
  isWorkerToMainMessage,
  type DebuggerVariable,
  type MainToWorkerMessage,
  type WorkerToMainMessage,
} from "./protocol";
import { SharedDebuggerChannel, type DebuggerChannelTransfer } from "./debugger-channel";
import { WEB_LAB_PDB_SOURCE } from "./pdb-module";
import { RuntimeOutputBuffer } from "./output-buffer";
import { processReplInput } from "./repl-input";
import { recoverReplFromBridgeError } from "./repl-bridge-error";
import type { ConnectionGraphV1 } from "../connections/connection-model";
import { localDeviceBundle } from "virtual:local-device";

declare const self: DedicatedWorkerGlobalScope;

let micropython: MicroPythonInstance | null = null;
let activeDeviceHost: DeviceHost | null = null;
let debuggerChannel: SharedDebuggerChannel | null = null;
let activeDebuggerRequestId: string | null = null;
let starting = false;
const output = new RuntimeOutputBuffer(
  (type, data) => self.postMessage({ version: RUNTIME_PROTOCOL_VERSION, type, data }),
  () => postMessageToMain({ version: RUNTIME_PROTOCOL_VERSION, type: "output-limit" }),
);

self.addEventListener("message", (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data;

  if (message.version !== RUNTIME_PROTOCOL_VERSION) {
    postError(`未対応のプロトコルバージョンです: ${String(message.version)}`);
    return;
  }

  switch (message.type) {
    case "start":
      void startRuntime(message.deviceInputs, message.debuggerChannel, message.connectionGraph);
      break;
    case "input":
      processInput(message.data);
      break;
    case "execute":
      processScript(message.requestId, message.source, message.mode);
      break;
    default:
      postError("未対応のWorkerメッセージです。");
  }
});

async function startRuntime(
  deviceInputs?: SharedDeviceInputTransfer,
  debuggerChannelTransfer?: DebuggerChannelTransfer,
  requestedConnectionGraph?: ConnectionGraphV1,
): Promise<void> {
  if (micropython !== null || starting) {
    postError("MicroPythonランタイムは既に起動しています。");
    return;
  }

  starting = true;
  try {
    const sharedInputs =
      deviceInputs === undefined
        ? null
        : SharedDeviceInputs.attach(deviceInputs.buffer, deviceInputs.layout);
    debuggerChannel =
      debuggerChannelTransfer === undefined
        ? null
        : SharedDebuggerChannel.attach(debuggerChannelTransfer);
    const boardProfile = RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
    const deviceHost = new DeviceHost(
      {
        profileId: boardProfile.id,
        profileVersion: boardProfile.version,
        capabilities: boardProfile.capabilities,
      },
      (event) => {
        postMessageToMain({
          version: RUNTIME_PROTOCOL_VERSION,
          type: "device-model-state",
          event,
        });
      },
    );
    const preset = createConnectionPreset(
      localDeviceBundle?.basePreset ?? MANAGED_PICO_2_W_PRESET_ID,
    );
    if (localDeviceBundle !== null && requestedConnectionGraph !== undefined) {
      throw new Error("ブラウザ保存の配線とローカルDevice構成は同時に使用できません。");
    }
    const definitions = new Map(preset.definitions);
    for (const localDevice of localDeviceBundle?.devices ?? []) {
      if (definitions.has(localDevice.instanceId)) {
        throw new Error(`Device instance ${localDevice.instanceId} already exists in the base preset.`);
      }
      definitions.set(localDevice.instanceId, localDevice.definition);
    }
    const connectionGraph = requestedConnectionGraph ??
      (localDeviceBundle === null
        ? preset.graph
        : mergeConnectionGraphs(preset.graph, localDeviceBundle.connectionGraph));
    const resolvedConnections = resolveConnectionGraph(
      connectionGraph,
      boardProfile,
      definitions,
    );
    try {
      for (const [instanceId, definition] of definitions) {
        deviceHost.create(instanceId, definition);
      }
    } catch (error) {
      try {
        deviceHost.disposeAll();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Device configuration failed to create and dispose.",
        );
      }
      throw error;
    }
    activeDeviceHost = deviceHost;
    const connectedDevices = new ConnectedDeviceRuntime(deviceHost, resolvedConnections);
    const buttonPinId = connectedDevices.gpioPinIdOrNull("button-gp15", "input");
    const analogPinId = connectedDevices.adcPinIdOrNull("analog-gp26", "input");
    const uartPort = connectedDevices.uartPeer(0) ?? DISCONNECTED_UART_PEER;
    let gpsGenerateVersion =
      sharedInputs?.readScalar(GT_502MGG_GENERATE_INPUT_ID).version ?? 0;
    const synchronizeGpsInput = (): void => {
      if (sharedInputs === null || !connectedDevices.hasConnection("gt-502mgg-n", "uart")) {
        return;
      }
      const generation = sharedInputs.readScalar(GT_502MGG_GENERATE_INPUT_ID);
      if (generation.version === gpsGenerateVersion) {
        return;
      }
      const latitude = sharedInputs.readScalar(GT_502MGG_LATITUDE_E7_INPUT_ID).value / 10_000_000;
      const longitude =
        sharedInputs.readScalar(GT_502MGG_LONGITUDE_E7_INPUT_ID).value / 10_000_000;
      const altitude = sharedInputs.readScalar(GT_502MGG_ALTITUDE_CM_INPUT_ID).value / 100;
      deviceHost.handleAction("gt-502mgg-n", {
        controlId: "position",
        value: `${latitude},${longitude},${altitude}`,
      });
      gpsGenerateVersion = generation.version;
    };
    const modeledUartPort = connectedDevices.hasConnection("gt-502mgg-n", "uart")
      ? synchronizeUartPeer(uartPort, synchronizeGpsInput)
      : uartPort;
    const synchronizedUartPort =
      connectedDevices.hasConnection("gt-502mgg-n", "uart") ||
      connectedDevices.hasConnection("uart-echo-0", "uart")
        ? connectSharedUartInput(modeledUartPort, sharedInputs, UART_RECEIVE_INPUT_ID)
        : modeledUartPort;
    let buttonInputVersion = 0;
    let analogInputVersion = 0;
    const virtualBoard = new VirtualGpioBoard(
      (state) => {
        postMessageToMain({
          version: RUNTIME_PROTOCOL_VERSION,
          type: "device-state",
          state,
        });
      },
      (pinId) => {
        if (pinId === buttonPinId && sharedInputs !== null) {
          const snapshot = sharedInputs.readScalar(BUTTON_PRESSED_INPUT_ID);
          if (snapshot.version !== buttonInputVersion) {
            deviceHost.handleAction("button-gp15", {
              controlId: "pressed",
              value: snapshot.value === 1,
            });
            buttonInputVersion = snapshot.version;
          }
        }
        return connectedDevices.readGpio(pinId);
      },
      (pinId) => {
        if (pinId === analogPinId && sharedInputs !== null) {
          const snapshot = sharedInputs.readScalar(ANALOG_VALUE_INPUT_ID);
          if (snapshot.version !== analogInputVersion) {
            deviceHost.handleAction("analog-gp26", {
              controlId: "value",
              value: snapshot.value,
            });
            analogInputVersion = snapshot.version;
          }
        }
        return connectedDevices.readAdc(pinId);
      },
      (pinId, value) => {
        connectedDevices.writeGpio(pinId, value);
      },
    );
    const routedSpiTarget = connectedDevices.createSpiTarget(0);
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();

    micropython = await loadMicroPython({
      heapsize: 1024 * 1024,
      linebuffer: false,
      stdout: (bytes) => {
        if (!output.exhausted) {
          postOutput("stdout", stdoutDecoder.decode(bytes, { stream: true }));
        }
      },
      stderr: (bytes) => {
        if (!output.exhausted) {
          postOutput("stderr", stderrDecoder.decode(bytes, { stream: true }));
        }
      },
    });

    const builtins = micropython.pyimport<{
      bytes(source: unknown): unknown;
      list(source: unknown): unknown;
    }>("builtins");
    const virtualI2cBus = new VirtualI2cBus(0, (state) => {
      postMessageToMain({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-state",
        state,
      });
    });
    const bme280InputVersions = new Map<string, number>();
    const synchronizeBme280Inputs = (): void => {
      if (sharedInputs === null) {
        return;
      }
      for (const [inputId, controlId] of [
        [BME280_TEMPERATURE_INPUT_ID, "temperatureC"],
        [BME280_HUMIDITY_INPUT_ID, "humidityPercent"],
        [BME280_PRESSURE_INPUT_ID, "pressureHpa"],
      ] as const) {
        const snapshot = sharedInputs.readScalar(inputId);
        if (snapshot.version === bme280InputVersions.get(inputId)) {
          continue;
        }
        deviceHost.handleAction("ae-bme280-0x76", {
          controlId,
          value: snapshot.value,
        });
        bme280InputVersions.set(inputId, snapshot.version);
      }
    };
    connectedDevices.attachI2cBus(
      virtualI2cBus,
      (connection, port) =>
        connection.instanceId === "ae-bme280-0x76"
          ? synchronizeI2cTargetPort(port, synchronizeBme280Inputs)
          : port,
    );
    micropython.registerJsModule(
      "machine",
      createMachineModule(virtualBoard, {
        boardProfile,
        i2cBus: virtualI2cBus,
        spiTarget: routedSpiTarget,
        uartPeer: synchronizedUartPort,
        pwmObserver: (pinId) => connectedDevices.pwmObserver(pinId),
        toPythonBytes: (bytes) => builtins.bytes([...bytes]),
        toPythonList: (values) => builtins.list([...values]),
      }),
    );
    installMachineBufferAdapters(micropython);
    installDebugger(micropython);

    const sys = micropython.pyimport<{ version: unknown }>("sys");
    const version = String(sys.version);
    micropython.replInit();
    postMessageToMain({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "ready",
      micropythonVersion: version,
      runtimeBuild: {
        sourceVersion: MICROPYTHON_SOURCE_VERSION,
        sourceCommit: MICROPYTHON_SOURCE_COMMIT,
        variant: MICROPYTHON_BUILD_VARIANT,
      },
    });
  } catch (error) {
    if (activeDeviceHost !== null) {
      try {
        activeDeviceHost.disposeAll();
      } catch {
        // The original startup error is more useful to the local developer.
      }
      activeDeviceHost = null;
    }
    micropython = null;
    debuggerChannel = null;
    activeDebuggerRequestId = null;
    postError(formatError(error));
  } finally {
    starting = false;
  }
}

function processInput(data: string): void {
  if (micropython === null) {
    postError("MicroPythonランタイムはまだ起動していません。");
    return;
  }

  output.beginOperation();
  try {
    processReplInput(
      micropython,
      data,
      () => postMessageToMain({ version: RUNTIME_PROTOCOL_VERSION, type: "repl-reset" }),
      () => postMessageToMain({ version: RUNTIME_PROTOCOL_VERSION, type: "repl-executing" }),
    );
  } catch (error) {
    try {
      recoverReplFromBridgeError(micropython, error, (data) => postOutput("stderr", data));
    } catch (recoveryError) {
      postError(`REPL recovery failed: ${formatError(recoveryError)}`);
    }
  } finally {
    output.flush();
  }
}

const DISCONNECTED_UART_PEER: UartPeerPort = Object.freeze({
  kind: "uart-peer" as const,
  configure(): void {},
  writeFromBoard(data: Uint8Array): number {
    return data.length;
  },
  availableToBoard(): number {
    return 0;
  },
  readForBoard(): Uint8Array {
    return new Uint8Array();
  },
});

function processScript(
  requestId: string,
  source: string,
  mode: "run" | "debug",
): void {
  if (micropython === null) {
    postError("MicroPythonランタイムはまだ起動していません。");
    return;
  }

  if (source.length > MAX_SCRIPT_CHARACTERS) {
    postExecutionResult(
      requestId,
      false,
      `ソースコードは${MAX_SCRIPT_CHARACTERS}文字以内にしてください。`,
    );
    return;
  }

  output.beginOperation();
  try {
    if (mode === "debug") {
      if (debuggerChannel === null) {
        throw new Error("デバッグ実行にはクロスオリジン分離が必要です。");
      }
      activeDebuggerRequestId = requestId;
      const pdb = micropython.pyimport<{ _run(source: string): unknown }>("pdb");
      pdb._run(source);
    } else {
      micropython.runPython(source);
    }
    postExecutionResult(requestId, true);
  } catch (error) {
    postExecutionResult(requestId, false, formatError(error));
  } finally {
    activeDebuggerRequestId = null;
  }
}

function installDebugger(runtime: MicroPythonInstance): void {
  runtime.registerJsModule("_web_lab_debugger", {
    read_command(
      filename: unknown,
      line: unknown,
      functionName: unknown,
      globalsJson: unknown,
      announcePause: unknown,
    ): string {
      if (debuggerChannel === null || activeDebuggerRequestId === null) {
        throw new Error("Debugger command channel is unavailable.");
      }
      return debuggerChannel.waitForCommand(() => {
        if (Boolean(announcePause)) {
          postMessageToMain({
            version: RUNTIME_PROTOCOL_VERSION,
            type: "debugger-paused",
            requestId: activeDebuggerRequestId!,
            filename: String(filename),
            line: Number(line),
            functionName: String(functionName),
            globals: parseDebuggerVariables(globalsJson),
          });
        }
      });
    },
    resumed(): void {
      if (activeDebuggerRequestId === null) {
        throw new Error("No debugger execution is active.");
      }
      postMessageToMain({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "debugger-resumed",
        requestId: activeDebuggerRequestId,
      });
    },
  });
  runtime.runPython(WEB_LAB_PDB_SOURCE);
}

function parseDebuggerVariables(value: unknown): readonly DebuggerVariable[] {
  if (typeof value !== "string") {
    throw new TypeError("Debugger globals must be encoded as JSON.");
  }
  const parsed: unknown = JSON.parse(value);
  const candidate = {
    version: RUNTIME_PROTOCOL_VERSION,
    type: "debugger-paused" as const,
    requestId: "validation",
    filename: "main.py",
    line: 1,
    functionName: "<module>",
    globals: parsed,
  };
  if (!isWorkerToMainMessage(candidate) || candidate.type !== "debugger-paused") {
    throw new TypeError("Debugger globals have an invalid format.");
  }
  return candidate.globals;
}

function postOutput(type: "stdout" | "stderr", data: string): void {
  output.write(type, data);
}

function postError(message: string): void {
  postMessageToMain({ version: RUNTIME_PROTOCOL_VERSION, type: "error", message });
}

function postExecutionResult(requestId: string, ok: boolean, error?: string): void {
  postMessageToMain({
    version: RUNTIME_PROTOCOL_VERSION,
    type: "execution-result",
    requestId,
    ok,
    ...(error === undefined ? {} : { error }),
  });
}

function postMessageToMain(message: WorkerToMainMessage): void {
  output.flush();
  self.postMessage(message);
}

function formatError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function installMachineBufferAdapters(runtime: MicroPythonInstance): void {
  runtime.runPython(`
import machine as _machine

_JsSPI = _machine.SPI
_JsUART = _machine.UART

class SPI:
    MSB = _JsSPI.MSB
    LSB = _JsSPI.LSB

    def __init__(self, *args, **kwargs):
        self._adapter = _JsSPI(*args, **kwargs)

    def init(self, *args, **kwargs):
        return self._adapter.init(*args, **kwargs)

    def deinit(self):
        return self._adapter.deinit()

    def read(self, nbytes, write=0):
        return self._adapter.read(nbytes, write)

    def readinto(self, buf, write=0):
        data = self._adapter._readinto(len(buf), write)
        buf[:] = data

    def write(self, buf):
        return self._adapter.write(buf)

    def write_readinto(self, write_buf, read_buf):
        data = self._adapter._write_readinto(write_buf)
        if len(data) != len(read_buf):
            raise ValueError("SPI write and read buffers must have the same length")
        read_buf[:] = data

class UART:
    def __init__(self, *args, **kwargs):
        self._adapter = _JsUART(*args, **kwargs)

    def init(self, *args, **kwargs):
        return self._adapter.init(*args, **kwargs)

    def deinit(self):
        return self._adapter.deinit()

    def any(self):
        return self._adapter.any()

    def read(self, nbytes=None):
        if nbytes is None:
            return self._adapter.read()
        return self._adapter.read(nbytes)

    def readinto(self, buf, nbytes=None):
        count = len(buf) if nbytes is None else nbytes
        if count > len(buf):
            raise ValueError("UART byte count exceeds the read buffer length")
        data = self._adapter._readinto(count)
        if data is None:
            return None
        buf[:len(data)] = data
        return len(data)

    def readline(self):
        return self._adapter.readline()

    def write(self, buf):
        return self._adapter.write(buf)

_machine.SPI = SPI
_machine.UART = UART
`);
}

export {};
