import {
  DEFAULT_DEVICE_LIMITS,
  validateDeviceManifest,
  type DeviceAction,
  type DeviceBoardContext,
  type DeviceClock,
  type DeviceDefinition,
  type DeviceLimits,
  type DeviceManifestV1,
  type DeviceModel,
  type DevicePort,
  type DevicePortKind,
  type DevicePortOfKind,
  type DeviceState,
  type DeviceStateEvent,
  type I2cTargetPort,
  type PwmSignal,
  type SpiConfiguration,
  type UartConfiguration,
} from "./types";

export type { DeviceStateEvent } from "./types";

export type DeviceStateHandler = (event: DeviceStateEvent) => void;

const SYSTEM_DEVICE_CLOCK: DeviceClock = Object.freeze({
  monotonicMilliseconds: () => performance.now(),
});

interface HostedDevice {
  model: DeviceModel | null;
  ports: Readonly<Record<string, DevicePort>> | null;
  sequence: number;
  active: boolean;
}

export class DeviceHost {
  readonly #board: DeviceBoardContext;
  readonly #limits: DeviceLimits;
  readonly #clock: DeviceClock;
  readonly #onState: DeviceStateHandler;
  readonly #devices = new Map<string, HostedDevice>();

  constructor(
    board: DeviceBoardContext,
    onState: DeviceStateHandler = () => undefined,
    limits: DeviceLimits = DEFAULT_DEVICE_LIMITS,
    clock: DeviceClock = SYSTEM_DEVICE_CLOCK,
  ) {
    assertBoardContext(board);
    assertLimits(limits);
    this.#board = Object.freeze({
      profileId: board.profileId,
      profileVersion: board.profileVersion,
      capabilities: Object.freeze([...board.capabilities]),
    });
    this.#limits = Object.freeze({ ...limits });
    this.#clock = validatedClock(clock);
    this.#onState = onState;
  }

  create(instanceId: string, definition: DeviceDefinition): void {
    assertNonEmptyString(instanceId, "Device instance id");
    if (this.#devices.has(instanceId)) {
      throw new Error(`Device instance ${instanceId} already exists.`);
    }
    const manifest = validateDeviceManifest(definition.manifest);
    validateManifestForBoard(manifest, this.#board);

    const hosted: HostedDevice = { model: null, ports: null, sequence: 0, active: true };
    this.#devices.set(instanceId, hosted);
    try {
      const model = definition.create({
        instanceId,
        board: this.#board,
        limits: this.#limits,
        clock: this.#clock,
        emitState: (state) => this.#emitState(instanceId, hosted, state),
      });
      assertDeviceModel(model);
      hosted.model = model;
      const ports = validateAndWrapPorts(manifest, model.ports, this.#limits);
      hosted.ports = Object.freeze(ports);
    } catch (error) {
      let cleanupError: unknown;
      if (hosted.model?.dispose !== undefined) {
        try {
          assertSynchronous(hosted.model.dispose(), "dispose after failed creation");
        } catch (disposeError) {
          cleanupError = disposeError;
        }
      }
      hosted.active = false;
      this.#devices.delete(instanceId);
      if (cleanupError !== undefined) {
        throw new AggregateError(
          [error, cleanupError],
          `Device instance ${instanceId} failed to create and dispose.`,
        );
      }
      throw error;
    }
  }

  getPort<Kind extends DevicePortKind>(
    instanceId: string,
    portId: string,
    kind: Kind,
  ): DevicePortOfKind<Kind> {
    const hosted = this.#requiredDevice(instanceId);
    const port = hosted.ports?.[portId];
    if (port === undefined) {
      throw new Error(`Device instance ${instanceId} has no port named ${portId}.`);
    }
    if (port.kind !== kind) {
      throw new TypeError(
        `Device port ${instanceId}.${portId} is ${port.kind}, not ${kind}.`,
      );
    }
    return port as DevicePortOfKind<Kind>;
  }

  handleAction(instanceId: string, action: DeviceAction): void {
    assertAction(action);
    const model = this.#requiredModel(instanceId);
    if (model.handleAction === undefined) {
      throw new Error(`Device instance ${instanceId} does not accept actions.`);
    }
    assertSynchronous(model.handleAction({ ...action }), "handleAction");
  }

  reset(instanceId: string): void {
    const model = this.#requiredModel(instanceId);
    assertSynchronous(model.reset(), "reset");
  }

  resetAll(): void {
    const errors: unknown[] = [];
    for (const instanceId of this.#devices.keys()) {
      try {
        this.reset(instanceId);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more device instances failed to reset.");
    }
  }

  dispose(instanceId: string): void {
    const hosted = this.#requiredDevice(instanceId);
    hosted.active = false;
    this.#devices.delete(instanceId);
    if (hosted.model?.dispose !== undefined) {
      assertSynchronous(hosted.model.dispose(), "dispose");
    }
  }

  disposeAll(): void {
    const instanceIds = [...this.#devices.keys()];
    const errors: unknown[] = [];
    for (const instanceId of instanceIds) {
      try {
        this.dispose(instanceId);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more device instances failed to dispose.");
    }
  }

  #requiredDevice(instanceId: string): HostedDevice {
    const hosted = this.#devices.get(instanceId);
    if (hosted === undefined) {
      throw new Error(`Unknown device instance: ${instanceId}`);
    }
    return hosted;
  }

  #requiredModel(instanceId: string): DeviceModel {
    const hosted = this.#requiredDevice(instanceId);
    if (hosted.model === null) {
      throw new Error(`Device instance ${instanceId} is still being created.`);
    }
    return hosted.model;
  }

  #emitState(instanceId: string, hosted: HostedDevice, state: DeviceState): void {
    if (!hosted.active) {
      throw new Error(`Disposed device instance ${instanceId} cannot emit state.`);
    }
    const snapshot = validateAndCopyState(state, this.#limits.maxStateBytes);
    hosted.sequence += 1;
    this.#onState({ instanceId, sequence: hosted.sequence, state: snapshot });
  }
}

function validatedClock(source: DeviceClock): DeviceClock {
  if (
    typeof source !== "object" ||
    source === null ||
    typeof source.monotonicMilliseconds !== "function"
  ) {
    throw new TypeError("Device clock must provide monotonicMilliseconds().");
  }
  let previous = 0;
  return Object.freeze({
    monotonicMilliseconds(): number {
      const value = source.monotonicMilliseconds();
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError("Device clock must return a non-negative finite millisecond value.");
      }
      if (value < previous) {
        throw new RangeError("Device clock must not move backwards.");
      }
      previous = value;
      return value;
    },
  });
}

function validateManifestForBoard(
  manifest: DeviceManifestV1,
  board: DeviceBoardContext,
): void {
  const available = new Set(board.capabilities);
  for (const capability of manifest.requires.boardCapabilities) {
    if (!available.has(capability)) {
      throw new Error(`Board profile does not provide required capability ${capability}.`);
    }
  }
}

function validateAndWrapPorts(
  manifest: DeviceManifestV1,
  ports: Readonly<Record<string, DevicePort>>,
  limits: DeviceLimits,
): Record<string, DevicePort> {
  const declared = new Map(manifest.ports.map((port) => [port.id, port.kind]));
  for (const portId of Object.keys(ports)) {
    if (!declared.has(portId)) {
      throw new Error(`Device model returned undeclared port ${portId}.`);
    }
  }
  const wrapped: Record<string, DevicePort> = {};
  for (const [portId, expectedKind] of declared) {
    const port = ports[portId];
    if (port === undefined) {
      throw new Error(`Device model did not return declared port ${portId}.`);
    }
    if (port.kind !== expectedKind) {
      throw new TypeError(`Device port ${portId} must be ${expectedKind}, received ${port.kind}.`);
    }
    wrapped[portId] = wrapPort(port, limits);
  }
  return wrapped;
}

function wrapPort(port: DevicePort, limits: DeviceLimits): DevicePort {
  switch (port.kind) {
    case "gpio-observer":
      return Object.freeze({
        kind: port.kind,
        write(value: 0 | 1): void {
          assertDigitalValue(value, "GPIO output");
          assertSynchronous(port.write(value), "gpio-observer.write");
        },
      });
    case "gpio-driver":
      return Object.freeze({
        kind: port.kind,
        read(): 0 | 1 {
          const value = port.read();
          assertSynchronous(value, "gpio-driver.read");
          assertDigitalValue(value, "GPIO input");
          return value;
        },
      });
    case "adc-source":
      return Object.freeze({
        kind: port.kind,
        readU16(): number {
          const value = port.readU16();
          assertSynchronous(value, "adc-source.readU16");
          assertIntegerInRange(value, 0, 65_535, "ADC value");
          return value;
        },
      });
    case "i2c-target":
      return wrapI2cPort(port, limits);
    case "spi-target":
      return Object.freeze({
        kind: port.kind,
        configure(configuration: SpiConfiguration): void {
          assertSpiConfiguration(configuration);
          assertSynchronous(port.configure({ ...configuration }), "spi-target.configure");
        },
        transfer(writeData: Uint8Array): Uint8Array {
          assertByteArray(writeData, "SPI write data");
          assertTransferLength(writeData.length, limits.maxSpiTransferBytes, "SPI");
          const result = port.transfer(writeData.slice());
          assertSynchronous(result, "spi-target.transfer");
          assertByteArray(result, "SPI response");
          if (result.length !== writeData.length) {
            throw new RangeError("SPI response length must match the write data length.");
          }
          return result.slice();
        },
      });
    case "uart-peer":
      return Object.freeze({
        kind: port.kind,
        configure(configuration: UartConfiguration): void {
          assertUartConfiguration(configuration);
          assertSynchronous(port.configure({ ...configuration }), "uart-peer.configure");
        },
        writeFromBoard(data: Uint8Array): number {
          assertByteArray(data, "UART write data");
          assertTransferLength(data.length, limits.maxUartTransferBytes, "UART");
          const accepted = port.writeFromBoard(data.slice());
          assertSynchronous(accepted, "uart-peer.writeFromBoard");
          assertIntegerInRange(accepted, 0, data.length, "UART accepted byte count");
          return accepted;
        },
        availableToBoard(): number {
          const available = port.availableToBoard();
          assertSynchronous(available, "uart-peer.availableToBoard");
          assertIntegerInRange(
            available,
            0,
            limits.maxUartBufferedBytes,
            "UART available byte count",
          );
          return available;
        },
        readForBoard(maxBytes: number): Uint8Array {
          assertTransferLength(maxBytes, limits.maxUartTransferBytes, "UART");
          const result = port.readForBoard(maxBytes);
          assertSynchronous(result, "uart-peer.readForBoard");
          assertByteArray(result, "UART read data");
          if (result.length > maxBytes) {
            throw new RangeError("UART read data exceeds the requested byte count.");
          }
          return result.slice();
        },
      });
    case "pwm-observer":
      return Object.freeze({
        kind: port.kind,
        update(signal: PwmSignal): void {
          assertPwmSignal(signal);
          assertSynchronous(port.update({ ...signal }), "pwm-observer.update");
        },
      });
  }
}

function wrapI2cPort(port: I2cTargetPort, limits: DeviceLimits): I2cTargetPort {
  const addresses = [...port.addresses];
  const uniqueAddresses = new Set<number>();
  for (const address of addresses) {
    assertIntegerInRange(address, 0x08, 0x77, "I2C address");
    if (uniqueAddresses.has(address)) {
      throw new Error(`Duplicate I2C address: ${address}`);
    }
    uniqueAddresses.add(address);
  }
  if (addresses.length === 0) {
    throw new RangeError("An I2C target must expose at least one address.");
  }
  return Object.freeze({
    kind: port.kind,
    addresses: Object.freeze(addresses),
    read(byteCount: number): Uint8Array {
      assertTransferLength(byteCount, limits.maxI2cTransferBytes, "I2C");
      return validateReadResult(port.read(byteCount), byteCount, "I2C read");
    },
    write(data: Uint8Array): void {
      assertByteArray(data, "I2C write data");
      assertTransferLength(data.length, limits.maxI2cTransferBytes, "I2C");
      assertSynchronous(port.write(data.slice()), "i2c-target.write");
    },
    readMemory(memoryAddress: number, byteCount: number): Uint8Array {
      assertMemoryAddress(memoryAddress);
      assertTransferLength(byteCount, limits.maxI2cTransferBytes, "I2C");
      return validateReadResult(
        port.readMemory(memoryAddress, byteCount),
        byteCount,
        "I2C memory read",
      );
    },
    writeMemory(memoryAddress: number, data: Uint8Array): void {
      assertMemoryAddress(memoryAddress);
      assertByteArray(data, "I2C memory write data");
      assertTransferLength(data.length, limits.maxI2cTransferBytes, "I2C");
      assertSynchronous(
        port.writeMemory(memoryAddress, data.slice()),
        "i2c-target.writeMemory",
      );
    },
  });
}

function validateReadResult(result: Uint8Array, expectedLength: number, label: string): Uint8Array {
  assertSynchronous(result, label);
  assertByteArray(result, `${label} data`);
  if (result.length !== expectedLength) {
    throw new RangeError(`${label} data length must match the requested byte count.`);
  }
  return result.slice();
}

function validateAndCopyState(state: DeviceState, maxBytes: number): DeviceState {
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
  const byteLength = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  if (byteLength > maxBytes) {
    throw new RangeError(`Device state exceeds the ${maxBytes}-byte limit.`);
  }
  return Object.freeze(snapshot);
}

function assertBoardContext(board: DeviceBoardContext): void {
  assertNonEmptyString(board.profileId, "Board profile id");
  assertIntegerInRange(board.profileVersion, 1, Number.MAX_SAFE_INTEGER, "Board profile version");
  if (!Array.isArray(board.capabilities)) {
    throw new TypeError("Board capabilities must be an array.");
  }
  for (const capability of board.capabilities) {
    assertNonEmptyString(capability, "Board capability");
  }
}

function assertLimits(limits: DeviceLimits): void {
  for (const [label, value] of [
    ["maxI2cTransferBytes", limits.maxI2cTransferBytes],
    ["maxSpiTransferBytes", limits.maxSpiTransferBytes],
    ["maxUartTransferBytes", limits.maxUartTransferBytes],
    ["maxUartBufferedBytes", limits.maxUartBufferedBytes],
    ["maxStateBytes", limits.maxStateBytes],
  ] as const) {
    assertIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER, label);
  }
}

