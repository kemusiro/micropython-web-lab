import { ProjectFiles, projectPath, type ProjectSnapshot } from "./filesystem";
import { ProjectStore, type StoredProject } from "./project-store";
import type { EditorWorkspaceTab } from "./editor-draft";

export class ProjectWorkspace {
  readonly files = new ProjectFiles();
  #store: ProjectStore | null;
  #loaded = false;
  #savedSources = new Map<string, string>();
  #savedPaths = new Map<string, string | undefined>();
  restored = false;
  constructor() { this.#store = typeof indexedDB === "undefined" ? null : new ProjectStore(); }
  async load(tabs: EditorWorkspaceTab[], activeTabId: string, legacySavedAt = ""): Promise<StoredProject> {
    if (!this.#store) throw new Error("IndexedDB is unavailable / ブラウザ保存が利用できません");
    const stored = await this.#store.load();
    if (stored) {
      this.files.replace(stored.filesystem); this.#loaded = true; this.restored = true;
      this.#savedSources = savedSources(stored.filesystem, stored.tabs);
      this.#savedPaths = new Map(stored.tabs.map(tab => [tab.id, tab.path]));
      if (Date.parse(legacySavedAt) > Date.parse(stored.savedAt ?? "1970-01-01")) {
        return this.stageTabs(tabs.map(tab => ({ ...tab, path: stored.tabs.find(saved => saved.id === tab.id)?.path })), activeTabId);
      }
      return stored;
    }
    this.#loaded = true;
    return this.stageTabs(tabs, activeTabId);
  }
  get loaded(): boolean { return this.#loaded; }
  stageTabs(tabs: EditorWorkspaceTab[], activeTabId: string): StoredProject {
    const next = new ProjectFiles(this.files.snapshot());
    const updated = tabs.map(tab => {
      let path = tab.path;
      // An untouched placeholder is not a file (e.g. an empty or binary ZIP).
      if (!path && !tab.source) return { ...tab };
      if (!path) {
        let name = tab.title.replace(/[\\/:\x00-\x1f\x7f]/g, "_").replace(/^\.+$/, "untitled");
        if (!name.endsWith(".py")) name += ".py";
        path = name;
        let index = 2;
        while (next.get(path)) path = name.slice(0, -3) + "-" + index++ + ".py";
      }
      projectPath(path);
      if (!tab.path || this.#savedPaths.get(tab.id) !== path || this.#savedSources.get(tab.id) !== tab.source || !next.get(path)) next.write(path, new TextEncoder().encode(tab.source));
      return { ...tab, path };
    });
    this.files.replace(next.snapshot());
    this.#savedSources = new Map(updated.map(tab => [tab.id, tab.source]));
    this.#savedPaths = new Map(updated.map(tab => [tab.id, tab.path]));
    return { version: 1, filesystem: this.files.snapshot(), tabs: updated, activeTabId };
  }
  async save(tabs: EditorWorkspaceTab[], activeTabId: string): Promise<void> {
    if (!this.#store || !this.#loaded) throw new Error("Project storage is unavailable / ブラウザ保存が利用できません");
    await this.#store.save({ version: 1, filesystem: this.files.snapshot(), tabs, activeTabId });
  }
  async replace(snapshot: ProjectSnapshot, tabs: EditorWorkspaceTab[], activeTabId: string): Promise<void> {
    if (!this.#store || !this.#loaded) throw new Error("Project storage is unavailable");
    await this.#store.save({ version: 1, filesystem: snapshot, tabs, activeTabId });
    this.files.replace(snapshot);
    this.#savedSources = savedSources(snapshot, tabs);
    this.#savedPaths = new Map(tabs.map(tab => [tab.id, tab.path]));
  }
}

// A persisted editor draft can be newer than the file. Preserve that distinction.
function savedSources(snapshot: ProjectSnapshot, tabs: EditorWorkspaceTab[]): Map<string, string> {
  return new Map(tabs.map(tab => {
    const entry = snapshot.entries.find(entry => entry.path === tab.path);
    if (entry?.kind === "file") {
      try {
        const source = new TextDecoder("utf-8", { fatal: true }).decode(entry.data);
        if (source.length <= 200_000 && !source.includes("\0")) return [tab.id, source];
      } catch { /* Binary files retain the editor's baseline without being overwritten. */ }
    }
    return [tab.id, tab.source];
  }));
}
