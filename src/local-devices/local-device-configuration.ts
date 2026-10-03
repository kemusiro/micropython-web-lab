import {
  validateConnectionGraph,
  type ConnectionGraphV1,
  type PortConnectionV1,
} from "../connections/connection-model.ts";
import {
  isConnectionPresetId,
  type ConnectionPresetId,
} from "../connections/connection-presets.ts";

export const LOCAL_DEVICE_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const MAX_LOCAL_DEVICE_CONFIGURATION_BYTES = 256 * 1024;
export const MAX_LOCAL_DEVICE_SOURCES = 32;
export const MAX_LOCAL_DEVICE_INSTANCES = 64;

export interface LocalDeviceSourceV1 {
  readonly sourceId: string;
  readonly source: {
    readonly kind: "path";
    readonly directory: string;
  };
  readonly expected: {
    readonly deviceId: string;
    readonly deviceVersion: string;
  };
}

export interface LocalDeviceInstanceV1 {
  readonly instanceId: string;
  readonly sourceId: string;
  readonly ports: readonly PortConnectionV1[];
}

export interface LocalDeviceConfigurationV1 {
  readonly schemaVersion: 1;
  readonly boardProfile: ConnectionGraphV1["boardProfile"];
  readonly basePreset: ConnectionPresetId;
  readonly sources: readonly LocalDeviceSourceV1[];
  readonly instances: readonly LocalDeviceInstanceV1[];
}

export class LocalDeviceConfigurationError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "LocalDeviceConfigurationError";
    this.path = path;
  }
}