function assertDeviceModel(model: DeviceModel): void {
  if (typeof model !== "object" || model === null || typeof model.reset !== "function") {
    throw new TypeError("Device definition must create a DeviceModel.");
  }
  if (typeof model.ports !== "object" || model.ports === null || Array.isArray(model.ports)) {
    throw new TypeError("Device model ports must be an object.");
  }
}

function assertAction(action: DeviceAction): void {
  if (typeof action !== "object" || action === null) {
    throw new TypeError("Device action must be an object.");
  }
  assertNonEmptyString(action.controlId, "Device action control id");
  const value = action.value;
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw new TypeError("Device action value must be a scalar.");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError("Device action value must be finite.");
  }
}

function assertSpiConfiguration(configuration: SpiConfiguration): void {
  assertPositiveFinite(configuration.baudrate, "SPI baudrate");
  assertDigitalValue(configuration.polarity, "SPI polarity");
  assertDigitalValue(configuration.phase, "SPI phase");
  if (configuration.firstBit !== "msb" && configuration.firstBit !== "lsb") {
    throw new RangeError("SPI firstBit must be msb or lsb.");
  }
  if (configuration.bits !== 8) {
    throw new RangeError("Device API v1 supports only 8-bit SPI transfers.");
  }
}

function assertUartConfiguration(configuration: UartConfiguration): void {
  assertPositiveFinite(configuration.baudrate, "UART baudrate");
  if (configuration.bits !== 8) {
    throw new RangeError("Device API v1 supports only 8-bit UART transfers.");
  }
  if (!(["none", "even", "odd"] as const).includes(configuration.parity)) {
    throw new RangeError("UART parity must be none, even, or odd.");
  }
  if (configuration.stop !== 1 && configuration.stop !== 2) {
    throw new RangeError("UART stop bits must be 1 or 2.");
  }
}

function assertPwmSignal(signal: PwmSignal): void {
  if (typeof signal.enabled !== "boolean" || typeof signal.inverted !== "boolean") {
    throw new TypeError("PWM enabled and inverted values must be boolean.");
  }
  assertPositiveFinite(signal.frequencyHz, "PWM frequency");
  assertIntegerInRange(signal.dutyU16, 0, 65_535, "PWM duty_u16");
}

function assertMemoryAddress(address: number): void {
  assertIntegerInRange(address, 0, 255, "I2C memory address");
}

function assertTransferLength(byteCount: number, maximum: number, label: string): void {
  assertIntegerInRange(byteCount, 0, maximum, `${label} transfer length`);
}

function assertDigitalValue(value: unknown, label: string): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) {
    throw new RangeError(`${label} must be 0 or 1.`);
  }
}

function assertByteArray(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Uint8Array.`);
  }
}

function assertIntegerInRange(value: unknown, minimum: number, maximum: number, label: string): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function assertPositiveFinite(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertSynchronous(value: unknown, operation: string): void {
  if (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    throw new TypeError(`${operation} must be synchronous.`);
  }
}
