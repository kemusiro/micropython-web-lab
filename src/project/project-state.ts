import { MAX_EDITOR_TABS, type EditorWorkspaceTab } from "./editor-draft";
import { projectPath, validateProjectSnapshot, type ProjectSnapshot } from "./filesystem";
import { MAX_SCRIPT_CHARACTERS } from "../runtime/protocol";

/** The existing project record, shared by persistence and experiment migration. */
export interface StoredProject {
  version: 1;
  savedAt?: string;
  filesystem: ProjectSnapshot;
  tabs: EditorWorkspaceTab[];
  activeTabId: string;
}

export interface ProjectPersistence {
  load(): Promise<StoredProject | undefined>;
  /** Resolves only after the complete record has committed. */
  save(value: StoredProject): Promise<void>;
}

/** Validate and detach data without promoting editor buffers to saved files. */
export function snapshotStoredProject(value: unknown): StoredProject {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tabs) ||
      !value.tabs.length || value.tabs.length > MAX_EDITOR_TABS ||
      typeof value.activeTabId !== "string" ||
      (value.savedAt !== undefined && typeof value.savedAt !== "string")) {
    throw new Error("Invalid saved editor workspace");
  }
  validateProjectSnapshot(value.filesystem);
  const ids = new Set<string>();
  const paths = new Set<string>();
  const tabs = Array.from(value.tabs, (tab: unknown): EditorWorkspaceTab => {
    if (!isRecord(tab) || typeof tab.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tab.id) || ids.has(tab.id) ||
        typeof tab.title !== "string" || !tab.title || tab.title.length > 80 ||
        typeof tab.source !== "string" || tab.source.length > MAX_SCRIPT_CHARACTERS) {
      throw new Error("Invalid saved editor tab");
    }
    ids.add(tab.id);
    if (tab.path !== undefined) {
      if (typeof tab.path !== "string") throw new Error("Invalid editor file path");
      projectPath(tab.path);
      if (paths.has(tab.path)) throw new Error("Duplicate editor file");
      paths.add(tab.path);
    }
    return {
      id: tab.id, title: tab.title, source: tab.source,
      ...(tab.path === undefined ? {} : { path: tab.path }),
    };
  });
  if (!ids.has(value.activeTabId)) throw new Error("Invalid active editor tab");
  return {
    version: 1,
    ...(value.savedAt === undefined ? {} : { savedAt: value.savedAt }),
    filesystem: {
      version: 1,
      entries: value.filesystem.entries.map(entry => entry.kind === "file"
        ? { kind: "file", path: entry.path, data: entry.data.slice() }
        : { kind: "directory", path: entry.path }),
    },
    tabs,
    activeTabId: value.activeTabId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
