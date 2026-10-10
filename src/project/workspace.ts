import { ProjectFiles, projectPath, type ProjectSnapshot } from "./filesystem";
import { ProjectStore, type StoredProject } from "./project-store";
import type { EditorWorkspaceTab } from "./editor-draft";
import { hasUnsavedEditorChanges } from "./editor-file-state";

export class ProjectWorkspace {
  readonly files = new ProjectFiles();
  readonly #persistedFiles = new ProjectFiles();
  #store: ProjectStore | null;
  #loaded = false;
  restored = false;
  constructor() { this.#store = typeof indexedDB === "undefined" ? null : new ProjectStore(); }
  async load(tabs: EditorWorkspaceTab[], activeTabId: string, legacySavedAt = ""): Promise<StoredProject> {
    if (!this.#store) throw new Error("IndexedDB is unavailable / ブラウザ保存が利用できません");
    const stored = await this.#store.load();
    if (stored) {
      this.#persistedFiles.replace(stored.filesystem);
      this.files.replace(stored.filesystem); this.#loaded = true; this.restored = true;
      if (Date.parse(legacySavedAt) > Date.parse(stored.savedAt ?? "1970-01-01")) {
        // The exit journal is a recovery draft, never a write to the saved file.
        return this.stageTabs(tabs.map(tab => ({ ...tab, path: stored.tabs.find(saved => saved.id === tab.id)?.path })), activeTabId);
      }
      return stored;
    }
    this.#loaded = true;
    return this.stageTabs(tabs, activeTabId, true);
  }
  get loaded(): boolean { return this.#loaded; }
  isTabUnsaved(tab: EditorWorkspaceTab): boolean {
    return hasUnsavedEditorChanges(tab, tab.path ? this.#persistedFiles.get(tab.path) : undefined);
  }
  stageTabs(tabs: EditorWorkspaceTab[], activeTabId: string, assignLegacyPaths = false): StoredProject {
    if (!assignLegacyPaths) return { version: 1, filesystem: this.files.snapshot(), tabs: tabs.map(tab => ({ ...tab })), activeTabId };
    const next = new ProjectFiles(this.files.snapshot());
    const updated = tabs.map(tab => {
      let path = tab.path;
      // An untouched placeholder is not a file (e.g. an empty or binary ZIP).
      // Pathless tabs remain browser drafts until the user chooses a filename.
      // Automatic names are only used for the initial/legacy workspace import.
      if (!path && !tab.source) return { ...tab };
      if (!path) {
        let name = tab.title.replace(/[\\/:\x00-\x1f\x7f]/g, "_").replace(/^\.+$/, "untitled");
        if (!name.endsWith(".py")) name += ".py";
        path = name;
        let index = 2;
        while (next.get(path)) path = name.slice(0, -3) + "-" + index++ + ".py";
      }
      projectPath(path);
      next.write(path, new TextEncoder().encode(tab.source));
      return { ...tab, path };
    });
    this.files.replace(next.snapshot());
    return { version: 1, filesystem: this.files.snapshot(), tabs: updated, activeTabId };
  }
  async save(tabs: EditorWorkspaceTab[], activeTabId: string): Promise<void> {
    if (!this.#store || !this.#loaded) throw new Error("Project storage is unavailable / ブラウザ保存が利用できません");
    const snapshot = this.files.snapshot();
    await this.#store.save({ version: 1, filesystem: snapshot, tabs, activeTabId });
    this.#persistedFiles.replace(snapshot);
  }
  async replace(snapshot: ProjectSnapshot, tabs: EditorWorkspaceTab[], activeTabId: string): Promise<void> {
    if (!this.#store || !this.#loaded) throw new Error("Project storage is unavailable");
    await this.#store.save({ version: 1, filesystem: snapshot, tabs, activeTabId });
    this.#persistedFiles.replace(snapshot);
    this.files.replace(snapshot);
  }
}
