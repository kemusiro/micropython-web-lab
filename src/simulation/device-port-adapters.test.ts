import { describe, expect, it } from "vitest";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { DeviceHost } from "../device-api/device-host";
import {
  createReferenceI2cRegisterDefinition,
  createReferenceUartEchoDefinition,
} from "../device-api/reference-devices";
import {
  attachI2cTargetPort,
  connectSharedUartInput,
  synchronizeI2cTargetPort,
  synchronizeUartPeer,
} from "./device-port-adapters";
import {
  SharedDeviceInputs,
  UART_RECEIVE_INPUT_ID,
  WEB_LAB_DEVICE_INPUT_LAYOUT,
} from "./shared-device-inputs";
import { VirtualI2cBus } from "./virtual-i2c";

describe("Device port simulation adapters", () => {
  it("synchronizes shared state before every I2C operation", () => {
    const profile = RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
    const host = new DeviceHost({
      profileId: profile.id,
      profileVersion: profile.version,
      capabilities: profile.capabilities,
    });
    host.create("register", createReferenceI2cRegisterDefinition(0x48));
    let synchronizationCount = 0;
    const port = synchronizeI2cTargetPort(
      host.getPort("register", "i2c", "i2c-target"),
      () => {
        synchronizationCount += 1;
      },
    );

    port.writeMemory(0x10, Uint8Array.of(1));
    port.readMemory(0x10, 1);
    port.write(Uint8Array.of(0x10));
    port.read(1);
    expect(synchronizationCount).toBe(4);
  });

  it("attaches every Device API I2C address to the existing machine bus", () => {
    const profile = RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
    const host = new DeviceHost({
      profileId: profile.id,
      profileVersion: profile.version,
      capabilities: profile.capabilities,
    });
    host.create("register", createReferenceI2cRegisterDefinition());
    const bus = new VirtualI2cBus();
    attachI2cTargetPort(bus, host.getPort("register", "i2c", "i2c-target"));

    expect(bus.scan()).toEqual([0x50]);
    bus.writeMemory(0x50, 0x20, Uint8Array.of(0x41, 0x42));
    expect(bus.readMemory(0x50, 0x20, 2)).toEqual(Uint8Array.of(0x41, 0x42));
  });

  it("merges ordered shared UART input without exposing shared memory to the device", () => {
    const profile = RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
    const host = new DeviceHost({
      profileId: profile.id,
      profileVersion: profile.version,
      capabilities: profile.capabilities,
    });
    host.create("uart", createReferenceUartEchoDefinition());
    const inputs = SharedDeviceInputs.create(WEB_LAB_DEVICE_INPUT_LAYOUT)!;
    const peer = connectSharedUartInput(
      host.getPort("uart", "uart", "uart-peer"),
      inputs,
      UART_RECEIVE_INPUT_ID,
    );
    inputs.enqueue(UART_RECEIVE_INPUT_ID, Uint8Array.of(65, 66));
    expect(peer.writeFromBoard(Uint8Array.of(67))).toBe(1);

    expect(peer.availableToBoard()).toBe(3);
    expect(peer.readForBoard(2)).toEqual(Uint8Array.of(65, 66));
    expect(peer.readForBoard(2)).toEqual(Uint8Array.of(67));
  });

  it("synchronizes external device state before UART board operations", () => {
    const profile = RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
    const host = new DeviceHost({
      profileId: profile.id,
      profileVersion: profile.version,
      capabilities: profile.capabilities,
    });
    host.create("uart", createReferenceUartEchoDefinition());
    let synchronizationCount = 0;
    const peer = synchronizeUartPeer(
      host.getPort("uart", "uart", "uart-peer"),
      () => {
        synchronizationCount += 1;
      },
    );
    peer.configure({ baudrate: 9_600, bits: 8, parity: "none", stop: 1 });
    peer.writeFromBoard(Uint8Array.of(1));
    peer.availableToBoard();
    peer.readForBoard(1);
    expect(synchronizationCount).toBe(3);
  });

  it("rejects combined UART buffering beyond the configured limit", () => {
    const profile = RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
    const host = new DeviceHost({
      profileId: profile.id,
      profileVersion: profile.version,
      capabilities: profile.capabilities,
    });
    host.create("uart", createReferenceUartEchoDefinition());
    const inputs = SharedDeviceInputs.create(WEB_LAB_DEVICE_INPUT_LAYOUT)!;
    const peer = connectSharedUartInput(
      host.getPort("uart", "uart", "uart-peer"),
      inputs,
      UART_RECEIVE_INPUT_ID,
      3,
    );
    inputs.enqueue(UART_RECEIVE_INPUT_ID, Uint8Array.of(1, 2));

    expect(() => peer.writeFromBoard(Uint8Array.of(3, 4))).toThrow("combined buffer limit");
    expect(peer.readForBoard(2)).toEqual(Uint8Array.of(1, 2));
  });
});
