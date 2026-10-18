import { snapshotBoardGraph } from "./legacy-project";
import { snapshotStoredProject, type StoredProject } from "../project/project-state";
import type { ConnectionGraphV1 } from "../connections/connection-model";

export const MAX_EXPERIMENT_SETS = 16;
export const MAX_EXPERIMENT_TOTAL_BYTES = 64 * 1024 * 1024;
export type ExperimentEnvironment =
  | { readonly kind: "board"; readonly connectionGraph: ConnectionGraphV1 }
  | { readonly kind: "unavailable"; readonly reason: "invalid-legacy-connection" };
export interface RuntimeReference { readonly id: string; readonly version: string; readonly buildHash: string }
export type ExperimentOrigin =
  | { readonly kind: "legacy"; readonly source: "project-v1" }
  | { readonly kind: "template"; readonly id: string; readonly version: string; readonly hash: string };
export interface ExperimentContent {
  readonly filesystem: StoredProject["filesystem"];
  readonly editor: { readonly tabs: StoredProject["tabs"]; readonly activeTabId: string };
  readonly environment: ExperimentEnvironment;
  readonly initialConditions: { readonly inputs: Readonly<Record<string, number | boolean>> };
  readonly runPolicy: { readonly kind: "interactive" };
  readonly view: {
    readonly id: "devices-v1";
    readonly section: "experience" | "configuration" | "explanation";
    readonly deviceOrder: readonly string[];
  };
  readonly configurationDraft?: ConnectionGraphV1;
}
export interface ExperimentSet extends ExperimentContent {
  readonly recordVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly createdAt: string;
  readonly savedAt: string;
  readonly origin: ExperimentOrigin;
  readonly runtimeRef: RuntimeReference;
}

export function recordObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
export function recordIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("Invalid experiment identifier");
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.length > max) throw new Error("Invalid experiment text");
  return value;
}
function date(value: unknown): string {
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error("Invalid experiment date");
  return result;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid experiment content hash");
  return value;
}

/** A versioned, allowlisted data record; no runtime or renderer code is deserialized. */
export function snapshotExperiment(value: unknown): ExperimentSet {
  const v = recordObject(value);
  if (v.recordVersion !== 1) throw new Error("Unsupported experiment record version");
  if (!Number.isSafeInteger(v.revision) || (v.revision as number) < 1) throw new Error("Invalid experiment revision");
  const editor = recordObject(v.editor);
  const project = snapshotStoredProject({ version: 1, filesystem: v.filesystem, tabs: editor.tabs, activeTabId: editor.activeTabId });
  const e = recordObject(v.environment);
  let environment: ExperimentEnvironment;
  if (e.kind === "board") environment = { kind: "board", connectionGraph: snapshotBoardGraph(e.connectionGraph) };
  else if (e.kind === "unavailable" && e.reason === "invalid-legacy-connection") environment = { kind: "unavailable", reason: e.reason };
  else throw new Error("Unsupported experiment environment");
  const origin = recordObject(v.origin);
  let originCopy: ExperimentOrigin;
  if (origin.kind === "legacy" && origin.source === "project-v1") originCopy = { kind: "legacy", source: "project-v1" };
  else if (origin.kind === "template") originCopy = { kind: "template", id: recordIdentifier(origin.id), version: text(origin.version, 80), hash: hash(origin.hash) };
  else throw new Error("Unsupported experiment origin");
  const runtime = recordObject(v.runtimeRef);
  const inputs = recordObject(recordObject(v.initialConditions).inputs);
  if (Object.keys(inputs).length > 128) throw new Error("Too many initial inputs");
  const inputCopy: Record<string, number | boolean> = {};
  for (const [key, input] of Object.entries(inputs)) {
    recordIdentifier(key);
    if (key === "__proto__" || (typeof input !== "boolean" && (typeof input !== "number" || !Number.isFinite(input)))) throw new Error("Invalid initial input");
    inputCopy[key] = input as number | boolean;
  }
  if (recordObject(v.runPolicy).kind !== "interactive") throw new Error("Unsupported experiment run policy");
  const view = recordObject(v.view);
  if (view.id !== "devices-v1" || !["experience", "configuration", "explanation"].includes(view.section as string) ||
      !Array.isArray(view.deviceOrder) || view.deviceOrder.length > 64) throw new Error("Invalid experiment view");
  const deviceOrder = Array.from(view.deviceOrder, recordIdentifier);
  if (new Set(deviceOrder).size !== deviceOrder.length) throw new Error("Duplicate device order");
  return {
    recordVersion: 1, id: recordIdentifier(v.id), revision: v.revision as number,
    title: text(v.title, 120), createdAt: date(v.createdAt), savedAt: date(v.savedAt), origin: originCopy,
    runtimeRef: { id: recordIdentifier(runtime.id), version: text(runtime.version, 80), buildHash: hash(runtime.buildHash) },
    filesystem: project.filesystem, editor: { tabs: project.tabs, activeTabId: project.activeTabId }, environment,
    initialConditions: { inputs: inputCopy }, runPolicy: { kind: "interactive" },
    view: { id: "devices-v1", section: view.section as ExperimentSet["view"]["section"], deviceOrder },
    ...(v.configurationDraft === undefined ? {} : {
      configurationDraft: snapshotBoardGraph(v.configurationDraft),
    }),
  };
}

