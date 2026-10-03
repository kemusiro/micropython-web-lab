export const DEBUGGER_CHANNEL_VERSION = 1 as const;
export const MAX_DEBUGGER_COMMAND_BYTES = 4_096;

const MAGIC = 0x4d574c44;
const HEADER_SLOTS = 4;
const MAGIC_SLOT = 0;
const VERSION_SLOT = 1;
const STATE_SLOT = 2;
const LENGTH_SLOT = 3;
const STATE_IDLE = 0;
const STATE_WAITING = 1;
const STATE_READY = 2;
const HEADER_BYTES = HEADER_SLOTS * Int32Array.BYTES_PER_ELEMENT;

export interface DebuggerChannelTransfer {
  readonly buffer: SharedArrayBuffer;
}

export class SharedDebuggerChannel {
  readonly #buffer: SharedArrayBuffer;
  readonly #controls: Int32Array;
  readonly #bytes: Uint8Array;
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder();

  private constructor(buffer: SharedArrayBuffer) {
    this.#buffer = buffer;
    this.#controls = new Int32Array(buffer, 0, HEADER_SLOTS);
    this.#bytes = new Uint8Array(buffer, HEADER_BYTES);
  }

  static create(): SharedDebuggerChannel | null {
    if (typeof SharedArrayBuffer === "undefined") {
      return null;
    }
    const channel = new SharedDebuggerChannel(
      new SharedArrayBuffer(HEADER_BYTES + MAX_DEBUGGER_COMMAND_BYTES),
    );
    channel.#initialize();
    return channel;
  }

  static attach(transfer: DebuggerChannelTransfer): SharedDebuggerChannel {
    if (!(transfer.buffer instanceof SharedArrayBuffer)) {
      throw new TypeError("Debugger command buffer must be a SharedArrayBuffer.");
    }
    if (transfer.buffer.byteLength !== HEADER_BYTES + MAX_DEBUGGER_COMMAND_BYTES) {
      throw new RangeError("Debugger command buffer has an unexpected size.");
    }
    const channel = new SharedDebuggerChannel(transfer.buffer);
    channel.#validate();
    return channel;
  }

  toTransfer(): DebuggerChannelTransfer {
    return { buffer: this.#buffer };
  }

  reset(): void {
    Atomics.store(this.#controls, LENGTH_SLOT, 0);
    Atomics.store(this.#controls, STATE_SLOT, STATE_IDLE);
  }

  sendCommand(command: string): boolean {
    if (Atomics.load(this.#controls, STATE_SLOT) !== STATE_WAITING) {
      return false;
    }
    const encoded = this.#encoder.encode(command);
    if (encoded.byteLength > MAX_DEBUGGER_COMMAND_BYTES) {
      throw new RangeError(
        `Debugger commands must be at most ${MAX_DEBUGGER_COMMAND_BYTES} UTF-8 bytes.`,
      );
    }
    this.#bytes.fill(0, 0, encoded.byteLength);
    this.#bytes.set(encoded, 0);
    Atomics.store(this.#controls, LENGTH_SLOT, encoded.byteLength);
    Atomics.store(this.#controls, STATE_SLOT, STATE_READY);
    Atomics.notify(this.#controls, STATE_SLOT, 1);
    return true;
  }

  waitForCommand(onWaiting: () => void): string {
    Atomics.store(this.#controls, LENGTH_SLOT, 0);
    Atomics.store(this.#controls, STATE_SLOT, STATE_WAITING);
    onWaiting();
    Atomics.wait(this.#controls, STATE_SLOT, STATE_WAITING);

    if (Atomics.load(this.#controls, STATE_SLOT) !== STATE_READY) {
      throw new Error("Debugger command channel left the waiting state unexpectedly.");
    }
    const length = Atomics.load(this.#controls, LENGTH_SLOT);
    if (length < 0 || length > MAX_DEBUGGER_COMMAND_BYTES) {
      throw new RangeError("Debugger command channel contains an invalid length.");
    }
    const command = this.#decoder.decode(this.#bytes.slice(0, length));
    this.reset();
    return command;
  }

  #initialize(): void {
    Atomics.store(this.#controls, MAGIC_SLOT, MAGIC);
    Atomics.store(this.#controls, VERSION_SLOT, DEBUGGER_CHANNEL_VERSION);
    this.reset();
  }

  #validate(): void {
    if (Atomics.load(this.#controls, MAGIC_SLOT) !== MAGIC) {
      throw new Error("Debugger command buffer has an invalid format marker.");
    }
    if (Atomics.load(this.#controls, VERSION_SLOT) !== DEBUGGER_CHANNEL_VERSION) {
      throw new Error("Debugger command buffer has an unsupported version.");
    }
  }
}
