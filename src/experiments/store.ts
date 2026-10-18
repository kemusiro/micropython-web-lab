import { getProjectDatabase, ProjectDatabase, projectTransaction } from "../project/database";
import { snapshotStoredProject, type StoredProject } from "../project/project-state";
import {
  checkExperimentQuota, createExperiment, experimentBytes, recordIdentifier, recordObject,
  snapshotExperiment, type ExperimentEnvironment, type ExperimentSet, type RuntimeReference,
} from "./record";

export class ExperimentConflictError extends Error {
  constructor() { super("Experiment changed in another window / 別のウィンドウの変更と競合しています"); this.name = "ExperimentConflictError"; }
}
export interface ExperimentWorkspaceRecord {
  readonly schemaVersion: 1;
  readonly selectedSetId: string;
  readonly migration: { readonly source: "project-v1"; readonly setId: string };
}
export type SwitchTarget =
  | { readonly kind: "saved"; readonly id: string; readonly revision: number }
  | { readonly kind: "new"; readonly record: ExperimentSet };
export interface ExperimentPersistence {
  load(id: string): Promise<ExperimentSet>;
  save(record: ExperimentSet): Promise<ExperimentSet>;
  switch(record: ExperimentSet, target: SwitchTarget): Promise<ExperimentSet>;
}

function workspaceRecord(value: unknown): ExperimentWorkspaceRecord | undefined {
  if (value === undefined) return undefined;
  const v = recordObject(value);
  const migration = recordObject(v.migration);
  if (v.schemaVersion !== 1 || migration.source !== "project-v1") throw new Error("Unsupported experiment workspace");
  return { schemaVersion: 1, selectedSetId: recordIdentifier(v.selectedSetId),
    migration: { source: "project-v1", setId: recordIdentifier(migration.setId) } };
}

interface TransactionState {
  sets: ExperimentSet[];
  workspace: ExperimentWorkspaceRecord | undefined;
  legacy: unknown;
}

/** A single transaction owns source, destination and selection; no async work occurs inside it. */
export class ExperimentStore implements ExperimentPersistence {
  constructor(readonly database: ProjectDatabase = getProjectDatabase()) {}

