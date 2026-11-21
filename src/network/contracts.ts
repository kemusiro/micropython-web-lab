/** All untrusted Python requests cross this bounded JSON boundary. */
export const NETWORK_VERSION = 1;
export const NETWORK_REQUEST_BYTES = 48 * 1024;
export const NETWORK_RESPONSE_BYTES = 160 * 1024;
export const NETWORK_CHANNEL_BYTES = NETWORK_RESPONSE_BYTES + 8;
export const NETWORK_LIMITS = Object.freeze({ httpRequest: 16 * 1024, httpResponse: 64 * 1024,
  sockets: 4, socketQueue: 8192, mqttConnections: 2, mqttSubscriptions: 8,
  mqttPayload: 4096, mqttQueue: 64 * 1024, history: 100 });

export class NetworkError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
export function fail(message: string, code = 22): never { throw new NetworkError(code, message); }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected an object");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 2048): string {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > max || /[\x00-\x1f\x7f]/.test(value)) fail("Invalid string");
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("Invalid integer");
  return value;
}
export function timeout(value: unknown, fallback = 5): number {
  if (value === null || value === undefined) return fallback * 1000;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10) fail("Timeout must be > 0 and <= 10 seconds");
  return value * 1000;
}
export function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
export function unhex(value: unknown, max: number): Uint8Array {
  if (typeof value !== "string" || value.length > max * 2 || !/^(?:[\da-f]{2})*$/.test(value)) fail("Invalid or oversized byte string");
  return Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte, 16));
}
export function topic(value: unknown, filter = false, portable = false): string {
  const result = text(value, 128);
  if (!result || result.startsWith("$") || (!filter && /[+#]/.test(result))) fail("Invalid or system topic");
  if (filter && result.split("/").some((part, i, all) => (part.includes("+") && part !== "+") || (part.includes("#") && (part !== "#" || i !== all.length - 1)))) fail("Invalid topic filter");
  if (portable && (!/^[A-Za-z0-9.,:;_$/+#-]+$/.test(result) || result.startsWith("/"))) fail("Topic is not portable to shiftr.io");
  return result;
}
export function matches(filter: string, name: string): boolean {
  const parts = name.split("/");
  const filters = filter.split("/");
  for (let i = 0; i < filters.length; i++) {
    if (filters[i] === "#") return true;
    if (parts[i] === undefined || (filters[i] !== "+" && filters[i] !== parts[i])) return false;
  }
  return filters.length === parts.length;
}

export interface NetworkSettings {
  version: 1; apPresent: boolean; ssid: string; key: string; rssi: number; connectDelayMs: number;
  httpDelayMs: number; ntpSource: "fixed" | "pc"; ntpUnixSeconds: number;
  ntpFault: "none" | "timeout" | "invalid"; ntpDelayMs: number; duplicateQos1: boolean;
}
export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = Object.freeze({ version: 1,
  apPresent: true, ssid: "WebLab-Demo", key: "demo-password", rssi: -55, connectDelayMs: 200,
  httpDelayMs: 0, ntpSource: "fixed", ntpUnixSeconds: 1767225600,
  ntpFault: "none", ntpDelayMs: 0, duplicateQos1: false });
export function validateSettings(value: unknown): NetworkSettings {
  const a = record(value);
  if (Object.keys(a).sort().join() !== Object.keys(DEFAULT_NETWORK_SETTINGS).sort().join() || a.version !== 1 ||
      typeof a.apPresent !== "boolean" || typeof a.duplicateQos1 !== "boolean" ||
      !["fixed", "pc"].includes(String(a.ntpSource)) || !["none", "timeout", "invalid"].includes(String(a.ntpFault))) fail("Invalid network settings");
  text(a.ssid, 32); text(a.key, 64); integer(a.rssi, -120, 0);
  for (const key of ["connectDelayMs", "httpDelayMs", "ntpDelayMs"]) integer(a[key], 0, 10000);
  integer(a.ntpUnixSeconds, 0, 7258118400);
  return { ...a } as unknown as NetworkSettings;
}

export interface NetworkHistory { sequence: number; service: string; operation: string; result: string; bytes: number; durationMs: number }
export const MQTT_SERVER = "public.cloud.shiftr.io";
export const MQTT_WSS_URL = "wss://public.cloud.shiftr.io/";
export const VIRTUAL_MQTT_SERVER = "mqtt.weblab.test";
