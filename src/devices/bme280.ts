import type {
  DeviceContext,
  DeviceDefinition,
  DeviceModel,
} from "../device-api/types.ts";

export const AE_BME280_I2C_ADDRESS = 0x76;
export const BME280_CHIP_ID = 0x60;
export const DEFAULT_BME280_TEMPERATURE_C = 25;
export const DEFAULT_BME280_HUMIDITY_PERCENT = 50;
export const DEFAULT_BME280_PRESSURE_HPA = 1_013;

const BME280_SECONDARY_I2C_ADDRESS = 0x77;
const CHIP_ID_REGISTER = 0xd0;
const RESET_REGISTER = 0xe0;
const RESET_COMMAND = 0xb6;
const CTRL_HUM_REGISTER = 0xf2;
const STATUS_REGISTER = 0xf3;
const CTRL_MEAS_REGISTER = 0xf4;
const CONFIG_REGISTER = 0xf5;
const PRESSURE_DATA_REGISTER = 0xf7;
const TEMPERATURE_DATA_REGISTER = 0xfa;
const HUMIDITY_DATA_REGISTER = 0xfd;

export function createAeBme280Definition(
  address = AE_BME280_I2C_ADDRESS,
): DeviceDefinition {
  if (address !== AE_BME280_I2C_ADDRESS && address !== BME280_SECONDARY_I2C_ADDRESS) {
    throw new RangeError("AE-BME280 I2C address must be 0x76 or 0x77.");
  }
  return {
    manifest: {
      schemaVersion: 1,
      id: "org.micropython-web-lab.ae-bme280",
      version: "0.1.0",
      deviceApiVersion: 1,
      name: "AE-BME280 Environmental Sensor",
      description: "Akizuki Denshi AE-BME280 temperature, humidity, and pressure sensor",
      license: "MIT",
      entrypoint: "./dist/device.js",
      requires: { boardCapabilities: ["i2c-controller-v1"] },
      ports: [{ id: "i2c", kind: "i2c-target", defaultAddress: address }],
    },
    create: (context) => createBme280Model(context, address),
  };
}

function createBme280Model(context: DeviceContext, address: number): DeviceModel {
  const registers = new Uint8Array(256);
  let pointer = 0;
  let transactionCount = 0;
  let temperatureC = DEFAULT_BME280_TEMPERATURE_C;
  let humidityPercent = DEFAULT_BME280_HUMIDITY_PERCENT;
  let pressureHpa = DEFAULT_BME280_PRESSURE_HPA;

  const emit = (): void => {
    context.emitState({
      address,
      chipId: BME280_CHIP_ID,
      temperatureC,
      humidityPercent,
      pressureHpa,
      transactionCount,
    });
  };
  const updateMeasurements = (): void => {
    writeU20BE(registers, TEMPERATURE_DATA_REGISTER, temperatureRaw(temperatureC));
    writeU20BE(registers, PRESSURE_DATA_REGISTER, pressureRaw(pressureHpa));
    writeU16BE(registers, HUMIDITY_DATA_REGISTER, humidityRaw(humidityPercent));
  };
  const initializeRegisters = (): void => {
    registers.fill(0);
    writeU16LE(registers, 0x88, 32_768);
    writeI16LE(registers, 0x8a, 16_384);
    writeI16LE(registers, 0x8c, 0);
    writeU16LE(registers, 0x8e, 32_768);
    for (let register = 0x90; register <= 0x9f; register += 2) {
      writeI16LE(registers, register, 0);
    }
    registers[0xa1] = 0;
    writeI16LE(registers, 0xe1, 1_024);
    registers[0xe3] = 0;
    registers[0xe4] = 0;
    registers[0xe5] = 0;
    registers[0xe6] = 0;
    registers[0xe7] = 0;
    registers[CHIP_ID_REGISTER] = BME280_CHIP_ID;
    registers[STATUS_REGISTER] = 0;
    registers[CTRL_HUM_REGISTER] = 0;
    registers[CTRL_MEAS_REGISTER] = 0;
    registers[CONFIG_REGISTER] = 0;
    updateMeasurements();
  };
  const readFrom = (start: number, byteCount: number): Uint8Array => {
    const result = new Uint8Array(byteCount);
    for (let index = 0; index < byteCount; index += 1) {
      result[index] = registers[(start + index) & 0xff]!;
    }
    pointer = (start + byteCount) & 0xff;
    transactionCount += 1;
    emit();
    return result;
  };
  const writeRegister = (register: number, value: number): void => {
    switch (register) {
      case RESET_REGISTER:
        if (value === RESET_COMMAND) {
          initializeRegisters();
          pointer = 0;
        }
        break;
      case CTRL_HUM_REGISTER:
        registers[register] = value & 0x07;
        break;
      case CTRL_MEAS_REGISTER:
        registers[register] = value;
        break;
      case CONFIG_REGISTER:
        registers[register] = value & 0xfd;
        break;
    }
  };
  const writeFrom = (start: number, data: Uint8Array): void => {
    for (let index = 0; index < data.length; index += 1) {
      writeRegister((start + index) & 0xff, data[index]!);
    }
    pointer = (start + data.length) & 0xff;
    transactionCount += 1;
    emit();
  };

  initializeRegisters();
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
    handleAction(action): void {
      let changed = false;
      if (action.controlId === "temperatureC" && typeof action.value === "number") {
        const next = integerInRange(action.value, -40, 85, "BME280 temperature");
        changed = next !== temperatureC;
        temperatureC = next;
      } else if (
        action.controlId === "humidityPercent" &&
        typeof action.value === "number"
      ) {
        const next = integerInRange(action.value, 0, 100, "BME280 humidity");
        changed = next !== humidityPercent;
        humidityPercent = next;
      } else if (action.controlId === "pressureHpa" && typeof action.value === "number") {
        const next = integerInRange(action.value, 300, 1_100, "BME280 pressure");
        changed = next !== pressureHpa;
        pressureHpa = next;
      } else {
        throw new TypeError(`Unsupported AE-BME280 action: ${action.controlId}`);
      }
      if (changed) {
        updateMeasurements();
        emit();
      }
    },
    reset(): void {
      pointer = 0;
      transactionCount = 0;
      temperatureC = DEFAULT_BME280_TEMPERATURE_C;
      humidityPercent = DEFAULT_BME280_HUMIDITY_PERCENT;
      pressureHpa = DEFAULT_BME280_PRESSURE_HPA;
      initializeRegisters();
      emit();
    },
  };
}

function temperatureRaw(temperatureC: number): number {
  return 524_288 + temperatureC * 5_120;
}

function humidityRaw(humidityPercent: number): number {
  return humidityPercent * 64;
}

function pressureRaw(pressureHpa: number): number {
  const pressurePa = pressureHpa * 100;
  const delta = Math.round((pressurePa * 65_536) / 12_500);
  return 1_048_576 - delta;
}

function writeU20BE(registers: Uint8Array, address: number, value: number): void {
  registers[address] = (value >> 12) & 0xff;
  registers[address + 1] = (value >> 4) & 0xff;
  registers[address + 2] = (value & 0x0f) << 4;
}

function writeU16BE(registers: Uint8Array, address: number, value: number): void {
  registers[address] = (value >> 8) & 0xff;
  registers[address + 1] = value & 0xff;
}

function writeU16LE(registers: Uint8Array, address: number, value: number): void {
  registers[address] = value & 0xff;
  registers[address + 1] = (value >> 8) & 0xff;
}

function writeI16LE(registers: Uint8Array, address: number, value: number): void {
  writeU16LE(registers, address, value & 0xffff);
}

function integerInRange(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}
