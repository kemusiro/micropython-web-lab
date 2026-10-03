import { describe, expect, it } from "vitest";

import {
  ANALOG_VALUE_INPUT_ID,
  BME280_HUMIDITY_INPUT_ID,
  BME280_PRESSURE_INPUT_ID,
  BME280_TEMPERATURE_INPUT_ID,
  BUTTON_PRESSED_INPUT_ID,
  DEFAULT_ANALOG_INPUT_VALUE,
  SharedDeviceInputs,
  SharedInputQueueOverflowError,
  UART_RECEIVE_INPUT_ID,
  WEB_LAB_DEVICE_INPUT_LAYOUT,
  type SharedDeviceInputLayout,
} from "./shared-device-inputs";

describe("SharedDeviceInputs", () => {
  it("shares independently versioned scalar values", () => {
    const mainInputs = SharedDeviceInputs.create(WEB_LAB_DEVICE_INPUT_LAYOUT)!;
    const workerInputs = SharedDeviceInputs.attach(
      mainInputs.buffer,
      WEB_LAB_DEVICE_INPUT_LAYOUT,
    );

    expect(workerInputs.readScalar(BUTTON_PRESSED_INPUT_ID)).toEqual({
      value: 0,
      version: 1,
    });
    expect(workerInputs.readScalar(ANALOG_VALUE_INPUT_ID)).toEqual({
      value: DEFAULT_ANALOG_INPUT_VALUE,
      version: 1,
    });
    expect(workerInputs.readScalar(BME280_TEMPERATURE_INPUT_ID).value).toBe(25);
    expect(workerInputs.readScalar(BME280_HUMIDITY_INPUT_ID).value).toBe(50);
    expect(workerInputs.readScalar(BME280_PRESSURE_INPUT_ID).value).toBe(1_013);
    expect(mainInputs.setScalar(BUTTON_PRESSED_INPUT_ID, 1)).toBe(2);
    expect(workerInputs.readScalar(BUTTON_PRESSED_INPUT_ID)).toEqual({
      value: 1,
      version: 2,
    });
    expect(workerInputs.readScalar(ANALOG_VALUE_INPUT_ID).version).toBe(1);
  });

  it("validates scalar channel ranges and ids", () => {
    const inputs = SharedDeviceInputs.create(WEB_LAB_DEVICE_INPUT_LAYOUT)!;

    expect(() => inputs.setScalar(BUTTON_PRESSED_INPUT_ID, 2)).toThrow("0 to 1");
    expect(() => inputs.setScalar(ANALOG_VALUE_INPUT_ID, 65_536)).toThrow("65535");
    expect(() => inputs.setScalar(BME280_TEMPERATURE_INPUT_ID, -41)).toThrow("-40 to 85");
    expect(() => inputs.setScalar(BME280_HUMIDITY_INPUT_ID, 101)).toThrow("0 to 100");
    expect(() => inputs.setScalar(BME280_PRESSURE_INPUT_ID, 1_101)).toThrow("300 to 1100");
    expect(() => inputs.readScalar("missing.value")).toThrow("Unknown shared scalar");
  });

  it("preserves queue order across wraparound and reports byte sequences", () => {
    const layout = queueLayout(5);
    const producer = SharedDeviceInputs.create(layout)!;
    const consumer = SharedDeviceInputs.attach(producer.buffer, layout);

    expect(producer.enqueue("uart.rx", Uint8Array.of(1, 2, 3, 4))).toEqual({
      byteCount: 4,
      startSequence: 0,
      endSequence: 4,
    });
    expect(consumer.dequeue("uart.rx", 3)).toEqual({
      data: Uint8Array.of(1, 2, 3),
      startSequence: 0,
      endSequence: 3,
    });
    expect(producer.enqueue("uart.rx", Uint8Array.of(5, 6, 7))).toEqual({
      byteCount: 3,
      startSequence: 4,
      endSequence: 7,
    });
    expect(consumer.available("uart.rx")).toBe(4);
    expect(consumer.dequeue("uart.rx", 5)).toEqual({
      data: Uint8Array.of(4, 5, 6, 7),
      startSequence: 3,
      endSequence: 7,
    });
  });

  it("rejects queue overflow without discarding existing bytes", () => {
    const inputs = SharedDeviceInputs.create(queueLayout(4))!;
    inputs.enqueue("uart.rx", Uint8Array.of(1, 2, 3));

    expect(() => inputs.enqueue("uart.rx", Uint8Array.of(4, 5))).toThrow(
      SharedInputQueueOverflowError,
    );
    expect(inputs.available("uart.rx")).toBe(3);
    expect(inputs.dequeue("uart.rx", 4).data).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("transfers the standard layout with its buffer", () => {
    const inputs = SharedDeviceInputs.create(WEB_LAB_DEVICE_INPUT_LAYOUT)!;

    expect(inputs.toTransfer()).toEqual({
      buffer: inputs.buffer,
      layout: inputs.layout,
    });
    expect(inputs.available(UART_RECEIVE_INPUT_ID)).toBe(0);
  });

  it("rejects mismatched buffers and layouts", () => {
    const layout = queueLayout(8);
    const inputs = SharedDeviceInputs.create(layout)!;
    const changedLayout = queueLayout(7);
    const reorderedFields: SharedDeviceInputLayout = {
      version: 1,
      scalarInputs: [],
      queueInputs: [{ capacity: 8, id: "uart.rx" }],
    };

    expect(() => SharedDeviceInputs.attach(new SharedArrayBuffer(8), layout)).toThrow(
      "Device input buffer must be",
    );
    expect(() => SharedDeviceInputs.attach(inputs.buffer, changedLayout)).toThrow(
      "Device input buffer must be",
    );
    expect(SharedDeviceInputs.attach(inputs.buffer, reorderedFields).available("uart.rx")).toBe(0);
    const sameSizeDifferentId: SharedDeviceInputLayout = {
      version: 1,
      scalarInputs: [],
      queueInputs: [{ id: "other.rx", capacity: 8 }],
    };
    expect(() => SharedDeviceInputs.attach(inputs.buffer, sameSizeDifferentId)).toThrow(
      "layout does not match",
    );
  });

  it("rejects invalid and duplicate layout channels", () => {
    expect(() =>
      SharedDeviceInputs.create({
        version: 1,
        scalarInputs: [
          { id: "duplicate", initialValue: 0, minimum: 0, maximum: 1 },
        ],
        queueInputs: [{ id: "duplicate", capacity: 8 }],
      }),
    ).toThrow("Duplicate");
    expect(() => SharedDeviceInputs.create(queueLayout(4_097))).toThrow("4096");
  });
});

function queueLayout(capacity: number): SharedDeviceInputLayout {
  return {
    version: 1,
    scalarInputs: [],
    queueInputs: [{ id: "uart.rx", capacity }],
  };
}
