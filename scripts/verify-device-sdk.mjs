import { readFile } from "node:fs/promises";

const sdk = await import("../packages/device-api/dist/index.js");
const testkit = await import("../packages/device-testkit/dist/index.js");
const manifest = sdk.validateDeviceManifest({
  schemaVersion: 1,
  id: "org.example.javascript-device",
  version: "1.0.0",
  deviceApiVersion: 1,
  name: "JavaScript Device",
  description: "JavaScript ESM consumer check",
  license: "MIT",
  entrypoint: "./dist/device.js",
  requires: { boardCapabilities: ["i2c-controller-v1"] },
  ports: [{ id: "i2c", kind: "i2c-target", defaultAddress: 0x48 }],
});
if (manifest.id !== "org.example.javascript-device") {
  throw new Error("Device SDK JavaScript export returned an unexpected manifest.");
}
const report = testkit.runPico2WConformance({
  manifest,
  create(context) {
    context.emitState({ ready: true });
    return {
      ports: {
        i2c: {
          kind: "i2c-target",
          addresses: [0x48],
          read: (count) => new Uint8Array(count),
          write: () => undefined,
          readMemory: (_address, count) => new Uint8Array(count),
          writeMemory: () => undefined,
        },
      },
      reset: () => undefined,
    };
  },
});
if (!report.ok) {
  throw new Error(`Device test kit JavaScript export failed: ${JSON.stringify(report.issues)}`);
}

const packageFiles = [
  new URL("../packages/device-api/package.json", import.meta.url),
  new URL("../packages/device-testkit/package.json", import.meta.url),
];
for (const packageFile of packageFiles) {
  const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
  if (packageJson.private !== true || packageJson.license !== "MIT") {
    throw new Error(
      `${packageJson.name} must remain private and MIT-licensed until the publication release.`,
    );
  }
}

console.log("Device SDK and test kit verified for TypeScript and JavaScript (private preview)");
