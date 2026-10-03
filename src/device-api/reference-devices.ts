import type {
  DeviceContext,
  DeviceDefinition,
  DeviceManifestV1,
  DeviceModel,
  DevicePortKind,
  DigitalValue,
  PwmSignal,
  SpiConfiguration,
  UartConfiguration,
} from "./types.ts";

export const REFERENCE_I2C_ADDRESS = 0x50;

export function createReferenceLedDefinition(): DeviceDefinition {
  return defineReferenceDevice(
    "reference-led",
    "Reference LED",
    "digital-gpio-v1",
    "output",
    "gpio-observer",
    (context) => {
      let value: DigitalValue = 0;
      const emit = (): void => context.emitState({ value, enabled: value === 1 });
      emit();
      return {
        ports: {
          output: {
            kind: "gpio-observer",
            write(nextValue): void {
              if (nextValue === value) {
                return;
              }
              value = nextValue;
              emit();
            },
          },
        },
        reset(): void {
          value = 0;
          emit();
        },
      };
    },
  );
}

export function createReferenceButtonDefinition(activeLow = true): DeviceDefinition {
  return defineReferenceDevice(
    "reference-button",
    "Reference Button",
    "digital-gpio-v1",
    "input",
    "gpio-driver",
    (context) => {
      let pressed = false;
      const value = (): DigitalValue => (pressed === activeLow ? 0 : 1);
      const emit = (): void => context.emitState({ pressed, value: value() });
      emit();
      return {
        ports: {
          input: { kind: "gpio-driver", read: value },
        },
        handleAction(action): void {
          if (action.controlId !== "pressed" || typeof action.value !== "boolean") {
            throw new TypeError("Reference button expects a boolean pressed action.");
          }
          if (pressed === action.value) {
            return;
          }
          pressed = action.value;
          emit();
        },
        reset(): void {
          pressed = false;
          emit();
        },
      };
    },
  );
}

export function createReferenceAnalogInputDefinition(initialValue = 32_768): DeviceDefinition {
  assertU16(initialValue, "Initial analog value");
  return defineReferenceDevice(
    "reference-analog-input",
    "Reference Analog Input",
    "adc-input-v1",
    "input",
    "adc-source",
    (context) => {
      let value = initialValue;
      const emit = (): void => context.emitState({ value });
      emit();
      return {
        ports: {
          input: { kind: "adc-source", readU16: () => value },
        },
        handleAction(action): void {
          if (action.controlId !== "value" || typeof action.value !== "number") {
            throw new TypeError("Reference analog input expects a numeric value action.");
          }
          assertU16(action.value, "Analog value");
          if (value === action.value) {
            return;
          }
          value = action.value;
          emit();
        },
        reset(): void {
          value = initialValue;
          emit();
        },
      };
    },
  );
}

export function createReferenceI2cRegisterDefinition(
  address = REFERENCE_I2C_ADDRESS,
): DeviceDefinition {
  assertI2cAddress(address);
  const definition = defineReferenceDevice(
    "reference-i2c-register",
    "Reference I2C Register Device",
    "i2c-controller-v1",
    "i2c",
    "i2c-target",
    (context) => createI2cRegisterModel(context, address),
  );
  return {
    ...definition,
    manifest: {
      ...definition.manifest,
      ports: [{ id: "i2c", kind: "i2c-target", defaultAddress: address }],
    },
  };
}

export function createReferenceSpiRegisterDefinition(): DeviceDefinition {
  return defineReferenceDevice(
    "reference-spi-register",
    "Reference SPI Register Device",
    "spi-controller-v1",
    "spi",
    "spi-target",
    (context) => {
      const registers = new Uint8Array(128);
      let transferCount = 0;
      let configuration: SpiConfiguration = {
        baudrate: 1_000_000,
        polarity: 0,
        phase: 0,
        firstBit: "msb",
        bits: 8,
      };
      const emit = (): void =>
        context.emitState({
          transferCount,
          baudrate: configuration.baudrate,
          mode: configuration.polarity * 2 + configuration.phase,
        });
      emit();
      return {
        ports: {
          spi: {
            kind: "spi-target",
            configure(nextConfiguration): void {
              configuration = { ...nextConfiguration };
              emit();
            },
            transfer(writeData): Uint8Array {
              const result = new Uint8Array(writeData.length);
              if (writeData.length > 0) {
                const command = writeData[0]!;
                const isRead = (command & 0x80) !== 0;
                let address = command & 0x7f;
                for (let index = 1; index < writeData.length; index += 1) {
                  if (isRead) {
                    result[index] = registers[address]!;
                  } else {
                    registers[address] = writeData[index]!;
                  }
                  address = (address + 1) & 0x7f;
                }
              }
              transferCount += 1;
              emit();
              return result;
            },
          },
        },
        reset(): void {
          registers.fill(0);
          transferCount = 0;
          emit();
        },
      };
    },
  );
}

