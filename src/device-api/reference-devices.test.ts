import { describe, expect, it } from "vitest";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { DeviceHost, type DeviceStateEvent } from "./device-host";
import {
  createReferenceAnalogInputDefinition,
  createReferenceButtonDefinition,
  createReferenceI2cRegisterDefinition,
  createReferenceLedDefinition,
  createReferencePwmIndicatorDefinition,
  createReferenceSpiRegisterDefinition,
  createReferenceUartEchoDefinition,
} from "./reference-devices";

const BOARD_CONTEXT = {
  profileId: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.id,
  profileVersion: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.version,
  capabilities: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.capabilities,
};

describe("Device API v1 reference devices", () => {
  it("models an LED and active-low button through GPIO ports", () => {
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create("led", createReferenceLedDefinition());
    host.create("button", createReferenceButtonDefinition());

    host.getPort("led", "output", "gpio-observer").write(1);
    host.handleAction("button", { controlId: "pressed", value: true });

    expect(host.getPort("button", "input", "gpio-driver").read()).toBe(0);
    expect(events.filter((event) => event.instanceId === "led").at(-1)?.state).toEqual({
      value: 1,
      enabled: true,
    });
    expect(events.filter((event) => event.instanceId === "button").at(-1)?.state).toEqual({
      pressed: true,
      value: 0,
    });
  });

  it("models a deterministic 16-bit analog input", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create("analog", createReferenceAnalogInputDefinition(12_345));

    expect(host.getPort("analog", "input", "adc-source").readU16()).toBe(12_345);
    host.handleAction("analog", { controlId: "value", value: 54_321 });
    expect(host.getPort("analog", "input", "adc-source").readU16()).toBe(54_321);
  });

  it("supports pointer and memory operations on the I2C register device", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create("i2c", createReferenceI2cRegisterDefinition());
    const port = host.getPort("i2c", "i2c", "i2c-target");

    port.writeMemory(0xfe, Uint8Array.of(1, 2, 3));
    expect(port.readMemory(0xfe, 3)).toEqual(Uint8Array.of(1, 2, 3));
    port.write(Uint8Array.of(0xfe));
    expect(port.read(3)).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("reads and writes the SPI register model with equal-length full-duplex transfers", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create("spi", createReferenceSpiRegisterDefinition());
    const port = host.getPort("spi", "spi", "spi-target");
    port.configure({ baudrate: 2_000_000, polarity: 1, phase: 0, firstBit: "msb", bits: 8 });

    expect(port.transfer(Uint8Array.of(0x10, 0xaa, 0xbb))).toEqual(Uint8Array.of(0, 0, 0));
    expect(port.transfer(Uint8Array.of(0x90, 0, 0))).toEqual(Uint8Array.of(0, 0xaa, 0xbb));
  });

  it("echoes UART data in order and rejects receive queue overflow", () => {
    const host = new DeviceHost(BOARD_CONTEXT, () => undefined, {
      maxI2cTransferBytes: 256,
      maxSpiTransferBytes: 256,
      maxUartTransferBytes: 4,
      maxUartBufferedBytes: 5,
      maxStateBytes: 16 * 1_024,
    });
    host.create("uart", createReferenceUartEchoDefinition());
    const port = host.getPort("uart", "uart", "uart-peer");

    expect(port.writeFromBoard(Uint8Array.of(1, 2, 3, 4))).toBe(4);
    expect(port.readForBoard(2)).toEqual(Uint8Array.of(1, 2));
    expect(port.writeFromBoard(Uint8Array.of(5, 6, 7))).toBe(3);
    expect(() => port.writeFromBoard(Uint8Array.of(8))).toThrow("queue");
    expect(port.readForBoard(4)).toEqual(Uint8Array.of(3, 4, 5, 6));
    expect(port.readForBoard(4)).toEqual(Uint8Array.of(7));
  });

  it("normalizes PWM state without depending on a UI", () => {
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create("pwm", createReferencePwmIndicatorDefinition());
    host.getPort("pwm", "input", "pwm-observer").update({
      enabled: true,
      frequencyHz: 440,
      dutyU16: 32_768,
      inverted: false,
    });

    expect(events.at(-1)?.state).toEqual({
      enabled: true,
      frequencyHz: 440,
      dutyU16: 32_768,
      inverted: false,
    });
  });
});
