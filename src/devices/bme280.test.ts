import { describe, expect, it } from "vitest";

import { runPico2WConformance } from "@micropython-web-lab/device-testkit";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { DeviceHost, type DeviceStateEvent } from "../device-api/device-host";
import {
  AE_BME280_I2C_ADDRESS,
  BME280_CHIP_ID,
  createAeBme280Definition,
} from "./bme280";

const BOARD_CONTEXT = {
  profileId: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.id,
  profileVersion: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.version,
  capabilities: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.capabilities,
};

describe("AE-BME280 Device API model", () => {
  it("passes the Pico 2 W Device API conformance test", () => {
    expect(runPico2WConformance(createAeBme280Definition())).toMatchObject({
      ok: true,
      issues: [],
    });
  });

  it("exposes the Bosch chip id, calibration data, and compensated measurements", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create("bme280", createAeBme280Definition());
    const port = host.getPort("bme280", "i2c", "i2c-target");

    expect(port.addresses).toEqual([AE_BME280_I2C_ADDRESS]);
    expect(port.readMemory(0xd0, 1)).toEqual(Uint8Array.of(BME280_CHIP_ID));
    const calibration = port.readMemory(0x88, 26);
    expect(readU16LE(calibration, 0)).toBe(32_768);
    expect(readI16LE(calibration, 2)).toBe(16_384);
    expect(readU16LE(calibration, 6)).toBe(32_768);

    port.writeMemory(0xf2, Uint8Array.of(0x01));
    port.writeMemory(0xf4, Uint8Array.of(0x27));
    expect(compensate(port.readMemory(0xf7, 8))).toEqual({
      temperatureC: 25,
      humidityPercent: 50,
      pressureHpa: 1_013,
    });
  });

  it("updates environmental input deterministically and supports soft reset", () => {
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create("bme280", createAeBme280Definition(0x77));
    const port = host.getPort("bme280", "i2c", "i2c-target");

    host.handleAction("bme280", { controlId: "temperatureC", value: -10 });
    host.handleAction("bme280", { controlId: "humidityPercent", value: 80 });
    host.handleAction("bme280", { controlId: "pressureHpa", value: 900 });
    expect(compensate(port.readMemory(0xf7, 8))).toEqual({
      temperatureC: -10,
      humidityPercent: 80,
      pressureHpa: 900,
    });
    expect(events.at(-1)?.state).toMatchObject({
      address: 0x77,
      temperatureC: -10,
      humidityPercent: 80,
      pressureHpa: 900,
    });

    port.writeMemory(0xf4, Uint8Array.of(0x27));
    expect(port.readMemory(0xf4, 1)).toEqual(Uint8Array.of(0x27));
    port.writeMemory(0xe0, Uint8Array.of(0xb6));
    expect(port.readMemory(0xf4, 1)).toEqual(Uint8Array.of(0));
    expect(compensate(port.readMemory(0xf7, 8))).toMatchObject({
      temperatureC: -10,
      humidityPercent: 80,
      pressureHpa: 900,
    });
  });

  it("rejects unsupported addresses and environmental values", () => {
    expect(() => createAeBme280Definition(0x75)).toThrow("0x76 or 0x77");
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create("bme280", createAeBme280Definition());
    expect(() =>
      host.handleAction("bme280", { controlId: "temperatureC", value: 86 }),
    ).toThrow("-40 to 85");
    expect(() =>
      host.handleAction("bme280", { controlId: "humidityPercent", value: 50.5 }),
    ).toThrow("integer");
  });
});

function compensate(data: Uint8Array): {
  temperatureC: number;
  humidityPercent: number;
  pressureHpa: number;
} {
  const adcPressure = (data[0]! << 12) | (data[1]! << 4) | (data[2]! >> 4);
  const adcTemperature = (data[3]! << 12) | (data[4]! << 4) | (data[5]! >> 4);
  const adcHumidity = (data[6]! << 8) | data[7]!;

  const temperatureFine =
    (((adcTemperature >> 3) - (32_768 << 1)) * 16_384) >> 11;
  const temperatureC = Math.round(((temperatureFine * 5 + 128) >> 8) / 100);

  const pressureDelta = 1_048_576 - adcPressure;
  const pressureQ24_8 = Math.floor((pressureDelta * 12_500) / 256);
  const pressureHpa = Math.round(pressureQ24_8 / 256 / 100);

  const humidityFactor = Math.floor((2_097_152 * 1_024 + 8_192) / 16_384);
  const humidityQ22_10 =
    (Math.floor((adcHumidity * 16_384 + 16_384) / 32_768) * humidityFactor) >> 12;
  const humidityPercent = Math.round(humidityQ22_10 / 1_024);
  return { temperatureC, humidityPercent, pressureHpa };
}

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function readI16LE(data: Uint8Array, offset: number): number {
  const value = readU16LE(data, offset);
  return value & 0x8000 ? value - 0x1_0000 : value;
}
