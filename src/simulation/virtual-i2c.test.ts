import { describe, expect, it } from "vitest";

import {
  MAX_VIRTUAL_I2C_TRANSFER_BYTES,
  VirtualI2cBus,
  VirtualRegisterI2cDevice,
  type VirtualI2cTransactionState,
} from "./virtual-i2c";

describe("VirtualI2cBus", () => {
  it("scans attached devices in address order and records ordered metadata", () => {
    const states: VirtualI2cTransactionState[] = [];
    const bus = new VirtualI2cBus(0, (state) => states.push(state));
    bus.attach(new VirtualRegisterI2cDevice(0x51));
    bus.attach(new VirtualRegisterI2cDevice(0x50));

    expect(bus.scan()).toEqual([0x50, 0x51]);
    expect(states).toEqual([
      {
        kind: "i2c-transaction",
        sequence: 1,
        busId: 0,
        operation: "scan",
        byteCount: 2,
      },
    ]);
  });

  it("reads and writes register memory without exposing payloads in state events", () => {
    const states: VirtualI2cTransactionState[] = [];
    const bus = new VirtualI2cBus(0, (state) => states.push(state));
    bus.attach(new VirtualRegisterI2cDevice(0x50));

    bus.writeMemory(0x50, 0x10, Uint8Array.of(0x41, 0x42, 0x43));
    expect(bus.readMemory(0x50, 0x10, 3)).toEqual(Uint8Array.of(0x41, 0x42, 0x43));
    expect(states).toEqual([
      {
        kind: "i2c-transaction",
        sequence: 1,
        busId: 0,
        operation: "write-memory",
        address: 0x50,
        memoryAddress: 0x10,
        byteCount: 3,
      },
      {
        kind: "i2c-transaction",
        sequence: 2,
        busId: 0,
        operation: "read-memory",
        address: 0x50,
        memoryAddress: 0x10,
        byteCount: 3,
      },
    ]);
    expect(states.some((state) => "data" in state)).toBe(false);
  });

  it("supports pointer-based transfers and wraps at the end of register memory", () => {
    const bus = new VirtualI2cBus();
    bus.attach(new VirtualRegisterI2cDevice());

    expect(bus.write(0x50, Uint8Array.of(0xfe, 1, 2, 3))).toBe(4);
    expect(bus.readMemory(0x50, 0xfe, 3)).toEqual(Uint8Array.of(1, 2, 3));
    bus.write(0x50, Uint8Array.of(0xfe));
    expect(bus.read(0x50, 3)).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("rejects invalid addresses, duplicates, missing devices, and oversized transfers", () => {
    const bus = new VirtualI2cBus();
    bus.attach(new VirtualRegisterI2cDevice());

    expect(() => bus.attach(new VirtualRegisterI2cDevice())).toThrow("already in use");
    expect(() => new VirtualRegisterI2cDevice(0x07)).toThrow("0x08 to 0x77");
    expect(() => bus.read(0x51, 1)).toThrow("No virtual I2C device");
    expect(() => bus.read(0x50, MAX_VIRTUAL_I2C_TRANSFER_BYTES + 1)).toThrow(
      "transfer length",
    );
  });
});
