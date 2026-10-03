import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MAX_DEVICE_MANIFEST_BYTES,
  MAX_DEVICE_MANIFEST_PORTS,
  DeviceManifestValidationError,
  parseDeviceManifest,
  validateDeviceManifest,
} from "./manifest";

const VALID_MANIFEST = {
  schemaVersion: 1,
  id: "org.example.temperature-sensor",
  version: "1.2.3-preview.1+test",
  deviceApiVersion: 1,
  name: "Example Temperature Sensor",
  description: "I2C temperature sensor for tests",
  license: "MIT",
  entrypoint: "./dist/device.js",
  requires: { boardCapabilities: ["i2c-controller-v1"] },
  ports: [{ id: "i2c", kind: "i2c-target", defaultAddress: 0x48 }],
} as const;

describe("Device API manifest v1", () => {
  it("validates, copies, and freezes a complete manifest", () => {
    const source = structuredClone(VALID_MANIFEST);
    const manifest = validateDeviceManifest(source);

    source.name = "Changed after validation";
    expect(manifest).toEqual(VALID_MANIFEST);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.requires.boardCapabilities)).toBe(true);
    expect(Object.isFrozen(manifest.ports)).toBe(true);
  });

  it("rejects unknown fields, invalid identifiers, versions, paths, and licenses", () => {
    expect(() => validateDeviceManifest({ ...VALID_MANIFEST, approved: true })).toThrow(
      "device.json.approved",
    );
    expect(() => validateDeviceManifest({ ...VALID_MANIFEST, id: "Example Device" })).toThrow(
      "device.json.id",
    );
    expect(() => validateDeviceManifest({ ...VALID_MANIFEST, version: "v1" })).toThrow(
      "Semantic Versioning",
    );
    expect(() => validateDeviceManifest({ ...VALID_MANIFEST, entrypoint: "../device.js" })).toThrow(
      "without traversal",
    );
    expect(() => validateDeviceManifest({ ...VALID_MANIFEST, license: "MIT OR Apache-2.0" })).toThrow(
      "SPDX license identifier",
    );
  });

  it("validates all seven port kinds and I2C-only default addresses", () => {
    const kinds = [
      "gpio-observer",
      "gpio-driver",
      "adc-source",
      "i2c-target",
      "spi-target",
      "uart-peer",
      "pwm-observer",
    ] as const;
    expect(
      validateDeviceManifest({
        ...VALID_MANIFEST,
        ports: kinds.map((kind, index) => ({ id: `port-${index}`, kind })),
      }).ports.map((port) => port.kind),
    ).toEqual(kinds);
    expect(() =>
      validateDeviceManifest({
        ...VALID_MANIFEST,
        ports: [{ id: "gpio", kind: "gpio-driver", defaultAddress: 0x48 }],
      }),
    ).toThrow("only for an i2c-target");
    expect(() =>
      validateDeviceManifest({
        ...VALID_MANIFEST,
        ports: [{ id: "i2c", kind: "i2c-target", defaultAddress: 0x78 }],
      }),
    ).toThrow("from 8 to 119");
  });

  it("rejects duplicate capabilities and port ids", () => {
    expect(() =>
      validateDeviceManifest({
        ...VALID_MANIFEST,
        requires: { boardCapabilities: ["i2c-controller-v1", "i2c-controller-v1"] },
      }),
    ).toThrow("duplicates identifier");
    expect(() =>
      validateDeviceManifest({
        ...VALID_MANIFEST,
        ports: [VALID_MANIFEST.ports[0], VALID_MANIFEST.ports[0]],
      }),
    ).toThrow("duplicates port id");
  });

  it("parses JSON within the byte limit and reports a stable error path", () => {
    expect(parseDeviceManifest(JSON.stringify(VALID_MANIFEST))).toEqual(VALID_MANIFEST);
    expect(() => parseDeviceManifest("{" )).toThrow("valid JSON");
    expect(() => parseDeviceManifest(`"${"x".repeat(MAX_DEVICE_MANIFEST_BYTES)}"`)).toThrow(
      `${MAX_DEVICE_MANIFEST_BYTES} bytes`,
    );
    try {
      validateDeviceManifest({ ...VALID_MANIFEST, ports: [] });
    } catch (error) {
      expect(error).toBeInstanceOf(DeviceManifestValidationError);
      expect((error as DeviceManifestValidationError).path).toBe("device.json.ports");
    }
  });

  it("keeps the checked-in JSON Schema aligned with validator limits", () => {
    const schema = JSON.parse(
      readFileSync(
        new URL("../schema/device-manifest-v1.schema.json", import.meta.url),
        "utf8",
      ),
    ) as {
      properties: {
        schemaVersion: { const: number };
        deviceApiVersion: { const: number };
        ports: { maxItems: number };
      };
      additionalProperties: boolean;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.schemaVersion.const).toBe(1);
    expect(schema.properties.deviceApiVersion.const).toBe(1);
    expect(schema.properties.ports.maxItems).toBe(MAX_DEVICE_MANIFEST_PORTS);
  });
});
