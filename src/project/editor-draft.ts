import { MAX_SCRIPT_CHARACTERS } from "../runtime/protocol";
import {
  RASPBERRY_PI_PICO_2_W_PROFILE_ID,
  RASPBERRY_PI_PICO_2_W_PROFILE_VERSION,
  resolveBoardProfile,
} from "../board/raspberry-pi-pico-2-w";

export const EDITOR_DRAFT_SCHEMA_VERSION = 1 as const;
export const EDITOR_DRAFT_STORAGE_KEY = "micropython-web-lab:editor-draft:v1";
export const EDITOR_WORKSPACE_SCHEMA_VERSION = 2 as const;
export const EDITOR_WORKSPACE_STORAGE_KEY = "micropython-web-lab:editor-workspace:v2";
export const MAX_EDITOR_TABS = 24;

export interface EditorDraftBoardProfile {
  readonly id: typeof RASPBERRY_PI_PICO_2_W_PROFILE_ID;
  readonly version: typeof RASPBERRY_PI_PICO_2_W_PROFILE_VERSION;
}

export const DEFAULT_EDITOR_DRAFT_BOARD_PROFILE: EditorDraftBoardProfile = {
  id: RASPBERRY_PI_PICO_2_W_PROFILE_ID,
  version: RASPBERRY_PI_PICO_2_W_PROFILE_VERSION,
};

export interface EditorDraft {
  schemaVersion: typeof EDITOR_DRAFT_SCHEMA_VERSION;
  source: string;
  savedAt: string;
  boardProfile: EditorDraftBoardProfile;
}

export interface EditorWorkspaceTab {
  readonly path?: string;
  readonly id: string;
  readonly title: string;
  readonly source: string;
}

export interface EditorWorkspace {
  readonly schemaVersion: typeof EDITOR_WORKSPACE_SCHEMA_VERSION;
  readonly tabs: readonly EditorWorkspaceTab[];
  readonly activeTabId: string;
  readonly savedAt: string;
  readonly boardProfile: EditorDraftBoardProfile;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type DraftLoadResult =
  | { status: "empty" }
  | { status: "loaded"; draft: EditorDraft }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string };

export type DraftWriteResult =
  | { ok: true; draft?: EditorDraft }
  | { ok: false; message: string };

export type EditorWorkspaceLoadResult =
  | { status: "empty" }
  | { status: "loaded"; workspace: EditorWorkspace; migratedFromDraft: boolean }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string };

export type EditorWorkspaceWriteResult =
  | { ok: true; workspace?: EditorWorkspace }
  | { ok: false; message: string };

export function loadEditorWorkspace(storage: DraftStorage): EditorWorkspaceLoadResult {
  let serialized: string | null;
  try {
    serialized = storage.getItem(EDITOR_WORKSPACE_STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", message: formatStorageError(error) };
  }

  if (serialized !== null) {
    try {
      const workspace = parseEditorWorkspace(JSON.parse(serialized));
      return workspace === null
        ? { status: "invalid", message: "保存されたエディタタブの形式またはバージョンが不正です。" }
        : { status: "loaded", workspace, migratedFromDraft: false };
    } catch {
      return { status: "invalid", message: "保存されたエディタタブをJSONとして読み込めません。" };
    }
  }

  const legacy = loadEditorDraft(storage);
  if (legacy.status !== "loaded") {
    return legacy.status === "empty"
      ? { status: "empty" }
      : { status: legacy.status, message: legacy.message };
  }
  return {
    status: "loaded",
    migratedFromDraft: true,
    workspace: {
      schemaVersion: EDITOR_WORKSPACE_SCHEMA_VERSION,
      tabs: [{ id: "main", title: "main.py", source: legacy.draft.source }],
      activeTabId: "main",
      savedAt: legacy.draft.savedAt,
      boardProfile: legacy.draft.boardProfile,
    },
  };
}

export function saveEditorWorkspace(
  storage: DraftStorage,
  tabs: readonly EditorWorkspaceTab[],
  activeTabId: string,
  savedAt: Date = new Date(),
): EditorWorkspaceWriteResult {
  const workspace = validateEditorWorkspaceForSave(tabs, activeTabId, savedAt);
  if (typeof workspace === "string") {
    return { ok: false, message: workspace };
  }
  try {
    storage.setItem(EDITOR_WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    return { ok: true, workspace };
  } catch (error) {
    return { ok: false, message: formatStorageError(error) };
  }
}

export function clearEditorWorkspace(storage: DraftStorage): EditorWorkspaceWriteResult {
  try {
    storage.removeItem(EDITOR_WORKSPACE_STORAGE_KEY);
    storage.removeItem(EDITOR_DRAFT_STORAGE_KEY);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: formatStorageError(error) };
  }
}

export function loadEditorDraft(storage: DraftStorage): DraftLoadResult {
  let serialized: string | null;
  try {
    serialized = storage.getItem(EDITOR_DRAFT_STORAGE_KEY);
  } catch (error) {
    return { status: "unavailable", message: formatStorageError(error) };
  }

  if (serialized === null) {
    return { status: "empty" };
  }

  try {
    const value: unknown = JSON.parse(serialized);
    const draft = parseEditorDraft(value);
    if (draft === null) {
      return { status: "invalid", message: "保存データの形式またはバージョンが不正です。" };
    }
    return { status: "loaded", draft };
  } catch {
    return { status: "invalid", message: "保存データをJSONとして読み込めません。" };
  }
}

export function saveEditorDraft(
  storage: DraftStorage,
  source: string,
  savedAt: Date = new Date(),
): DraftWriteResult {
  if (source.length > MAX_SCRIPT_CHARACTERS) {
    return { ok: false, message: `ソースコードは${MAX_SCRIPT_CHARACTERS}文字以内にしてください。` };
  }

  const draft: EditorDraft = {
    schemaVersion: EDITOR_DRAFT_SCHEMA_VERSION,
    source,
    savedAt: savedAt.toISOString(),
    boardProfile: { ...DEFAULT_EDITOR_DRAFT_BOARD_PROFILE },
  };

  try {
    storage.setItem(EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return { ok: true, draft };
  } catch (error) {
    return { ok: false, message: formatStorageError(error) };
  }
}

export function clearEditorDraft(storage: DraftStorage): DraftWriteResult {
  try {
    storage.removeItem(EDITOR_DRAFT_STORAGE_KEY);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: formatStorageError(error) };
  }
}

function parseEditorDraft(value: unknown): EditorDraft | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== EDITOR_DRAFT_SCHEMA_VERSION ||
    typeof candidate.source !== "string" ||
    candidate.source.length > MAX_SCRIPT_CHARACTERS ||
    typeof candidate.savedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.savedAt))
  ) {
    return null;
  }
  const boardProfile = parseBoardProfile(candidate.boardProfile);
  if (boardProfile === null) {
    return null;
  }
  return {
    schemaVersion: EDITOR_DRAFT_SCHEMA_VERSION,
    source: candidate.source,
    savedAt: candidate.savedAt,
    boardProfile,
  };
}

