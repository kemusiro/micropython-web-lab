import {
  validateDeviceManifest,
  type DeviceDefinition,
} from "../dist/index.js";

const manifest = validateDeviceManifest({
  schemaVersion: 1,
  id: "org.example.typed-device",
  version: "1.0.0",
  deviceApiVersion: 1,
  name: "Typed Device",
  description: "TypeScript declaration consumer check",
  license: "MIT",
  entrypoint: "./dist/device.js",
  requires: { boardCapabilities: ["digital-gpio-v1"] },
  ports: [{ id: "output", kind: "gpio-observer" }],
});

export const typedDevice: DeviceDefinition = {
  manifest,
  create() {
    return {
      ports: {
        output: { kind: "gpio-observer", write: () => undefined },
      },
      reset: () => undefined,
    };
  },
};
