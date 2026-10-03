import { spawnSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../../src/board/raspberry-pi-pico-2-w.ts";
import {
  createConnectionPreset,
  mergeConnectionGraphs,
} from "../../src/connections/connection-presets.ts";
import { resolveConnectionGraph } from "../../src/connections/connection-model.ts";
import {
  createLocalConnectionGraph,
  parseLocalDeviceConfiguration,
  validateLocalDeviceConfiguration,
} from "../../src/local-devices/local-device-configuration.ts";

export async function loadLocalDeviceWorkspace(requestedPath, options = {}) {
  const configurationPath = await realpath(path.resolve(requestedPath));
  if (!(await stat(configurationPath)).isFile()) {
    throw workspaceError("LOCAL_CONFIG_INVALID", `${configurationPath} is not a file.`);
  }
  let configuration;
  try {
    configuration = parseLocalDeviceConfiguration(await readFile(configurationPath, "utf8"));
  } catch (error) {
    throw workspaceError("LOCAL_CONFIG_INVALID", messageFrom(error), error);
  }
  return loadValidatedWorkspace(configuration, path.dirname(configurationPath), {
    checkSources: options.checkSources !== false,
    configurationPath,
  });
}

export async function loadLegacyLocalDeviceWorkspace(descriptor) {
  const configuration = validateLocalDeviceConfiguration({
    schemaVersion: 1,
    boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
    basePreset: "pico-2-w-managed-v1",
    sources: [
      {
        sourceId: "legacy-device-source",
        source: { kind: "path", directory: descriptor.directory },
        expected: {
          deviceId: descriptor.manifest.id,
          deviceVersion: descriptor.manifest.version,
        },
      },
    ],
    instances: [
      {
        instanceId: "local-device",
        sourceId: "legacy-device-source",
        ports: descriptor.manifest.ports.map((port) => {
          if (port.kind !== "i2c-target" || port.defaultAddress === undefined) {
            throw workspaceError(
              "LOCAL_CONNECTION_INVALID",
              "The legacy dev:device command supports only I2C target ports with defaultAddress. Use dev:devices for explicit wiring.",
            );
          }
          return {
            portId: port.id,
            endpoint: { kind: "i2c", controller: 0, address: port.defaultAddress },
          };
        }),
      },
    ],
  });
  return loadValidatedWorkspace(configuration, process.cwd(), {
    checkSources: false,
    configurationPath: null,
  });
}

async function loadValidatedWorkspace(configuration, baseDirectory, options) {
  const { parseDeviceManifest } = await loadDeviceApi();
  if (
    configuration.boardProfile.id !== RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.id ||
    configuration.boardProfile.version !== RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.version
  ) {
    throw workspaceError(
      "LOCAL_CONFIG_INVALID",
      `Unsupported Board Profile ${configuration.boardProfile.id}@${configuration.boardProfile.version}.`,
    );
  }
  const sources = [];
  for (const source of configuration.sources) {
    try {
      const directory = await realpath(path.resolve(baseDirectory, source.source.directory));
      if (!(await stat(directory)).isDirectory()) {
        throw new Error(`${directory} is not a directory.`);
      }
      const manifest = parseDeviceManifest(
        await readFile(path.join(directory, "device.json"), "utf8"),
      );
      if (
        manifest.id !== source.expected.deviceId ||
        manifest.version !== source.expected.deviceVersion
      ) {
        throw new Error(
          `Expected ${source.expected.deviceId}@${source.expected.deviceVersion}, received ${manifest.id}@${manifest.version}.`,
        );
      }
      const entrypoint = await realpath(path.resolve(directory, manifest.entrypoint));
      assertInsideDirectory(directory, entrypoint, "Device entrypoint");
      if (options.checkSources) {
        checkDevicePackage(directory);
      }
      const loaded = await import(
        `${pathToFileURL(entrypoint).href}?local-workspace=${Date.now()}-${sources.length}`
      );
      const definition = loaded.default;
      if (typeof definition !== "object" || definition === null) {
        throw new Error("Device entrypoint must default-export a DeviceDefinition object.");
      }
      const definitionManifest = parseDeviceManifest(JSON.stringify(definition.manifest));
      if (JSON.stringify(definitionManifest) !== JSON.stringify(manifest)) {
        throw new Error("device.json and the entrypoint DeviceDefinition manifest do not match.");
      }
      sources.push(Object.freeze({
        sourceId: source.sourceId,
        directory,
        entrypoint,
        manifest,
        definition,
      }));
    } catch (error) {
      if (error instanceof LocalDeviceWorkspaceError) {
        throw error;
      }
      throw workspaceError(
        "LOCAL_SOURCE_INVALID",
        `${source.sourceId}: ${messageFrom(error)}`,
        error,
      );
    }
  }

  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const localGraph = createLocalConnectionGraph(configuration);
  const preset = createConnectionPreset(configuration.basePreset);
  let effectiveGraph;
  const definitions = new Map(preset.definitions);
  const instances = configuration.instances.map((instance) => {
    const source = sourceById.get(instance.sourceId);
    if (source === undefined) {
      throw workspaceError(
        "LOCAL_SOURCE_INVALID",
        `${instance.instanceId} references missing source ${instance.sourceId}.`,
      );
    }
    definitions.set(instance.instanceId, source.definition);
    return Object.freeze({
      instanceId: instance.instanceId,
      sourceId: instance.sourceId,
      deviceId: source.manifest.id,
      deviceVersion: source.manifest.version,
      name: source.manifest.name,
    });
  });
  try {
    effectiveGraph = mergeConnectionGraphs(preset.graph, localGraph);
    resolveConnectionGraph(
      effectiveGraph,
      RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
      definitions,
    );
  } catch (error) {
    const message = messageFrom(error);
    const code = /already claimed|more than one|Duplicate connection device/.test(message)
      ? "LOCAL_RESOURCE_CONFLICT"
      : "LOCAL_CONNECTION_INVALID";
    throw workspaceError(code, message, error);
  }

  return Object.freeze({
    configurationPath: options.configurationPath,
    basePreset: configuration.basePreset,
    localGraph,
    effectiveGraph,
    sources: Object.freeze(sources),
    instances: Object.freeze(instances),
    directories: Object.freeze(sources.map((source) => source.directory)),
  });
}

function checkDevicePackage(directory) {
  const result = spawnSync(
    process.execPath,
    [path.resolve(import.meta.dirname, "..", "check-device.mjs"), directory],
    { stdio: "inherit" },
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Device conformance check exited with status ${result.status ?? 1}.`);
  }
}

let deviceApiPromise;

function loadDeviceApi() {
  deviceApiPromise ??= import(
    pathToFileURL(
      path.resolve(import.meta.dirname, "..", "..", "packages", "device-api", "dist", "index.js"),
    ).href
  );
  return deviceApiPromise;
}

function assertInsideDirectory(directory, target, label) {
  const relative = path.relative(directory, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain inside the device directory.`);
  }
}

function messageFrom(error) {
  return error instanceof Error ? error.message : String(error);
}

function workspaceError(code, message, cause) {
  return new LocalDeviceWorkspaceError(code, message, cause);
}

export class LocalDeviceWorkspaceError extends Error {
  constructor(code, message, cause) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause });
    this.name = "LocalDeviceWorkspaceError";
    this.code = code;
  }
}