function parseEditorWorkspace(value: unknown): EditorWorkspace | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== EDITOR_WORKSPACE_SCHEMA_VERSION ||
    !Array.isArray(candidate.tabs) ||
    candidate.tabs.length < 1 ||
    candidate.tabs.length > MAX_EDITOR_TABS ||
    typeof candidate.activeTabId !== "string" ||
    typeof candidate.savedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.savedAt))
  ) {
    return null;
  }
  const ids = new Set<string>();
  const tabs: EditorWorkspaceTab[] = [];
  for (const value of candidate.tabs) {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const tab = value as Record<string, unknown>;
    if (
      typeof tab.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tab.id) ||
      ids.has(tab.id) ||
      typeof tab.title !== "string" ||
      tab.title.length < 1 ||
      tab.title.length > 80 ||
      typeof tab.source !== "string" ||
      tab.source.length > MAX_SCRIPT_CHARACTERS
    ) {
      return null;
    }
    ids.add(tab.id);
    tabs.push({ id: tab.id, title: tab.title, source: tab.source });
  }
  if (!ids.has(candidate.activeTabId)) {
    return null;
  }
  const boardProfile = parseBoardProfile(candidate.boardProfile);
  if (boardProfile === null) {
    return null;
  }
  return {
    schemaVersion: EDITOR_WORKSPACE_SCHEMA_VERSION,
    tabs,
    activeTabId: candidate.activeTabId,
    savedAt: candidate.savedAt,
    boardProfile,
  };
}

function validateEditorWorkspaceForSave(
  tabs: readonly EditorWorkspaceTab[],
  activeTabId: string,
  savedAt: Date,
): EditorWorkspace | string {
  if (tabs.length < 1 || tabs.length > MAX_EDITOR_TABS) {
    return `エディタタブは1件から${MAX_EDITOR_TABS}件まで保存できます。`;
  }
  const ids = new Set<string>();
  for (const tab of tabs) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tab.id) || ids.has(tab.id)) {
      return "エディタタブIDが不正または重複しています。";
    }
    if (tab.title.length < 1 || tab.title.length > 80) {
      return "エディタタブ名は1文字から80文字にしてください。";
    }
    if (tab.source.length > MAX_SCRIPT_CHARACTERS) {
      return `各タブのソースコードは${MAX_SCRIPT_CHARACTERS}文字以内にしてください。`;
    }
    ids.add(tab.id);
  }
  if (!ids.has(activeTabId) || !Number.isFinite(savedAt.getTime())) {
    return "選択中のエディタタブまたは保存日時が不正です。";
  }
  return {
    schemaVersion: EDITOR_WORKSPACE_SCHEMA_VERSION,
    tabs: tabs.map((tab) => ({ ...tab })),
    activeTabId,
    savedAt: savedAt.toISOString(),
    boardProfile: { ...DEFAULT_EDITOR_DRAFT_BOARD_PROFILE },
  };
}

function parseBoardProfile(value: unknown): EditorDraftBoardProfile | null {
  if (value === undefined) {
    return { ...DEFAULT_EDITOR_DRAFT_BOARD_PROFILE };
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.version !== 1) {
    return null;
  }
  try {
    resolveBoardProfile(candidate.id, candidate.version);
    return { ...DEFAULT_EDITOR_DRAFT_BOARD_PROFILE };
  } catch {
    return null;
  }
}

function formatStorageError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return `ブラウザ保存を利用できません: ${error.message}`;
  }
  return "ブラウザ保存を利用できません。";
}
