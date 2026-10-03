import {
  DEFAULT_DEVICE_LIMITS,
  type I2cTargetPort,
  type UartConfiguration,
  type UartPeerPort,
} from "../device-api/types";
import type { SharedDeviceInputs } from "./shared-device-inputs";
import type { VirtualI2cBus, VirtualI2cDevice } from "./virtual-i2c";

export function attachI2cTargetPort(bus: VirtualI2cBus, port: I2cTargetPort): void {
  for (const address of port.addresses) {
    bus.attach(new DevicePortI2cAdapter(address, port));
  }
}

export function synchronizeI2cTargetPort(
  port: I2cTargetPort,
  synchronize: () => void,
): I2cTargetPort {
  return Object.freeze({
    kind: "i2c-target" as const,
    addresses: Object.freeze([...port.addresses]),
    read(byteCount: number): Uint8Array {
      synchronize();
      return port.read(byteCount);
    },
    write(data: Uint8Array): void {
      synchronize();
      port.write(data);
    },
    readMemory(memoryAddress: number, byteCount: number): Uint8Array {
      synchronize();
      return port.readMemory(memoryAddress, byteCount);
    },
    writeMemory(memoryAddress: number, data: Uint8Array): void {
      synchronize();
      port.writeMemory(memoryAddress, data);
    },
  });
}

export function connectSharedUartInput(
  peer: UartPeerPort,
  inputs: SharedDeviceInputs | null,
  queueId: string,
  maxBufferedBytes = DEFAULT_DEVICE_LIMITS.maxUartBufferedBytes,
): UartPeerPort {
  if (inputs === null) {
    return peer;
  }
  return Object.freeze({
    kind: "uart-peer" as const,
    configure(configuration: UartConfiguration): void {
      peer.configure(configuration);
    },
    writeFromBoard(data: Uint8Array): number {
      const pending = combinedAvailable(peer, inputs, queueId, maxBufferedBytes);
      if (pending + data.length > maxBufferedBytes) {
        throw new RangeError(
          `UART receive data would exceed the ${maxBufferedBytes}-byte combined buffer limit.`,
        );
      }
      return peer.writeFromBoard(data);
    },
    availableToBoard(): number {
      return combinedAvailable(peer, inputs, queueId, maxBufferedBytes);
    },
    readForBoard(maxBytes: number): Uint8Array {
      assertUartTransferLength(maxBytes);
      const shared = inputs.dequeue(queueId, Math.min(maxBytes, inputs.available(queueId))).data;
      if (shared.length === maxBytes) {
        return shared;
      }
      const modeled = peer.readForBoard(maxBytes - shared.length);
      if (shared.length === 0) {
        return modeled;
      }
      const result = new Uint8Array(shared.length + modeled.length);
      result.set(shared);
      result.set(modeled, shared.length);
      return result;
    },
  });
}

export function synchronizeUartPeer(
  peer: UartPeerPort,
  synchronize: () => void,
): UartPeerPort {
  return Object.freeze({
    kind: "uart-peer" as const,
    configure(configuration: UartConfiguration): void {
      peer.configure(configuration);
    },
    writeFromBoard(data: Uint8Array): number {
      synchronize();
      return peer.writeFromBoard(data);
    },
    availableToBoard(): number {
      synchronize();
      return peer.availableToBoard();
    },
    readForBoard(maxBytes: number): Uint8Array {
      synchronize();
      return peer.readForBoard(maxBytes);
    },
  });
}

function combinedAvailable(
  peer: UartPeerPort,
  inputs: SharedDeviceInputs,
  queueId: string,
  maximum: number,
): number {
  const available = inputs.available(queueId) + peer.availableToBoard();
  if (available > maximum) {
    throw new RangeError(`UART receive data exceeds the ${maximum}-byte combined buffer limit.`);
  }
  return available;
}

function assertUartTransferLength(byteCount: number): void {
  if (
    !Number.isSafeInteger(byteCount) ||
    byteCount < 0 ||
    byteCount > DEFAULT_DEVICE_LIMITS.maxUartTransferBytes
  ) {
    throw new RangeError(
      `UART transfer length must be an integer from 0 to ${DEFAULT_DEVICE_LIMITS.maxUartTransferBytes}.`,
    );
  }
}

class DevicePortI2cAdapter implements VirtualI2cDevice {
  readonly address: number;
  readonly #port: I2cTargetPort;

  constructor(address: number, port: I2cTargetPort) {
    this.address = address;
    this.#port = port;
  }

  read(byteCount: number): Uint8Array {
    return this.#port.read(byteCount);
  }

  write(data: Uint8Array): void {
    this.#port.write(data);
  }

  readMemory(memoryAddress: number, byteCount: number): Uint8Array {
    return this.#port.readMemory(memoryAddress, byteCount);
  }

  writeMemory(memoryAddress: number, data: Uint8Array): void {
    this.#port.writeMemory(memoryAddress, data);
  }
}
