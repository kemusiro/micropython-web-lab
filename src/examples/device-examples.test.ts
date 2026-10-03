import { describe, expect, it } from "vitest";

import { deviceExampleSource } from "./device-examples";

describe("device examples", () => {
  it("uses the currently connected push-button GPIO", () => {
    expect(deviceExampleSource("button-gp15", { buttonPin: 13 })).toContain(
      "button = Pin(13, Pin.IN, Pin.PULL_UP)",
    );
  });
});
