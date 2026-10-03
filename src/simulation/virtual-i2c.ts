export const VIRTUAL_I2C_BUS_ID = 0;
export const VIRTUAL_I2C_REGISTER_DEVICE_ADDRESS = 0x50;
export const MAX_VIRTUAL_I2C_TRANSFER_BYTES = 256;

export type VirtualI2cOperation =
  | "scan"
  | "read"
  | "write"
  | "read-memory"
  | "write-memory";

export interface VirtualI2cTransactionState {
  kind: "i2c-transaction";
  sequence: number;
  busId: number;
  operation: VirtualI2cOperation;
  address?: number;
  memoryAddress?: number;
  byteCount: number;
}

export type VirtualI2cStateHandler = (state: VirtualI2cTransactionState) => void;

export interface VirtualI2cDevice {
  readonly address: number;
  read(byteCount: number): Uint8Array;
  write(data: Uint8Array): void;
  readMemory(memoryAddress: number, byteCount: number): Uint8Array;
  writeMemory(memoryAddress: number, data: Uint8Array): void;
}

export class VirtualRegisterI2cDevice implements VirtualI2cDevice {
  readonly address: number;
  readonly #registers: Uint8Array;
  #pointer = 0;

  constructor(address = VIRTUAL_I2C_REGISTER_DEVICE_ADDRESS, registerCount = 256) {
    assertI2cAddress(address);
    if (!Number.isSafeInteger(registerCount) || registerCount < 1 || registerCount > 65_536) {
      throw new RangeError("Register count must be an integer from 1 to 65536.");
    }
    this.address = address;
    this.#registers = new Uint8Array(registerCount);
  }

  read(byteCount: number): Uint8Array {
    assertTransferLength(byteCount);
    const data = this.#readFrom(this.#pointer, byteCount);
    this.#pointer = this.#advance(this.#pointer, byteCount);
    return data;
  }

  write(data: Uint8Array): void {
    if (data.length === 0) {
      return;
    }
    const memoryAddress = data[0]!;
    this.#assertMemoryAddress(memoryAddress);
    this.#pointer = memoryAddress;
    if (data.length > 1) {
      this.#writeFrom(memoryAddress, data.subarray(1));
      this.#pointer = this.#advance(memoryAddress, data.length - 1);
    }
  }

  readMemory(memoryAddress: number, byteCount: number): Uint8Array {
    this.#assertMemoryAddress(memoryAddress);
    assertTransferLength(byteCount);
    const data = this.#readFrom(memoryAddress, byteCount);
    this.#pointer = this.#advance(memoryAddress, byteCount);
    return data;
  }

  writeMemory(memoryAddress: number, data: Uint8Array): void {
    this.#assertMemoryAddress(memoryAddress);
    this.#writeFrom(memoryAddress, data);
    this.#pointer = this.#advance(memoryAddress, data.length);
  }

  #readFrom(memoryAddress: number, byteCount: number): Uint8Array {
    const result = new Uint8Array(byteCount);
    for (let index = 0; index < byteCount; index += 1) {
      result[index] = this.#registers[this.#advance(memoryAddress, index)]!;
    }
    return result;
  }

  #writeFrom(memoryAddress: number, data: Uint8Array): void {
    assertTransferLength(data.length);
    for (let index = 0; index < data.length; index += 1) {
      this.#registers[this.#advance(memoryAddress, index)] = data[index]!;
    }
  }

  #advance(memoryAddress: number, byteCount: number): number {
    return (memoryAddress + byteCount) % this.#registers.length;
  }

  #assertMemoryAddress(memoryAddress: number): void {
    if (
      !Number.isSafeInteger(memoryAddress) ||
      memoryAddress < 0 ||
      memoryAddress >= this.#registers.length
    ) {
      throw new RangeError(
        `Memory address must be an integer from 0 to ${this.#registers.length - 1}.`,
      );
    }
  }
}

export class VirtualI2cBus {
  readonly id: number;
  readonly #devices = new Map<number, VirtualI2cDevice>();
  readonly #onState: VirtualI2cStateHandler;
  #sequence = 0;

  constructor(id = VIRTUAL_I2C_BUS_ID, onState: VirtualI2cStateHandler = () => undefined) {
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new RangeError("I2C bus id must be a non-negative integer.");
    }
    this.id = id;
    this.#onState = onState;
  }

  attach(device: VirtualI2cDevice): void {
    assertI2cAddress(device.address);
    if (this.#devices.has(device.address)) {
      throw new Error(`I2C address ${formatAddress(device.address)} is already in use.`);
    }
    this.#devices.set(device.address, device);
  }

  scan(): number[] {
    const addresses = [...this.#devices.keys()].sort((left, right) => left - right);
    this.#emit("scan", addresses.length);
    return addresses;
  }

  read(address: number, byteCount: number): Uint8Array {
    assertTransferLength(byteCount);
    const data = this.#requiredDevice(address).read(byteCount);
    this.#emit("read", data.length, address);
    return data;
  }

  write(address: number, data: Uint8Array): number {
    assertTransferLength(data.length);
    this.#requiredDevice(address).write(data);
    this.#emit("write", data.length, address);
    return data.length;
  }

  readMemory(address: number, memoryAddress: number, byteCount: number): Uint8Array {
    assertTransferLength(byteCount);
    const data = this.#requiredDevice(address).readMemory(memoryAddress, byteCount);
    this.#emit("read-memory", data.length, address, memoryAddress);
    return data;
  }

  writeMemory(address: number, memoryAddress: number, data: Uint8Array): void {
    assertTransferLength(data.length);
    this.#requiredDevice(address).writeMemory(memoryAddress, data);
    this.#emit("write-memory", data.length, address, memoryAddress);
  }

  #requiredDevice(address: number): VirtualI2cDevice {
    assertI2cAddress(address);
    const device = this.#devices.get(address);
    if (device === undefined) {
      throw new Error(`No virtual I2C device at address ${formatAddress(address)}.`);
    }
    return device;
  }

  #emit(
    operation: VirtualI2cOperation,
    byteCount: number,
    address?: number,
    memoryAddress?: number,
  ): void {
    this.#sequence += 1;
    this.#onState({
      kind: "i2c-transaction",
      sequence: this.#sequence,
      busId: this.id,
      operation,
      ...(address === undefined ? {} : { address }),
      ...(memoryAddress === undefined ? {} : { memoryAddress }),
      byteCount,
    });
  }
}

function assertI2cAddress(address: number): void {
  if (!Number.isSafeInteger(address) || address < 0x08 || address > 0x77) {
    throw new RangeError("I2C address must be a 7-bit device address from 0x08 to 0x77.");
  }
}

function assertTransferLength(byteCount: number): void {
  if (
    !Number.isSafeInteger(byteCount) ||
    byteCount < 0 ||
    byteCount > MAX_VIRTUAL_I2C_TRANSFER_BYTES
  ) {
    throw new RangeError(
      `I2C transfer length must be an integer from 0 to ${MAX_VIRTUAL_I2C_TRANSFER_BYTES}.`,
    );
  }
}

function formatAddress(address: number): string {
  return `0x${address.toString(16).padStart(2, "0")}`;
}
