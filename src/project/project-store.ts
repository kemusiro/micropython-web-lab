import { snapshotStoredProject, type ProjectPersistence, type StoredProject } from "./project-state";
export type { StoredProject } from "./project-state";

/** One transaction commits the complete filesystem and editor workspace together. */
export class ProjectStore implements ProjectPersistence {
  #database: Promise<IDBDatabase>;
  #active: Promise<void> = Promise.resolve();
  #pending: StoredProject | null = null;
  #running = false;
  constructor() {
    this.#database = new Promise((resolve, reject) => {
      const request = indexedDB.open("micropython-web-lab-project", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("project");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Project database is blocked by another tab"));
    });
    // Report failures through load/save without an unhandled rejection during startup.
    void this.#database.catch(() => {});
  }
  async load(): Promise<StoredProject | undefined> {
    const db = await this.#database;
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction("project").objectStore("project").get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value === undefined ? undefined : snapshotStoredProject(value);
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
    const db = await this.#database;
    while (this.#pending) {
      const next = this.#pending;
      this.#pending = null;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("project", "readwrite");
        tx.objectStore("project").put(next, "current");
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error("Project save aborted"));
        tx.onerror = () => reject(tx.error);
      });
    }
  }
}
