import type { DeviceClock } from "@micropython-web-lab/device-api";

export class ManualDeviceClock implements DeviceClock {
  #milliseconds: number;

  constructor(initialMilliseconds = 0) {
    assertNonNegativeFinite(initialMilliseconds, "Initial device clock time");
    this.#milliseconds = initialMilliseconds;
  }

  monotonicMilliseconds(): number {
    return this.#milliseconds;
  }

  advance(milliseconds: number): number {
    assertNonNegativeFinite(milliseconds, "Device clock advance");
    const next = this.#milliseconds + milliseconds;
    assertNonNegativeFinite(next, "Advanced device clock time");
    this.#milliseconds = next;
    return this.#milliseconds;
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number.`);
  }
}
