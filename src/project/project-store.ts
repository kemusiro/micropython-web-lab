import { snapshotStoredProject, type ProjectPersistence, type StoredProject } from "./project-state";
import { getProjectDatabase, ProjectDatabase, projectTransaction } from "./database";
export type { StoredProject } from "./project-state";

/** One transaction commits the complete filesystem and editor workspace together. */
export class ProjectStore implements ProjectPersistence {
  #active: Promise<void> = Promise.resolve();
  #pending: StoredProject | null = null;
  #running = false;
  constructor(readonly database: ProjectDatabase = getProjectDatabase()) {}
  async load(): Promise<StoredProject | undefined> {
    return this.#legacyTransaction("readonly", (value) => value === undefined ? undefined : snapshotStoredProject(value));
  }
  save(value: StoredProject): Promise<void> {
    // Coalesce frequent Python writes: at most one active and one pending snapshot.
    this.#pending = snapshotStoredProject({ ...value, savedAt: new Date().toISOString() });
    if (!this.#running) {
      this.#running = true;
      this.#active = this.#drain().finally(() => { this.#running = false; });
    }
    return this.#active;
  }
  async #drain(): Promise<void> {
    while (this.#pending) {
      const next = this.#pending;
      this.#pending = null;
      await this.#legacyTransaction("readwrite", (_value, tx) => { tx.objectStore("project").put(next, "current"); });
    }
  }
  #legacyTransaction<T>(mode: IDBTransactionMode, apply: (value: unknown, tx: IDBTransaction) => T): Promise<T> {
    return projectTransaction(this.database, ["project", "experimentWorkspace"], mode,
      tx => [tx.objectStore("project").get("current"), tx.objectStore("experimentWorkspace").get("current")],
      ([value, workspace], tx) => {
        if (workspace !== undefined) throw new Error("Experiment workspace is active; legacy writes are disabled / 実験セット対応画面で開いてください");
        return apply(value, tx);
      });
  }
}
