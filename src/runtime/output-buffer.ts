export const MAX_RUNTIME_OUTPUT_CHARACTERS = 100_000;
export const OUTPUT_CHUNK_CHARACTERS = 4096;

type OutputStream = "stdout" | "stderr";

/** Bound queued output even while synchronous WASM cannot service Worker messages. */
export class RuntimeOutputBuffer {
  #pending = "";
  #stream: OutputStream = "stdout";
  #characters = 0;
  #exhausted = false;

  constructor(
    private readonly emit: (stream: OutputStream, data: string) => void,
    private readonly limitReached: () => void,
  ) {}

  get exhausted(): boolean {
    return this.#exhausted;
  }

  beginOperation(): void {
    this.flush();
    this.#characters = 0;
    this.#exhausted = false;
  }

  write(stream: OutputStream, data: string): void {
    if (this.#exhausted || data.length === 0) {
      return;
    }
    if (stream !== this.#stream) {
      this.flush();
    }
    this.#stream = stream;
    const remaining = MAX_RUNTIME_OUTPUT_CHARACTERS - this.#characters;
    const accepted = data.slice(0, remaining);
    this.#characters += accepted.length;
    for (const character of accepted) {
      this.#pending += character;
      // Flush lines synchronously: a print before a busy GPIO/ADC wait must be visible.
      if (character === "\n" || this.#pending.length >= OUTPUT_CHUNK_CHARACTERS) {
        this.flush();
      }
    }
    if (data.length > remaining) {
      this.flush();
      this.#exhausted = true;
      this.limitReached();
    }
  }

  flush(): void {
    if (this.#pending.length === 0) {
      return;
    }
    const data = this.#pending;
    this.#pending = "";
    this.emit(this.#stream, data);
  }
}
