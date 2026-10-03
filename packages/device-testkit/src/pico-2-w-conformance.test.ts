import { describe, expect, it } from "vitest";

import type {
  DeviceContext,
  DeviceDefinition,
  DeviceModel,
  DevicePort,
  DevicePortKind,
} from "@micropython-web-lab/device-api";

import { runPico2WConformance } from "./pico-2-w-conformance";

const CAPABILITIES: Record<DevicePortKind, string> = {
  "gpio-observer": "digital-gpio-v1",
  "gpio-driver": "digital-gpio-v1",
  "adc-source": "adc-input-v1",
  "i2c-target": "i2c-controller-v1",
  "spi-target": "spi-controller-v1",
  "uart-peer": "uart-controller-v1",
  "pwm-observer": "pwm-output-v1",
};

describe("Pico 2 W Device API conformance test kit", () => {
  it("accepts conforming fixtures for all seven port kinds without a DOM", () => {
    const kinds = Object.keys(CAPABILITIES) as DevicePortKind[];
    for (const kind of kinds) {
      const report = runPico2WConformance(definition(kind, validPort(kind)));
      expect(report, kind).toMatchObject({ ok: true, issues: [] });
      expect(report.states, kind).toEqual([{ ready: true }]);
    }
  });

  it("reports nonconforming behavior for all seven port kinds", () => {
    const invalidPorts: Record<DevicePortKind, DevicePort> = {
      "gpio-observer": {
        kind: "gpio-observer",
        write: (() => Promise.resolve()) as never,
      },
      "gpio-driver": { kind: "gpio-driver", read: () => 2 as never },
      "adc-source": { kind: "adc-source", readU16: () => 65_536 },
      "i2c-target": {
        kind: "i2c-target",
        addresses: [0x78],
        read: (count) => new Uint8Array(count),
        write: () => undefined,
        readMemory: (_address, count) => new Uint8Array(count),
        writeMemory: () => undefined,
      },
      "spi-target": {
        kind: "spi-target",
        configure: () => undefined,
        transfer: () => new Uint8Array(),
      },
      "uart-peer": {
        kind: "uart-peer",
        configure: () => undefined,
        writeFromBoard: (data) => data.length,
        availableToBoard: () => 4_097,
        readForBoard: (count) => new Uint8Array(count),
      },
      "pwm-observer": {
        kind: "pwm-observer",
        update: (() => Promise.resolve()) as never,
      },
    };

    for (const [kind, port] of Object.entries(invalidPorts) as Array<
      [DevicePortKind, DevicePort]
    >) {
      const report = runPico2WConformance(definition(kind, port));
      expect(report.ok, kind).toBe(false);
      expect(report.issues[0]?.code, kind).toBe("port:port");
    }
  });

  it("rejects unsupported capabilities, bad state, and asynchronous lifecycle methods", () => {
    const unsupported = definition("gpio-driver", validPort("gpio-driver"));
    const unsupportedCapability: DeviceDefinition = {
      ...unsupported,
      manifest: {
        ...unsupported.manifest,
        requires: { boardCapabilities: ["future-board-v1"] },
      },
    };
    expect(runPico2WConformance(unsupportedCapability).issues).toContainEqual({
      code: "board-capability",
      message: "Pico 2 W test host does not provide future-board-v1.",
    });

    const badState = definition("gpio-driver", validPort("gpio-driver"), (context) => {
      context.emitState({ nested: {} } as never);
    });
    expect(runPico2WConformance(badState).issues[0]?.message).toContain("scalar");

    const asyncReset = definition("gpio-driver", validPort("gpio-driver"));
    asyncReset.create = () => ({
      ports: { port: validPort("gpio-driver") },
      reset: (() => Promise.resolve()) as never,
    });
    expect(runPico2WConformance(asyncReset).issues[0]?.message).toContain("synchronous");
  });
});

function definition(
  kind: DevicePortKind,
  port: DevicePort,
  afterCreate: (context: DeviceContext) => void = () => undefined,
): DeviceDefinition {
  return {
    manifest: {
      schemaVersion: 1,
      id: `org.example.${kind}`,
      version: "1.0.0",
      deviceApiVersion: 1,
      name: `Test ${kind}`,
      description: `Conformance fixture for ${kind}`,
      license: "MIT",
      entrypoint: "./dist/device.js",
      requires: { boardCapabilities: [CAPABILITIES[kind]] },
      ports: [{ id: "port", kind }],
    },
    create(context): DeviceModel {
      context.emitState({ ready: true });
      afterCreate(context);
      return { ports: { port }, reset: () => undefined };
    },
  };
}

function validPort(kind: DevicePortKind): DevicePort {
  switch (kind) {
    case "gpio-observer":
      return { kind, write: () => undefined };
    case "gpio-driver":
      return { kind, read: () => 1 };
    case "adc-source":
      return { kind, readU16: () => 32_768 };
    case "i2c-target":
      return {
        kind,
        addresses: [0x48],
        read: (count) => new Uint8Array(count),
        write: () => undefined,
        readMemory: (_address, count) => new Uint8Array(count),
        writeMemory: () => undefined,
      };
    case "spi-target":
      return {
        kind,
        configure: () => undefined,
        transfer: (data) => new Uint8Array(data.length),
      };
    case "uart-peer":
      return {
        kind,
        configure: () => undefined,
        writeFromBoard: (data) => data.length,
        availableToBoard: () => 0,
        readForBoard: (count) => new Uint8Array(count),
      };
    case "pwm-observer":
      return { kind, update: () => undefined };
  }
}