export function parseLocalDeviceConfiguration(source: string): LocalDeviceConfigurationV1 {
  if (typeof source !== "string") {
    fail("web-lab.local.json", "must be UTF-8 JSON text.");
  }
  if (new TextEncoder().encode(source).length > MAX_LOCAL_DEVICE_CONFIGURATION_BYTES) {
    fail(
      "web-lab.local.json",
      `must not exceed ${MAX_LOCAL_DEVICE_CONFIGURATION_BYTES} bytes.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    fail("web-lab.local.json", "must contain valid JSON.");
  }
  return validateLocalDeviceConfiguration(value);
}

export function validateLocalDeviceConfiguration(
  value: unknown,
): LocalDeviceConfigurationV1 {
  const root = record(value, "web-lab.local.json");
  rejectUnknown(
    root,
    ["schemaVersion", "boardProfile", "basePreset", "sources", "instances"],
    "web-lab.local.json",
  );
  if (root.schemaVersion !== LOCAL_DEVICE_CONFIGURATION_SCHEMA_VERSION) {
    fail(
      "web-lab.local.json.schemaVersion",
      `must be ${LOCAL_DEVICE_CONFIGURATION_SCHEMA_VERSION}.`,
    );
  }
  const board = record(root.boardProfile, "web-lab.local.json.boardProfile");
  rejectUnknown(board, ["id", "version"], "web-lab.local.json.boardProfile");
  const boardProfile = Object.freeze({
    id: identifier(board.id, "web-lab.local.json.boardProfile.id"),
    version: positiveInteger(board.version, "web-lab.local.json.boardProfile.version"),
  });
  if (!isConnectionPresetId(root.basePreset)) {
    fail("web-lab.local.json.basePreset", "must be a supported connection preset id.");
  }
  if (
    !Array.isArray(root.sources) ||
    root.sources.length < 1 ||
    root.sources.length > MAX_LOCAL_DEVICE_SOURCES
  ) {
    fail(
      "web-lab.local.json.sources",
      `must contain from 1 to ${MAX_LOCAL_DEVICE_SOURCES} sources.`,
    );
  }
  const sourceIds = new Set<string>();
  const sources = root.sources.map((entry, index) => validateSource(entry, index, sourceIds));
  const sourceById = new Map(sources.map((entry) => [entry.sourceId, entry]));
  if (
    !Array.isArray(root.instances) ||
    root.instances.length < 1 ||
    root.instances.length > MAX_LOCAL_DEVICE_INSTANCES
  ) {
    fail(
      "web-lab.local.json.instances",
      `must contain from 1 to ${MAX_LOCAL_DEVICE_INSTANCES} instances.`,
    );
  }
  const instanceIds = new Set<string>();
  const rawInstances = root.instances.map((entry, index) => {
    const instance = record(entry, `web-lab.local.json.instances[${index}]`);
    rejectUnknown(
      instance,
      ["instanceId", "sourceId", "ports"],
      `web-lab.local.json.instances[${index}]`,
    );
    const instanceId = identifier(
      instance.instanceId,
      `web-lab.local.json.instances[${index}].instanceId`,
    );
    if (instanceIds.has(instanceId)) {
      fail(`web-lab.local.json.instances[${index}].instanceId`, `duplicates ${instanceId}.`);
    }
    instanceIds.add(instanceId);
    const sourceId = identifier(
      instance.sourceId,
      `web-lab.local.json.instances[${index}].sourceId`,
    );
    if (!sourceById.has(sourceId)) {
      fail(
        `web-lab.local.json.instances[${index}].sourceId`,
        `does not reference a declared source: ${sourceId}.`,
      );
    }
    if (!Array.isArray(instance.ports)) {
      fail(`web-lab.local.json.instances[${index}].ports`, "must be an array.");
    }
    return { instanceId, sourceId, ports: instance.ports };
  });
  const usedSources = new Set(rawInstances.map((instance) => instance.sourceId));
  for (const source of sources) {
    if (!usedSources.has(source.sourceId)) {
      fail(
        "web-lab.local.json.sources",
        `contains unused source ${source.sourceId}.`,
      );
    }
  }
  let graph: ConnectionGraphV1;
  try {
    graph = validateConnectionGraph({
      schemaVersion: 1,
      boardProfile,
      devices: rawInstances.map((instance) => {
        const source = sourceById.get(instance.sourceId)!;
        return {
          instanceId: instance.instanceId,
          deviceId: source.expected.deviceId,
          deviceVersion: source.expected.deviceVersion,
          ports: instance.ports,
        };
      }),
    });
  } catch (error) {
    fail("web-lab.local.json.instances", messageFrom(error));
  }
  const instances = Object.freeze(
    graph.devices.map((device, index) =>
      Object.freeze({
        instanceId: device.instanceId,
        sourceId: rawInstances[index]!.sourceId,
        ports: device.ports,
      }),
    ),
  );
  return Object.freeze({
    schemaVersion: LOCAL_DEVICE_CONFIGURATION_SCHEMA_VERSION,
    boardProfile,
    basePreset: root.basePreset,
    sources: Object.freeze(sources),
    instances,
  });
}

export function createLocalConnectionGraph(
  configuration: LocalDeviceConfigurationV1,
): ConnectionGraphV1 {
  const sourceById = new Map(
    configuration.sources.map((source) => [source.sourceId, source]),
  );
  return validateConnectionGraph({
    schemaVersion: 1,
    boardProfile: configuration.boardProfile,
    devices: configuration.instances.map((instance) => {
      const source = sourceById.get(instance.sourceId)!;
      return {
        instanceId: instance.instanceId,
        deviceId: source.expected.deviceId,
        deviceVersion: source.expected.deviceVersion,
        ports: instance.ports,
      };
    }),
  });
}

function validateSource(
  value: unknown,
  index: number,
  sourceIds: Set<string>,
): LocalDeviceSourceV1 {
  const path = `web-lab.local.json.sources[${index}]`;
  const entry = record(value, path);
  rejectUnknown(entry, ["sourceId", "source", "expected"], path);
  const sourceId = identifier(entry.sourceId, `${path}.sourceId`);
  if (sourceIds.has(sourceId)) {
    fail(`${path}.sourceId`, `duplicates ${sourceId}.`);
  }
  sourceIds.add(sourceId);
  const source = record(entry.source, `${path}.source`);
  rejectUnknown(source, ["kind", "directory"], `${path}.source`);
  if (source.kind !== "path") {
    fail(`${path}.source.kind`, 'must be "path".');
  }
  const directory = limitedString(source.directory, `${path}.source.directory`, 1_024);
  if (directory.includes("\0")) {
    fail(`${path}.source.directory`, "must not contain NUL.");
  }
  const expected = record(entry.expected, `${path}.expected`);
  rejectUnknown(expected, ["deviceId", "deviceVersion"], `${path}.expected`);
  const deviceId = limitedString(expected.deviceId, `${path}.expected.deviceId`, 128);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(deviceId)) {
    fail(`${path}.expected.deviceId`, "must be a valid Device ID.");
  }
  const deviceVersion = limitedString(
    expected.deviceVersion,
    `${path}.expected.deviceVersion`,
    128,
  );
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(deviceVersion)) {
    fail(`${path}.expected.deviceVersion`, "must be a Semantic Versioning value.");
  }
  return Object.freeze({
    sourceId,
    source: Object.freeze({ kind: "path" as const, directory }),
    expected: Object.freeze({ deviceId, deviceVersion }),
  });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object.");
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`${path}.${key}`, "is not supported.");
    }
  }
}

function identifier(value: unknown, path: string): string {
  const result = limitedString(value, path, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) {
    fail(path, "must be a valid identifier.");
  }
  return result;
}

function limitedString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail(path, `must contain from 1 to ${maximum} characters.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail(path, "must be a positive integer.");
  }
  return value;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(path: string, message: string): never {
  throw new LocalDeviceConfigurationError(path, message);
}