export function createReferenceUartEchoDefinition(): DeviceDefinition {
  return defineReferenceDevice(
    "reference-uart-echo",
    "Reference UART Echo Device",
    "uart-controller-v1",
    "uart",
    "uart-peer",
    (context) => {
      const receiveQueue: number[] = [];
      let receivedBytes = 0;
      let configuration: UartConfiguration = {
        baudrate: 115_200,
        bits: 8,
        parity: "none",
        stop: 1,
      };
      const emit = (): void =>
        context.emitState({
          bufferedBytes: receiveQueue.length,
          receivedBytes,
          baudrate: configuration.baudrate,
        });
      emit();
      return {
        ports: {
          uart: {
            kind: "uart-peer",
            configure(nextConfiguration): void {
              configuration = { ...nextConfiguration };
              emit();
            },
            writeFromBoard(data): number {
              if (receiveQueue.length + data.length > context.limits.maxUartBufferedBytes) {
                throw new RangeError("UART echo receive queue would exceed its byte limit.");
              }
              receiveQueue.push(...data);
              receivedBytes += data.length;
              emit();
              return data.length;
            },
            availableToBoard: () => receiveQueue.length,
            readForBoard(maxBytes): Uint8Array {
              const byteCount = Math.min(maxBytes, receiveQueue.length);
              const result = Uint8Array.from(receiveQueue.splice(0, byteCount));
              emit();
              return result;
            },
          },
        },
        reset(): void {
          receiveQueue.length = 0;
          receivedBytes = 0;
          emit();
        },
      };
    },
  );
}

export function createReferencePwmIndicatorDefinition(): DeviceDefinition {
  return defineReferenceDevice(
    "reference-pwm-indicator",
    "Reference PWM Indicator",
    "pwm-output-v1",
    "input",
    "pwm-observer",
    (context) => {
      let signal: PwmSignal = {
        enabled: false,
        frequencyHz: 1_000,
        dutyU16: 0,
        inverted: false,
      };
      const emit = (): void =>
        context.emitState({
          enabled: signal.enabled,
          frequencyHz: signal.frequencyHz,
          dutyU16: signal.dutyU16,
          inverted: signal.inverted,
        });
      emit();
      return {
        ports: {
          input: {
            kind: "pwm-observer",
            update(nextSignal): void {
              signal = { ...nextSignal };
              emit();
            },
          },
        },
        reset(): void {
          signal = { enabled: false, frequencyHz: 1_000, dutyU16: 0, inverted: false };
          emit();
        },
      };
    },
  );
}

function createI2cRegisterModel(context: DeviceContext, address: number): DeviceModel {
  const registers = new Uint8Array(256);
  let pointer = 0;
  let transactionCount = 0;
  const emit = (): void => context.emitState({ address, pointer, transactionCount });
  const advance = (start: number, byteCount: number): number => (start + byteCount) & 0xff;
  const readFrom = (start: number, byteCount: number): Uint8Array => {
    const result = new Uint8Array(byteCount);
    for (let index = 0; index < byteCount; index += 1) {
      result[index] = registers[advance(start, index)]!;
    }
    pointer = advance(start, byteCount);
    transactionCount += 1;
    emit();
    return result;
  };
  const writeFrom = (start: number, data: Uint8Array): void => {
    for (let index = 0; index < data.length; index += 1) {
      registers[advance(start, index)] = data[index]!;
    }
    pointer = advance(start, data.length);
    transactionCount += 1;
    emit();
  };
  emit();
  return {
    ports: {
      i2c: {
        kind: "i2c-target",
        addresses: [address],
        read: (byteCount) => readFrom(pointer, byteCount),
        write(data): void {
          if (data.length === 0) {
            transactionCount += 1;
            emit();
            return;
          }
          pointer = data[0]!;
          if (data.length === 1) {
            transactionCount += 1;
            emit();
            return;
          }
          writeFrom(pointer, data.subarray(1));
        },
        readMemory: readFrom,
        writeMemory: writeFrom,
      },
    },
    reset(): void {
      registers.fill(0);
      pointer = 0;
      transactionCount = 0;
      emit();
    },
  };
}

function defineReferenceDevice(
  idSuffix: string,
  name: string,
  boardCapability: string,
  portId: string,
  portKind: DevicePortKind,
  create: (context: DeviceContext) => DeviceModel,
): DeviceDefinition {
  const manifest: DeviceManifestV1 = {
    schemaVersion: 1,
    id: `org.micropython-web-lab.${idSuffix}`,
    version: "0.1.0",
    deviceApiVersion: 1,
    name,
    description: `${name} for Device API v1 conformance and examples`,
    license: "MIT",
    entrypoint: "./dist/device.js",
    requires: { boardCapabilities: [boardCapability] },
    ports: [{ id: portId, kind: portKind }],
  };
  return { manifest, create };
}

function assertU16(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new RangeError(`${label} must be an integer from 0 to 65535.`);
  }
}

function assertI2cAddress(address: number): void {
  if (!Number.isSafeInteger(address) || address < 0x08 || address > 0x77) {
    throw new RangeError("I2C address must be a 7-bit address from 0x08 to 0x77.");
  }
}
