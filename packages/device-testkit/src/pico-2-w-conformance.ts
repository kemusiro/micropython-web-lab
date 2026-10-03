import {
  DEFAULT_DEVICE_LIMITS,
  validateDeviceManifest,
  type DeviceBoardContext,
  type DeviceDefinition,
  type DeviceModel,
  type DevicePort,
  type DeviceState,
} from "@micropython-web-lab/device-api";

export const PICO_2_W_TEST_BOARD: DeviceBoardContext = Object.freeze({
  profileId: "raspberry-pi-pico-2-w-v1",
  profileVersion: 1,
  capabilities: Object.freeze([
    "digital-gpio-v1",
    "adc-input-v1",
    "i2c-controller-v1",
    "spi-controller-v1",
    "uart-controller-v1",
    "pwm-output-v1",
  ]),
});

export interface DeviceConformanceIssue {
  readonly code: string;
  readonly message: string;
}

export interface DeviceConformanceReport {
  readonly ok: boolean;
  readonly manifestId?: string;
  readonly issues: readonly DeviceConformanceIssue[];
  readonly states: readonly DeviceState[];
}

export function runPico2WConformance(definition: DeviceDefinition): DeviceConformanceReport {
  const issues: DeviceConformanceIssue[] = [];
  const states: DeviceState[] = [];
  let manifestId: string | undefined;
  let model: DeviceModel | undefined;
  try {
    const manifest = validateDeviceManifest(definition.manifest);
    manifestId = manifest.id;
    for (const capability of manifest.requires.boardCapabilities) {
      if (!PICO_2_W_TEST_BOARD.capabilities.includes(capability)) {
        issue(issues, "board-capability", `Pico 2 W test host does not provide ${capability}.`);
      }
    }
    model = definition.create({
      instanceId: "conformance-device",
      board: PICO_2_W_TEST_BOARD,
      limits: DEFAULT_DEVICE_LIMITS,
      clock: Object.freeze({ monotonicMilliseconds: () => 0 }),
      emitState(state): void {
        states.push(validateState(state));
      },
    });
    validateModel(model, manifest.ports, issues);
  } catch (error) {
    issue(issues, "create", formatError(error));
  }

  if (model !== undefined) {
    exerciseLifecycle(model, issues);
  }
  return Object.freeze({
    ok: issues.length === 0,
    ...(manifestId === undefined ? {} : { manifestId }),
    issues: Object.freeze(issues),
    states: Object.freeze(states),
  });
}

function validateModel(
  model: DeviceModel,
  declaredPorts: DeviceDefinition["manifest"]["ports"],
  issues: DeviceConformanceIssue[],
): void {
  if (typeof model !== "object" || model === null) {
    issue(issues, "model", "DeviceDefinition.create() must return an object.");
    return;
  }
  if (typeof model.reset !== "function") {
    issue(issues, "reset", "DeviceModel.reset must be a function.");
  }
  if (typeof model.ports !== "object" || model.ports === null || Array.isArray(model.ports)) {
    issue(issues, "ports", "DeviceModel.ports must be an object.");
    return;
  }
  const declared = new Map(declaredPorts.map((port) => [port.id, port.kind]));
  for (const portId of Object.keys(model.ports)) {
    if (!declared.has(portId)) {
      issue(issues, "undeclared-port", `Device model returned undeclared port ${portId}.`);
    }
  }
  for (const [portId, expectedKind] of declared) {
    const port = model.ports[portId];
    if (port === undefined) {
      issue(issues, "missing-port", `Device model did not return declared port ${portId}.`);
      continue;
    }
    if (port.kind !== expectedKind) {
      issue(issues, "port-kind", `Port ${portId} must be ${expectedKind}, received ${port.kind}.`);
      continue;
    }
    exercisePort(portId, port, issues);
  }
}

