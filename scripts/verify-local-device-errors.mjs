import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  LocalDeviceWorkspaceError,
  loadLocalDeviceWorkspace,
} from "./lib/local-device-workspace.mjs";

const fixtureDirectory = path.resolve("fixtures/devices/local-bme280");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "web-lab-local-errors-"));

try {
  await expectWorkspaceError(
    "LOCAL_SOURCE_INVALID",
    configuration({ expectedVersion: "9.9.9", basePreset: "pico-2-w-board-only-v1" }),
  );
  await expectWorkspaceError(
    "LOCAL_RESOURCE_CONFLICT",
    configuration({ expectedVersion: "0.1.0", basePreset: "pico-2-w-managed-v1" }),
  );
  console.log("Local device startup error verification passed.");
} finally {
  await rm(temporaryDirectory, { recursive: true });
}

async function expectWorkspaceError(expectedCode, value) {
  const configurationPath = path.join(temporaryDirectory, `${expectedCode}.json`);
  await writeFile(configurationPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await loadLocalDeviceWorkspace(configurationPath, { checkSources: false });
  } catch (error) {
    if (error instanceof LocalDeviceWorkspaceError && error.code === expectedCode) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected ${expectedCode}, but the local workspace was accepted.`);
}

function configuration({ expectedVersion, basePreset }) {
  return {
    schemaVersion: 1,
    boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
    basePreset,
    sources: [
      {
        sourceId: "conflicting-bme280",
        source: { kind: "path", directory: fixtureDirectory },
        expected: {
          deviceId: "org.example.local-bme280",
          deviceVersion: expectedVersion,
        },
      },
    ],
    instances: [
      {
        instanceId: "local-bme280-conflict",
        sourceId: "conflicting-bme280",
        ports: [
          {
            portId: "i2c",
            endpoint: { kind: "i2c", controller: 0, address: 118 },
          },
        ],
      },
    ],
  };
}
