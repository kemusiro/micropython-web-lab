import { describe, expect, it } from "vitest";

import {
  EDITOR_DRAFT_STORAGE_KEY,
  EDITOR_WORKSPACE_STORAGE_KEY,
  clearEditorDraft,
  clearEditorWorkspace,
  loadEditorDraft,
  loadEditorWorkspace,
  saveEditorDraft,
  saveEditorWorkspace,
  type DraftStorage,
} from "./editor-draft";

class MemoryStorage implements DraftStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("editor draft storage", () => {
  it("stores and restores a versioned draft", () => {
    const storage = new MemoryStorage();
    const savedAt = new Date("2026-08-25T00:00:00.000Z");

    expect(saveEditorDraft(storage, 'print("hello")', savedAt)).toEqual({
      ok: true,
      draft: {
        schemaVersion: 1,
        source: 'print("hello")',
        savedAt: "2026-08-25T00:00:00.000Z",
        boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      },
    });
    expect(loadEditorDraft(storage)).toEqual({
      status: "loaded",
      draft: {
        schemaVersion: 1,
        source: 'print("hello")',
        savedAt: "2026-08-25T00:00:00.000Z",
        boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      },
    });
  });

  it("loads an existing v1 draft without a board profile using the Pico 2 W default", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      EDITOR_DRAFT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        source: "pass",
        savedAt: "2026-08-25T00:00:00.000Z",
      }),
    );

    expect(loadEditorDraft(storage)).toEqual({
      status: "loaded",
      draft: {
        schemaVersion: 1,
        source: "pass",
        savedAt: "2026-08-25T00:00:00.000Z",
        boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      },
    });
  });

  it("stores a multi-tab workspace and restores the active tab", () => {
    const storage = new MemoryStorage();
    const savedAt = new Date("2026-10-03T00:00:00.000Z");
    const tabs = [
      { id: "main", title: "main.py", source: 'print("main")' },
      { id: "sample-1", title: "BME280 sample", source: 'print("sample")' },
    ];

    expect(saveEditorWorkspace(storage, tabs, "sample-1", savedAt)).toEqual({
      ok: true,
      workspace: {
        schemaVersion: 2,
        tabs,
        activeTabId: "sample-1",
        savedAt: "2026-10-03T00:00:00.000Z",
        boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      },
    });
    expect(loadEditorWorkspace(storage)).toEqual({
      status: "loaded",
      migratedFromDraft: false,
      workspace: {
        schemaVersion: 2,
        tabs,
        activeTabId: "sample-1",
        savedAt: "2026-10-03T00:00:00.000Z",
        boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      },
    });
  });

  it("migrates a legacy draft into the main tab without overwriting it", () => {
    const storage = new MemoryStorage();
    saveEditorDraft(storage, 'print("legacy")', new Date("2026-10-03T00:00:00.000Z"));

    expect(loadEditorWorkspace(storage)).toEqual({
      status: "loaded",
      migratedFromDraft: true,
      workspace: expect.objectContaining({
        activeTabId: "main",
        tabs: [{ id: "main", title: "main.py", source: 'print("legacy")' }],
      }),
    });
  });

  it("rejects malformed workspaces and clears both storage generations", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      EDITOR_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        tabs: [{ id: "duplicate", title: "one", source: "pass" }, { id: "duplicate", title: "two", source: "pass" }],
        activeTabId: "duplicate",
        savedAt: new Date().toISOString(),
        boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      }),
    );
    expect(loadEditorWorkspace(storage)).toEqual(expect.objectContaining({ status: "invalid" }));

    storage.values.set(EDITOR_DRAFT_STORAGE_KEY, "legacy");
    expect(clearEditorWorkspace(storage)).toEqual({ ok: true });
    expect(storage.values.has(EDITOR_WORKSPACE_STORAGE_KEY)).toBe(false);
    expect(storage.values.has(EDITOR_DRAFT_STORAGE_KEY)).toBe(false);
  });

  it("normalizes the legacy book profile id and rejects unknown profiles", () => {
    const storage = new MemoryStorage();
    const storedDraft = {
      schemaVersion: 1,
      source: "pass",
      savedAt: "2026-08-25T00:00:00.000Z",
      boardProfile: { id: "pico-2-w", version: 1 },
    };
    storage.values.set(EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(storedDraft));
    expect(loadEditorDraft(storage)).toEqual(
      expect.objectContaining({
        status: "loaded",
        draft: expect.objectContaining({
          boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
        }),
      }),
    );

    storage.values.set(
      EDITOR_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...storedDraft, boardProfile: { id: "unknown", version: 1 } }),
    );
    expect(loadEditorDraft(storage)).toEqual(expect.objectContaining({ status: "invalid" }));
  });

  it("rejects malformed and unsupported stored values", () => {
    const storage = new MemoryStorage();
    storage.values.set(EDITOR_DRAFT_STORAGE_KEY, "not-json");
    expect(loadEditorDraft(storage)).toEqual(
      expect.objectContaining({ status: "invalid" }),
    );

    storage.values.set(
      EDITOR_DRAFT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 2, source: "pass", savedAt: new Date().toISOString() }),
    );
    expect(loadEditorDraft(storage)).toEqual(
      expect.objectContaining({ status: "invalid" }),
    );
  });

  it("clears a saved draft", () => {
    const storage = new MemoryStorage();
    saveEditorDraft(storage, "pass");

    expect(clearEditorDraft(storage)).toEqual({ ok: true });
    expect(loadEditorDraft(storage)).toEqual({ status: "empty" });
  });

  it("reports storage access failures without throwing", () => {
    const storage: DraftStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(loadEditorDraft(storage)).toEqual({
      status: "unavailable",
      message: "ブラウザ保存を利用できません: blocked",
    });
    expect(saveEditorDraft(storage, "pass")).toEqual({
      ok: false,
      message: "ブラウザ保存を利用できません: quota exceeded",
    });
    expect(clearEditorDraft(storage)).toEqual({
      ok: false,
      message: "ブラウザ保存を利用できません: blocked",
    });
  });
});
