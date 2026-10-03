import { describe, expect, it } from "vitest";

import { runPico2WConformance } from "@micropython-web-lab/device-testkit";

import definition, { I2C_ADDRESS } from "../src/device";

describe("I2C register device template", () => {
  it("passes the Pico 2 W conformance test kit", () => {
    expect(runPico2WConformance(definition)).toMatchObject({ ok: true, issues: [] });
  });

  it("stores and reads register data synchronously", () => {
    const model = definition.create({
      instanceId: "template-test",
      board: {
        profileId: "raspberry-pi-pico-2-w-v1",
        profileVersion: 1,
        capabilities: ["i2c-controller-v1"],
      },
      limits: {
        maxI2cTransferBytes: 256,
        maxSpiTransferBytes: 256,
        maxUartTransferBytes: 256,
        maxUartBufferedBytes: 4_096,
        maxStateBytes: 16_384,
      },
      emitState: () => undefined,
    });
    const port = model.ports.i2c;
    expect(port?.kind).toBe("i2c-target");
    if (port?.kind !== "i2c-target") {
      throw new Error("Template did not create its I2C port.");
    }

    expect(port.addresses).toEqual([I2C_ADDRESS]);
    port.writeMemory(0x10, Uint8Array.of(65, 66, 67));
    expect(port.readMemory(0x10, 3)).toEqual(Uint8Array.of(65, 66, 67));
  });
});
