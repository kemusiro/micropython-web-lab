import { describe, expect, it } from "vitest";

import { VirtualGpioBoard, type VirtualDeviceState } from "./virtual-gpio";

describe("VirtualGpioBoard", () => {
  it("emits deterministic, ordered state changes", () => {
    const events: VirtualDeviceState[] = [];
    const board = new VirtualGpioBoard((state) => events.push(state));
    const pin = board.openPin("LED", "output");

    pin.write(1);
    pin.write(1);
    pin.write(0);

    expect(events).toEqual([
      { kind: "gpio-pin", sequence: 1, pinId: "LED", mode: "output", value: 0 },
      { kind: "gpio-pin", sequence: 2, pinId: "LED", mode: "output", value: 1 },
      { kind: "gpio-pin", sequence: 3, pinId: "LED", mode: "output", value: 0 },
    ]);
  });

  it("rejects writes to an input pin", () => {
    const board = new VirtualGpioBoard(() => undefined);
    const pin = board.openPin("button", "input");

    expect(() => pin.write(1)).toThrow("not configured for output");
  });

  it("reads synchronous external input changes and emits them in order", () => {
    const events: VirtualDeviceState[] = [];
    let inputValue: 0 | 1 = 1;
    const board = new VirtualGpioBoard(
      (state) => events.push(state),
      (pinId) => (pinId === "15" ? inputValue : null),
    );
    const pin = board.openPin("15", "input");

    expect(pin.read()).toBe(1);
    inputValue = 0;
    expect(pin.read()).toBe(0);
    expect(events).toEqual([
      { kind: "gpio-pin", sequence: 1, pinId: "15", mode: "input", value: 1 },
      { kind: "gpio-pin", sequence: 2, pinId: "15", mode: "input", value: 0 },
    ]);
  });

  it("reads ordered analog input changes", () => {
    const events: VirtualDeviceState[] = [];
    let analogValue = 12_345;
    const board = new VirtualGpioBoard(
      (state) => events.push(state),
      () => null,
      (pinId) => (pinId === "26" ? analogValue : null),
    );
    const adc = board.openAdc("26");

    expect(adc.readU16()).toBe(12_345);
    analogValue = 54_321;
    expect(adc.readU16()).toBe(54_321);
    expect(events).toEqual([
      { kind: "adc-channel", sequence: 1, pinId: "26", value: 12_345 },
      { kind: "adc-channel", sequence: 2, pinId: "26", value: 54_321 },
    ]);
  });

  it("rejects analog input values outside read_u16 range", () => {
    const board = new VirtualGpioBoard(
      () => undefined,
      () => null,
      () => 65_536,
    );

    expect(() => board.openAdc("26")).toThrow("integer from 0 to 65535");
  });

  it("forwards output values to an external device port", () => {
    const writes: Array<{ pinId: string; value: 0 | 1 }> = [];
    const board = new VirtualGpioBoard(
      () => undefined,
      () => null,
      () => null,
      (pinId, value) => writes.push({ pinId, value }),
    );
    const led = board.openPin("LED", "output");

    led.write(1);
    led.write(1);
    led.setMode("input");

    expect(writes).toEqual([
      { pinId: "LED", value: 0 },
      { pinId: "LED", value: 1 },
    ]);
  });
});
