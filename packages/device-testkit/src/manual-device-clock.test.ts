import { describe, expect, it } from "vitest";

import { ManualDeviceClock } from "./manual-device-clock";

describe("ManualDeviceClock", () => {
  it("advances deterministically without depending on wall-clock time", () => {
    const clock = new ManualDeviceClock(100.5);
    expect(clock.monotonicMilliseconds()).toBe(100.5);
    expect(clock.advance(899.5)).toBe(1_000);
    expect(clock.monotonicMilliseconds()).toBe(1_000);
  });

  it("rejects negative and non-finite values", () => {
    expect(() => new ManualDeviceClock(-1)).toThrow("non-negative finite");
    const clock = new ManualDeviceClock();
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow("non-negative finite");
  });
});
