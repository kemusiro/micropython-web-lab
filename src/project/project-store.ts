import { projectPath, validateProjectSnapshot, type ProjectSnapshot } from "./filesystem";
import type { EditorWorkspaceTab } from "./editor-draft";

export interface StoredProject {
  version: 1;
  savedAt?: string;
  filesystem: ProjectSnapshot;
  tabs: EditorWorkspaceTab[];
  activeTabId: string;
}

/** One transaction commits the complete filesystem and editor workspace together. */
export class ProjectStore {
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
    const value = await new Promise<StoredProject | undefined>((resolve, reject) => {
      const request = db.transaction("project").objectStore("project").get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (value) {
      if (value.version !== 1 || !Array.isArray(value.tabs) || value.tabs.length > 24 || !value.tabs.length ||
          !value.tabs.every(tab => typeof tab.id === "string" && typeof tab.title === "string" && typeof tab.source === "string" && tab.source.length <= 200_000) ||
          !value.tabs.some(tab => tab.id === value.activeTabId)) throw new Error("Invalid saved editor workspace");
      validateProjectSnapshot(value.filesystem);
      const ids = new Set<string>();
      const paths = new Set<string>();
      for (const tab of value.tabs) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tab.id) || ids.has(tab.id) || !tab.title || tab.title.length > 80) throw new Error("Invalid saved editor tab");
        ids.add(tab.id);
        if (tab.path !== undefined) {
          projectPath(tab.path);
          if (paths.has(tab.path)) throw new Error("Duplicate editor file");
          paths.add(tab.path);
        }
      }
    }
    return value;
  }
  save(value: StoredProject): Promise<void> {
    validateProjectSnapshot(value.filesystem);
    // Coalesce frequent Python writes: at most one active and one pending snapshot.
    this.#pending = structuredClone({ ...value, savedAt: new Date().toISOString() });
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
