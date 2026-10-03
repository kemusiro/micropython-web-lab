import { describe, expect, it } from "vitest";

import { scenarioExampleSource } from "./scenario-examples";

describe("scenario examples", () => {
  it("combines multiple devices in every gallery example", () => {
    expect(scenarioExampleSource("button-rgb-controller")).toMatch(/Pin\(15.*Pin\(18/s);
    expect(scenarioExampleSource("analog-rgb-mixer")).toMatch(/ADC\(Pin\(26\).*PWM\(Pin\(18\)/s);
    expect(scenarioExampleSource("environment-dashboard")).toMatch(/I2C\(0.*SPI\(/s);
    expect(scenarioExampleSource("gps-rgb-beacon")).toMatch(/UART\(0.*PWM\(Pin\(18\)/s);
  });

  it("rejects unknown scenario ids", () => {
    expect(scenarioExampleSource("unknown")).toBeNull();
  });

  it("uses the currently connected push-button GPIO", () => {
    expect(scenarioExampleSource("button-rgb-controller", { buttonPin: 13 })).toMatch(
      /button = Pin\(13,.*press GPIO 13/s,
    );
  });
});
