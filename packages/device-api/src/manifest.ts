import {
  DEVICE_API_VERSION,
  type DeviceManifestV1,
  type DevicePortKind,
  type DevicePortManifestV1,
} from "./types.js";

export const DEVICE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const MAX_DEVICE_MANIFEST_BYTES = 64 * 1_024;
export const MAX_DEVICE_MANIFEST_PORTS = 32;

const DEVICE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SPDX_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+-]*(?: WITH [A-Za-z0-9][A-Za-z0-9.+-]*)?$/;
const ENTRYPOINT_PATTERN = /^\.\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.js$/;
const PORT_KINDS: readonly DevicePortKind[] = Object.freeze([
  "gpio-observer",
  "gpio-driver",
  "adc-source",
  "i2c-target",
  "spi-target",
  "uart-peer",
  "pwm-observer",
]);

export class DeviceManifestValidationError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "DeviceManifestValidationError";
    this.path = path;
  }
}

export function parseDeviceManifest(source: string): DeviceManifestV1 {
  if (typeof source !== "string") {
    throw new DeviceManifestValidationError("device.json", "must be UTF-8 JSON text.");
  }
  const byteLength = utf8ByteLength(source);
  if (byteLength > MAX_DEVICE_MANIFEST_BYTES) {
    throw new DeviceManifestValidationError(
      "device.json",
      `must not exceed ${MAX_DEVICE_MANIFEST_BYTES} bytes.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new DeviceManifestValidationError("device.json", "must contain valid JSON.");
  }
  return validateDeviceManifest(value);
}

export function validateDeviceManifest(value: unknown): DeviceManifestV1 {
  const manifest = requiredRecord(value, "device.json");
  rejectUnknownKeys(
    manifest,
    [
      "schemaVersion",
      "id",
      "version",
      "deviceApiVersion",
      "name",
      "description",
      "license",
      "entrypoint",
      "requires",
      "ports",
    ],
    "device.json",
  );
  if (manifest.schemaVersion !== DEVICE_MANIFEST_SCHEMA_VERSION) {
    fail("device.json.schemaVersion", `must be ${DEVICE_MANIFEST_SCHEMA_VERSION}.`);
  }
  if (manifest.deviceApiVersion !== DEVICE_API_VERSION) {
    fail("device.json.deviceApiVersion", `must be ${DEVICE_API_VERSION}.`);
  }
  const id = requiredString(manifest.id, "device.json.id", 128);
  if (!DEVICE_ID_PATTERN.test(id)) {
    fail("device.json.id", "must use lowercase letters and numbers separated by dots or hyphens.");
  }
  const version = requiredString(manifest.version, "device.json.version", 128);
  if (!SEMVER_PATTERN.test(version)) {
    fail("device.json.version", "must be a Semantic Versioning value.");
  }
  const name = requiredString(manifest.name, "device.json.name", 128);
  const description = requiredString(manifest.description, "device.json.description", 512);
  const license = requiredString(manifest.license, "device.json.license", 128);
  if (!SPDX_IDENTIFIER_PATTERN.test(license)) {
    fail("device.json.license", "must be an SPDX license identifier.");
  }
  const entrypoint = requiredString(manifest.entrypoint, "device.json.entrypoint", 256);
  if (!ENTRYPOINT_PATTERN.test(entrypoint)) {
    fail("device.json.entrypoint", "must be a relative JavaScript module path without traversal.");
  }
  const requires = requiredRecord(manifest.requires, "device.json.requires");
  rejectUnknownKeys(requires, ["boardCapabilities"], "device.json.requires");
  if (!Array.isArray(requires.boardCapabilities)) {
    fail("device.json.requires.boardCapabilities", "must be an array.");
  }
  const capabilities = uniqueIdentifiers(
    requires.boardCapabilities,
    "device.json.requires.boardCapabilities",
  );
  if (!Array.isArray(manifest.ports)) {
    fail("device.json.ports", "must be an array.");
  }
  if (manifest.ports.length < 1 || manifest.ports.length > MAX_DEVICE_MANIFEST_PORTS) {
    fail("device.json.ports", `must contain from 1 to ${MAX_DEVICE_MANIFEST_PORTS} ports.`);
  }
  const portIds = new Set<string>();
  const ports = manifest.ports.map((port, index) => validatePort(port, index, portIds));
  return Object.freeze({
    schemaVersion: DEVICE_MANIFEST_SCHEMA_VERSION,
    id,
    version,
    deviceApiVersion: DEVICE_API_VERSION,
    name,
    description,
    license,
    entrypoint,
    requires: Object.freeze({ boardCapabilities: Object.freeze(capabilities) }),
    ports: Object.freeze(ports),
  });
}

function validatePort(value: unknown, index: number, ids: Set<string>): DevicePortManifestV1 {
  const path = `device.json.ports[${index}]`;
  const port = requiredRecord(value, path);
  rejectUnknownKeys(port, ["id", "kind", "defaultAddress"], path);
  const id = requiredIdentifier(port.id, `${path}.id`);
  if (ids.has(id)) {
    fail(`${path}.id`, `duplicates port id ${id}.`);
  }
  ids.add(id);
  if (typeof port.kind !== "string" || !PORT_KINDS.includes(port.kind as DevicePortKind)) {
    fail(`${path}.kind`, "must be a supported Device API v1 port kind.");
  }
  const kind = port.kind as DevicePortKind;
  if (port.defaultAddress !== undefined) {
    if (kind !== "i2c-target") {
      fail(`${path}.defaultAddress`, "is allowed only for an i2c-target port.");
    }
    if (
      typeof port.defaultAddress !== "number" ||
      !Number.isSafeInteger(port.defaultAddress) ||
      port.defaultAddress < 0x08 ||
      port.defaultAddress > 0x77
    ) {
      fail(`${path}.defaultAddress`, "must be a 7-bit I2C address from 8 to 119.");
    }
  }
  return Object.freeze({
    id,
    kind,
    ...(port.defaultAddress === undefined ? {} : { defaultAddress: port.defaultAddress }),
  });
}

function uniqueIdentifiers(value: readonly unknown[], path: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const identifier = requiredIdentifier(value[index], `${path}[${index}]`);
    if (seen.has(identifier)) {
      fail(`${path}[${index}]`, `duplicates identifier ${identifier}.`);
    }
    seen.add(identifier);
    result.push(identifier);
  }
  return result;
}

function requiredIdentifier(value: unknown, path: string): string {
  const identifier = requiredString(value, path, 128);
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    fail(path, "must be a valid identifier.");
  }
  return identifier;
}

function requiredString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail(path, `must contain from 1 to ${maximum} characters.`);
  }
  return value;
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object.");
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`${path}.${key}`, "is not supported.");
    }
  }
}

function fail(path: string, message: string): never {
  throw new DeviceManifestValidationError(path, message);
}

function utf8ByteLength(value: string): number {
  let byteLength = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      byteLength += 1;
    } else if (codePoint <= 0x7ff) {
      byteLength += 2;
    } else if (codePoint <= 0xffff) {
      byteLength += 3;
    } else {
      byteLength += 4;
    }
  }
  return byteLength;
}
