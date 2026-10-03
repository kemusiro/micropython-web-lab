import { describe, expect, it } from "vitest";

import {
  createLocalConnectionGraph,
  parseLocalDeviceConfiguration,
} from "./local-device-configuration";

describe("Local Device Configuration v1", () => {
  it("parses multiple sources and instances into a connection graph", () => {
    const configuration = parseLocalDeviceConfiguration(JSON.stringify(validConfiguration()));
    const graph = createLocalConnectionGraph(configuration);

    expect(configuration.basePreset).toBe("pico-2-w-board-only-v1");
    expect(configuration.sources).toHaveLength(2);
    expect(graph.devices.map((device) => device.instanceId)).toEqual(["sensor", "display"]);
    expect(graph.devices[1]?.ports[0]?.endpoint).toEqual({
      kind: "spi",
      controller: 0,
      selectPort: "cs",
      activeLevel: 0,
    });
  });

  it("rejects unknown fields, duplicate ids, and missing source references", () => {
    const unknown = { ...validConfiguration(), extra: true };
    expect(() => parseLocalDeviceConfiguration(JSON.stringify(unknown))).toThrow(
      "web-lab.local.json.extra",
    );

    const duplicate = validConfiguration();
    duplicate.sources[1]!.sourceId = duplicate.sources[0]!.sourceId;
    expect(() => parseLocalDeviceConfiguration(JSON.stringify(duplicate))).toThrow("duplicates");

    const missing = validConfiguration();
    missing.instances[0]!.sourceId = "missing";
    expect(() => parseLocalDeviceConfiguration(JSON.stringify(missing))).toThrow(
      "does not reference",
    );
  });

  it("rejects unused sources and malformed connection endpoints", () => {
    const unused = validConfiguration();
    unused.instances = [unused.instances[0]!];
    expect(() => parseLocalDeviceConfiguration(JSON.stringify(unused))).toThrow("unused source");

    const malformed = validConfiguration();
    malformed.instances[1]!.ports[0]!.endpoint = {
      kind: "spi",
      controller: 0,
      activeLevel: 0,
    };
    expect(() => parseLocalDeviceConfiguration(JSON.stringify(malformed))).toThrow(
      "exactly one of selectPort or fallback",
    );
  });
});

function validConfiguration(): MutableConfiguration {
  return {
    schemaVersion: 1,
    boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
    basePreset: "pico-2-w-board-only-v1",
    sources: [
      {
        sourceId: "sensor-source",
        source: { kind: "path", directory: "../sensor" },
        expected: { deviceId: "org.example.sensor", deviceVersion: "0.1.0" },
      },
      {
        sourceId: "display-source",
        source: { kind: "path", directory: "../display" },
        expected: { deviceId: "org.example.display", deviceVersion: "0.1.0" },
      },
    ],
    instances: [
      {
        instanceId: "sensor",
        sourceId: "sensor-source",
        ports: [
          { portId: "i2c", endpoint: { kind: "i2c", controller: 0, address: 0x76 } },
        ],
      },
      {
        instanceId: "display",
        sourceId: "display-source",
        ports: [
          {
            portId: "spi",
            endpoint: { kind: "spi", controller: 0, selectPort: "cs", activeLevel: 0 },
          },
          { portId: "cs", endpoint: { kind: "gpio", pin: "GP5" } },
        ],
      },
    ],
  };
}

interface MutableConfiguration {
  schemaVersion: number;
  boardProfile: { id: string; version: number };
  basePreset: string;
  sources: Array<{
    sourceId: string;
    source: { kind: string; directory: string };
    expected: { deviceId: string; deviceVersion: string };
  }>;
  instances: Array<{
    instanceId: string;
    sourceId: string;
    ports: Array<{ portId: string; endpoint: Record<string, unknown> }>;
  }>;
}
