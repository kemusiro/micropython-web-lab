import { snapshotBoardGraph } from "./legacy-project";
import { snapshotStoredProject, type StoredProject } from "../project/project-state";
import type { ConnectionGraphV1 } from "../connections/connection-model";
import { ARM_MODEL } from "../physics/one-axis-arm";
import { DEFAULT_ARM_CONTROL, snapshotArmControlConditions, type ArmControlConditions } from "../physics/arm-control";
import { DEFAULT_ARM_SERIES, snapshotArmSeries, type ArmExtraSeries } from "../control/presentation";

export const MAX_EXPERIMENT_SETS = 16;
export const MAX_EXPERIMENT_TOTAL_BYTES = 64 * 1024 * 1024;
export type ExperimentEnvironment =
  | { readonly kind: "board"; readonly connectionGraph: ConnectionGraphV1 }
  | { readonly kind: "model"; readonly model: { readonly id: "one-axis-arm"; readonly version: "1.0.0" } }
  | { readonly kind: "unavailable"; readonly reason: "invalid-legacy-connection" };
export interface RuntimeReference { readonly id: string; readonly version: string; readonly buildHash: string }
export type ExperimentOrigin =
  | { readonly kind: "legacy"; readonly source: "project-v1" }
  | { readonly kind: "template"; readonly id: string; readonly version: string; readonly hash: string };
export interface ExperimentContent {
  readonly filesystem: StoredProject["filesystem"];
  readonly editor: { readonly tabs: StoredProject["tabs"]; readonly activeTabId: string };
  readonly environment: ExperimentEnvironment;
  readonly initialConditions: { readonly inputs: Readonly<Record<string, number | boolean>>; readonly arm?: ArmControlConditions };
  readonly runPolicy: { readonly kind: "interactive" | "fixed-step" };
  readonly view: {
    readonly id: "devices-v1";
    readonly section: "experience" | "configuration" | "explanation";
    readonly deviceOrder: readonly string[];
    readonly collapsedDevices?: readonly string[];
  } | { readonly id: "arm-v1"; readonly section: "experience" | "configuration" | "explanation"; readonly series: readonly ArmExtraSeries[] };
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
  if (e.kind === "board") {
    if (e.model !== undefined) throw new Error("Mixed model and board configuration");
    environment = { kind: "board", connectionGraph: snapshotBoardGraph(e.connectionGraph) };
  }
  else if (e.kind === "model") {
    const model = recordObject(e.model);
    if (model.id !== ARM_MODEL.id || model.version !== ARM_MODEL.version || e.connectionGraph !== undefined) throw new Error("Unsupported experiment model");
    environment = { kind: "model", model: { id: ARM_MODEL.id, version: ARM_MODEL.version } };
  } else if (e.kind === "unavailable" && e.reason === "invalid-legacy-connection") environment = { kind: "unavailable", reason: e.reason };
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
  const arm = environment.kind === "model" ? snapshotArmControlConditions(recordObject(v.initialConditions).arm) : undefined;
  if (arm ? Object.keys(inputCopy).length || v.configurationDraft !== undefined : recordObject(v.initialConditions).arm !== undefined) throw new Error("Mixed model and board configuration");
  const runPolicy = arm ? "fixed-step" : "interactive";
  if (recordObject(v.runPolicy).kind !== runPolicy) throw new Error("Unsupported experiment run policy");
  const view = recordObject(v.view);
  if (!["experience", "configuration", "explanation"].includes(view.section as string)) throw new Error("Invalid experiment section");
  let viewCopy: ExperimentSet["view"];
  if (arm) {
    if (view.id !== "arm-v1" || view.deviceOrder !== undefined || view.collapsedDevices !== undefined) throw new Error("Invalid arm view");
    viewCopy = { id: "arm-v1", section: view.section as ExperimentSet["view"]["section"], series: snapshotArmSeries(view.series) };
  } else {
    if (view.id !== "devices-v1" || !Array.isArray(view.deviceOrder) || view.deviceOrder.length > 64) throw new Error("Invalid experiment view");
    const deviceOrder = Array.from(view.deviceOrder, recordIdentifier);
    if (new Set(deviceOrder).size !== deviceOrder.length) throw new Error("Duplicate device order");
    let collapsedDevices: string[] | undefined;
    if (view.collapsedDevices !== undefined) {
      if (!Array.isArray(view.collapsedDevices) || view.collapsedDevices.length > 64) throw new Error("Invalid collapsed devices");
      collapsedDevices = Array.from(view.collapsedDevices, recordIdentifier);
      if (new Set(collapsedDevices).size !== collapsedDevices.length) throw new Error("Duplicate collapsed devices");
    }
    viewCopy = { id: "devices-v1", section: view.section as ExperimentSet["view"]["section"], deviceOrder,
      ...(collapsedDevices === undefined ? {} : { collapsedDevices }) };
  }
  return {
    recordVersion: 1, id: recordIdentifier(v.id), revision: v.revision as number,
    title: text(v.title, 120), createdAt: date(v.createdAt), savedAt: date(v.savedAt), origin: originCopy,
    runtimeRef: { id: recordIdentifier(runtime.id), version: text(runtime.version, 80), buildHash: hash(runtime.buildHash) },
    filesystem: project.filesystem, editor: { tabs: project.tabs, activeTabId: project.activeTabId }, environment,
    initialConditions: { inputs: inputCopy, ...(arm ? { arm } : {}) }, runPolicy: { kind: runPolicy }, view: viewCopy,
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
    initialConditions: { inputs: {}, ...(environment.kind === "model" ? { arm: DEFAULT_ARM_CONTROL } : {}) },
    runPolicy: { kind: environment.kind === "model" ? "fixed-step" : "interactive" },
    view: environment.kind === "model" ? { id: "arm-v1", section: "experience", series: DEFAULT_ARM_SERIES }
      : { id: "devices-v1", section: "experience", deviceOrder: [] } });
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
