import { describe, expect, it } from "vitest";

import type { SpiConfiguration, SpiTargetPort } from "../device-api/types";
import { VirtualSpiBus } from "./virtual-spi";

const CONFIGURATION: SpiConfiguration = {
  baudrate: 8_000_000,
  polarity: 0,
  phase: 0,
  firstBit: "msb",
  bits: 8,
};

describe("Virtual SPI bus", () => {
  it("routes to the selected target and otherwise uses the legacy fallback", () => {
    const bus = new VirtualSpiBus(0);
    let selected = false;
    const fallback = target(0x11);
    const display = target(0x22);
    bus.attach({ id: "fallback", port: fallback.port, fallback: true });
    bus.attach({ id: "display", port: display.port, isSelected: () => selected });

    bus.configure(CONFIGURATION);
    expect([...bus.transfer(Uint8Array.of(1, 2))]).toEqual([0x11, 0x11]);
    selected = true;
    expect([...bus.transfer(Uint8Array.of(1, 2))]).toEqual([0x22, 0x22]);
    expect(fallback.configurations).toEqual([CONFIGURATION]);
    expect(display.configurations).toEqual([CONFIGURATION]);
  });

  it("rejects simultaneous chip selections", () => {
    const bus = new VirtualSpiBus(0);
    bus.attach({ id: "first", port: target(1).port, isSelected: () => true });
    bus.attach({ id: "second", port: target(2).port, isSelected: () => true });

    expect(() => bus.transfer(Uint8Array.of(0))).toThrow("multiple selected targets");
  });
});

function target(fill: number): {
  port: SpiTargetPort;
  configurations: SpiConfiguration[];
} {
  const configurations: SpiConfiguration[] = [];
  return {
    configurations,
    port: {
      kind: "spi-target",
      configure(configuration): void {
        configurations.push(configuration);
      },
      transfer(data): Uint8Array {
        return new Uint8Array(data.length).fill(fill);
      },
    },
  };
}