export function experimentProject(value: ExperimentSet): StoredProject {
  return snapshotStoredProject({ version: 1, savedAt: value.savedAt, filesystem: value.filesystem,
    tabs: value.editor.tabs, activeTabId: value.editor.activeTabId });
}

export function applyExperimentContent(base: ExperimentSet, content: ExperimentContent): ExperimentSet {
  return snapshotExperiment({ ...base, filesystem: content.filesystem, editor: content.editor,
    environment: content.environment, initialConditions: content.initialConditions,
    runPolicy: content.runPolicy, view: content.view, configurationDraft: content.configurationDraft });
}

export function createExperiment(project: StoredProject, environment: ExperimentEnvironment, options: {
  id?: string; title: string; origin: ExperimentOrigin; runtimeRef: RuntimeReference; now?: string;
}): ExperimentSet {
  const now = options.now ?? new Date().toISOString();
  return snapshotExperiment({ recordVersion: 1, id: options.id ?? crypto.randomUUID(), revision: 1,
    title: options.title, createdAt: now, savedAt: now, origin: options.origin, runtimeRef: options.runtimeRef,
    filesystem: project.filesystem, editor: { tabs: project.tabs, activeTabId: project.activeTabId }, environment,
    initialConditions: { inputs: {} }, runPolicy: { kind: "interactive" },
    view: { id: "devices-v1", section: "experience", deviceOrder: [] } });
}

/** Count binary contents once, plus UTF-8 metadata including buffers and paths. */
export function experimentBytes(value: ExperimentSet): number {
  let binaryBytes = 0;
  const entries = value.filesystem.entries.map(entry => {
    if (entry.kind === "file") binaryBytes += entry.data.byteLength;
    return { path: entry.path, kind: entry.kind };
  });
  return binaryBytes + new TextEncoder().encode(JSON.stringify({ ...value, filesystem: { version: 1, entries } })).byteLength;
}

export function checkExperimentQuota(previousSizes: readonly number[], nextSizes: readonly number[]): void {
  if (nextSizes.length > MAX_EXPERIMENT_SETS && nextSizes.length > previousSizes.length) throw new Error("Experiment set limit reached (16)");
  const before = previousSizes.reduce((a, b) => a + b, 0);
  const after = nextSizes.reduce((a, b) => a + b, 0);
  if (after > MAX_EXPERIMENT_TOTAL_BYTES && after > before) throw new Error("Experiment storage limit reached (64 MiB)");
}