function exercisePort(
  portId: string,
  port: DevicePort,
  issues: DeviceConformanceIssue[],
): void {
  try {
    switch (port.kind) {
      case "gpio-observer":
        assertSynchronous(port.write(0), `${portId}.write(0)`);
        assertSynchronous(port.write(1), `${portId}.write(1)`);
        break;
      case "gpio-driver": {
        const value = port.read();
        if (value !== 0 && value !== 1) {
          throw new RangeError(`${portId}.read() must return 0 or 1.`);
        }
        break;
      }
      case "adc-source": {
        const value = port.readU16();
        if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
          throw new RangeError(`${portId}.readU16() must return an integer from 0 to 65535.`);
        }
        break;
      }
      case "i2c-target":
        validateI2cAddresses(portId, port.addresses);
        expectBytes(port.read(1), 1, `${portId}.read(1)`);
        assertSynchronous(port.write(Uint8Array.of(0)), `${portId}.write(1 byte)`);
        expectBytes(port.readMemory(0, 1), 1, `${portId}.readMemory(0, 1)`);
        assertSynchronous(
          port.writeMemory(0, Uint8Array.of(0)),
          `${portId}.writeMemory(0, 1 byte)`,
        );
        break;
      case "spi-target":
        assertSynchronous(
          port.configure({
            baudrate: 1_000_000,
            polarity: 0,
            phase: 0,
            firstBit: "msb",
            bits: 8,
          }),
          `${portId}.configure()`,
        );
        expectBytes(port.transfer(Uint8Array.of(0)), 1, `${portId}.transfer(1 byte)`);
        break;
      case "uart-peer": {
        assertSynchronous(
          port.configure({ baudrate: 115_200, bits: 8, parity: "none", stop: 1 }),
          `${portId}.configure()`,
        );
        const written = port.writeFromBoard(Uint8Array.of(0));
        if (written !== 1) {
          throw new RangeError(`${portId}.writeFromBoard(1 byte) must return 1.`);
        }
        const available = port.availableToBoard();
        if (!Number.isSafeInteger(available) || available < 0 || available > 4_096) {
          throw new RangeError(`${portId}.availableToBoard() must return 0 to 4096.`);
        }
        expectBytes(port.readForBoard(0), 0, `${portId}.readForBoard(0)`);
        break;
      }
      case "pwm-observer":
        assertSynchronous(
          port.update({ enabled: false, frequencyHz: 1_000, dutyU16: 0, inverted: false }),
          `${portId}.update()`,
        );
        break;
    }
  } catch (error) {
    issue(issues, `port:${portId}`, formatError(error));
  }
}

function exerciseLifecycle(model: DeviceModel, issues: DeviceConformanceIssue[]): void {
  if (typeof model.reset === "function") {
    try {
      assertSynchronous(model.reset(), "DeviceModel.reset()");
    } catch (error) {
      issue(issues, "reset", formatError(error));
    }
  }
  if (model.dispose !== undefined) {
    try {
      assertSynchronous(model.dispose(), "DeviceModel.dispose()");
    } catch (error) {
      issue(issues, "dispose", formatError(error));
    }
  }
}

function validateState(state: DeviceState): DeviceState {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new TypeError("Device state must be a flat object.");
  }
  const snapshot: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new TypeError(`Device state value ${key} must be a scalar.`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new RangeError(`Device state value ${key} must be finite.`);
    }
    snapshot[key] = value;
  }
  if (utf8ByteLength(JSON.stringify(snapshot)) > DEFAULT_DEVICE_LIMITS.maxStateBytes) {
    throw new RangeError("Device state exceeds the 16384-byte limit.");
  }
  return Object.freeze(snapshot);
}

function validateI2cAddresses(portId: string, addresses: readonly number[]): void {
  if (!Array.isArray(addresses) || addresses.length < 1) {
    throw new TypeError(`${portId}.addresses must contain at least one address.`);
  }
  const unique = new Set<number>();
  for (const address of addresses) {
    if (!Number.isSafeInteger(address) || address < 0x08 || address > 0x77) {
      throw new RangeError(`${portId}.addresses must contain 7-bit addresses from 8 to 119.`);
    }
    if (unique.has(address)) {
      throw new Error(`${portId}.addresses must not contain duplicates.`);
    }
    unique.add(address);
  }
}

function expectBytes(value: unknown, length: number, label: string): void {
  assertSynchronous(value, label);
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new TypeError(`${label} must return a Uint8Array with length ${length}.`);
  }
}

function assertSynchronous(value: unknown, label: string): void {
  if (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    throw new TypeError(`${label} must be synchronous.`);
  }
}

function issue(issues: DeviceConformanceIssue[], code: string, message: string): void {
  issues.push(Object.freeze({ code, message }));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function utf8ByteLength(value: string): number {
  let byteLength = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    byteLength += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return byteLength;
}
