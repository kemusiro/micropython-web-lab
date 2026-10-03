import {
  validateConnectionGraph,
  type ConnectionGraphV1,
} from "../connections/connection-model";
import type { DraftStorage } from "./editor-draft";

export const CONNECTION_PROJECT_SCHEMA_VERSION = 1 as const;
export const CONNECTION_PROJECT_STORAGE_KEY =
  "micropython-web-lab:connection-project:v1";
export const MAX_CONNECTION_PROJECT_BYTES = 64 * 1024;

export interface ConnectionProjectV1 {
  readonly schemaVersion: typeof CONNECTION_PROJECT_SCHEMA_VERSION;
  readonly savedAt: string;
  readonly graph: ConnectionGraphV1;
}

export type ConnectionProjectLoadResult =
  | { readonly status: "empty" }
  | { readonly status: "loaded"; readonly project: ConnectionProjectV1 }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string };

export type ConnectionProjectWriteResult =
  | { readonly ok: true; readonly project?: ConnectionProjectV1 }
  | { readonly ok: false; readonly message: string };

export function loadConnectionProject(storage: DraftStorage): ConnectionProjectLoadResult {
  let serialized: string | null;
  try {
    serialized = storage.getItem(CONNECTION_PROJECT_STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", message: formatStorageError(error) };
  }
  if (serialized === null) {
    return { status: "empty" };
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_CONNECTION_PROJECT_BYTES) {
    return { status: "invalid", message: "保存された配線データが容量上限を超えています。" };
  }
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) {
      throw new TypeError("Connection project must be an object.");
    }
    const keys = Object.keys(value);
    if (
      keys.some((key) => !["schemaVersion", "savedAt", "graph"].includes(key)) ||
      value.schemaVersion !== CONNECTION_PROJECT_SCHEMA_VERSION ||
      typeof value.savedAt !== "string" ||
      !Number.isFinite(Date.parse(value.savedAt))
    ) {
      throw new TypeError("Connection project fields are invalid.");
    }
    return {
      status: "loaded",
      project: {
        schemaVersion: CONNECTION_PROJECT_SCHEMA_VERSION,
        savedAt: value.savedAt,
        graph: validateConnectionGraph(value.graph),
      },
    };
  } catch (error) {
    return {
      status: "invalid",
      message: `保存された配線データを読み込めません: ${formatError(error)}`,
    };
  }
}

export function saveConnectionProject(
  storage: DraftStorage,
  graph: ConnectionGraphV1,
  savedAt: Date = new Date(),
): ConnectionProjectWriteResult {
  const project: ConnectionProjectV1 = {
    schemaVersion: CONNECTION_PROJECT_SCHEMA_VERSION,
    savedAt: savedAt.toISOString(),
    graph: validateConnectionGraph(graph),
  };
  const serialized = JSON.stringify(project);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CONNECTION_PROJECT_BYTES) {
    return { ok: false, message: "配線データが64 KiBの保存上限を超えています。" };
  }
  try {
    storage.setItem(CONNECTION_PROJECT_STORAGE_KEY, serialized);
    return { ok: true, project };
  } catch (error) {
    return { ok: false, message: formatStorageError(error) };
  }
}

export function clearConnectionProject(storage: DraftStorage): ConnectionProjectWriteResult {
  try {
    storage.removeItem(CONNECTION_PROJECT_STORAGE_KEY);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: formatStorageError(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatStorageError(error: unknown): string {
  return `配線のブラウザ保存を利用できません: ${formatError(error)}`;
}

function formatError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "不明なエラーです。";
}