  #transaction<T>(mode: IDBTransactionMode, body: (state: TransactionState, tx: IDBTransaction) => T, legacy = false): Promise<T> {
    const stores = ["experimentSets", "experimentWorkspace", ...(legacy ? ["project"] : [])];
    return projectTransaction(this.database, stores, mode, tx => [
      tx.objectStore("experimentSets").getAll(), tx.objectStore("experimentSets").getAllKeys(),
      tx.objectStore("experimentWorkspace").get("current"),
      ...(legacy ? [tx.objectStore("project").get("current")] : []),
    ], ([values, keys, metadata, old], tx) => {
      if (!Array.isArray(values) || !Array.isArray(keys)) throw new Error("Invalid experiment storage");
      const sets = values.map((value, i) => {
        const record = snapshotExperiment(value);
        if (record.id !== keys[i]) throw new Error("Experiment storage key mismatch");
        return record;
      });
      return body({ sets, workspace: workspaceRecord(metadata), legacy: old }, tx);
    });
  }

  list(): Promise<ExperimentSet[]> { return this.#transaction("readonly", state => state.sets); }
  load(id: string): Promise<ExperimentSet> {
    recordIdentifier(id);
    return projectTransaction(this.database, ["experimentSets"], "readonly",
      tx => [tx.objectStore("experimentSets").get(id)], ([value]) => {
        const record = snapshotExperiment(value);
        if (record.id !== id) throw new Error("Experiment storage key mismatch");
        return record;
      });
  }
  selected(): Promise<ExperimentSet | undefined> {
    return this.#transaction("readonly", state => state.workspace ? requireSet(state.sets, state.workspace.selectedSetId) : undefined);
  }

  /** Read-only export path for an unknown/corrupt record. Never normalize or overwrite it. */
  readForRecovery(id: string): Promise<unknown> {
    recordIdentifier(id);
    return projectTransaction(this.database, ["experimentSets"], "readonly",
      tx => [tx.objectStore("experimentSets").get(id)], ([value]) => value);
  }

  readRecoveryWorkspace(): Promise<{ workspace: unknown; sets: { key: IDBValidKey; value: unknown }[]; legacy: unknown }> {
    return projectTransaction(this.database, ["project", "experimentSets", "experimentWorkspace"], "readonly", tx => [
      tx.objectStore("experimentWorkspace").get("current"), tx.objectStore("experimentSets").getAllKeys(),
      tx.objectStore("experimentSets").getAll(), tx.objectStore("project").get("current"),
    ], ([workspace, keys, values, legacy]) => ({ workspace,
      sets: (keys as IDBValidKey[]).map((key, i) => ({ key, value: (values as unknown[])[i] })), legacy }));
  }

  /** Journal resolution happens against the legacy record read inside this transaction. */
  migrateLegacy(options: {
    fallback: StoredProject;
    environment: ExperimentEnvironment;
    runtimeRef: RuntimeReference;
    view?: ExperimentSet["view"];
    journal?: { tabs: StoredProject["tabs"]; activeTabId: string; savedAt: string };
    title?: string;
  }): Promise<ExperimentSet> {
    const fallback = snapshotStoredProject(options.fallback);
    const journal = options.journal && { ...options.journal,
      tabs: snapshotStoredProject({ ...fallback, tabs: options.journal.tabs, activeTabId: options.journal.activeTabId }).tabs };
    // Validate and capture host-provided metadata before starting the transaction.
    const base = createExperiment(fallback, options.environment, { title: options.title ?? "これまでの作業",
      origin: { kind: "legacy", source: "project-v1" }, runtimeRef: options.runtimeRef });
    const candidate = options.view === undefined ? base : snapshotExperiment({ ...base, view: options.view });
    return this.#transaction("readwrite", (state, tx) => {
      if (state.workspace) return requireSet(state.sets, state.workspace.selectedSetId);
      if (state.sets.length) throw new Error("Unlinked experiment records require recovery");
      const project = state.legacy === undefined ? fallback : snapshotStoredProject(state.legacy);
      if (state.legacy !== undefined && journal && Date.parse(journal.savedAt) > Date.parse(project.savedAt ?? "1970-01-01")) {
        project.tabs = journal.tabs.map(tab => {
          const path = project.tabs.find(saved => saved.id === tab.id)?.path;
          return { id: tab.id, title: tab.title, source: tab.source, ...(path === undefined ? {} : { path }) };
        });
        project.activeTabId = journal.activeTabId;
      }
      const record = snapshotExperiment({ ...candidate, filesystem: project.filesystem,
        editor: { tabs: project.tabs, activeTabId: project.activeTabId } });
      checkExperimentQuota([], [experimentBytes(record)]);
      tx.objectStore("experimentSets").put(record, record.id);
      tx.objectStore("experimentWorkspace").put({ schemaVersion: 1, selectedSetId: record.id,
        migration: { source: "project-v1", setId: record.id } } satisfies ExperimentWorkspaceRecord, "current");
      return record;
    }, true);
  }

  save(value: ExperimentSet): Promise<ExperimentSet> {
    const captured = snapshotExperiment(value);
    return this.#transaction("readwrite", (state, tx) => {
      if (!state.workspace) throw new Error("Experiment migration is required");
      const next = updateSet(state.sets, captured);
      this.#quota(state.sets, [next]);
      tx.objectStore("experimentSets").put(next, next.id);
      return next;
    });
  }

  switch(value: ExperimentSet, requested: SwitchTarget): Promise<ExperimentSet> {
    const source = snapshotExperiment(value);
    const target: SwitchTarget = requested.kind === "new"
      ? { kind: "new", record: snapshotExperiment(requested.record) }
      : { kind: "saved", id: recordIdentifier(requested.id), revision: requested.revision };
    return this.#transaction("readwrite", (state, tx) => {
      if (!state.workspace) throw new Error("Experiment migration is required");
      const from = updateSet(state.sets, source);
      const to = target.kind === "new" ? target.record : requireSet(state.sets, target.id);
      if (from.id === to.id) throw new Error("Already using this experiment");
      if (target.kind === "new") {
        if (to.revision !== 1 || state.sets.some(record => record.id === to.id)) throw new ExperimentConflictError();
      } else if (to.revision !== target.revision) throw new ExperimentConflictError();
      this.#quota(state.sets, [from, to]);
      tx.objectStore("experimentSets").put(from, from.id);
      if (target.kind === "new") tx.objectStore("experimentSets").put(to, to.id);
      tx.objectStore("experimentWorkspace").put({ ...state.workspace, selectedSetId: to.id }, "current");
      return to;
    });
  }

  #quota(before: ExperimentSet[], updates: ExperimentSet[]): void {
    const next = new Map(before.map(record => [record.id, record]));
    for (const record of updates) next.set(record.id, record);
    checkExperimentQuota(before.map(experimentBytes), [...next.values()].map(experimentBytes));
  }
}

function requireSet(sets: ExperimentSet[], id: string): ExperimentSet {
  const result = sets.find(record => record.id === id);
  if (!result) throw new Error("Experiment is missing / 実験セットが見つかりません");
  return result;
}

function updateSet(sets: ExperimentSet[], value: ExperimentSet): ExperimentSet {
  const old = requireSet(sets, value.id);
  if (old.revision !== value.revision || old.createdAt !== value.createdAt || JSON.stringify(old.origin) !== JSON.stringify(value.origin)) {
    throw new ExperimentConflictError();
  }
  return snapshotExperiment({ ...value, revision: old.revision + 1, savedAt: new Date().toISOString() });
}
