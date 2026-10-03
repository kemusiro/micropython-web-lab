import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_STORAGE_KEY,
  loadWorkspaceLayout,
  normalizeWorkspaceLayout,
  saveWorkspaceLayout,
  type WorkspaceLayoutStorage,
} from "./workspace-layout";

class MemoryStorage implements WorkspaceLayoutStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("workspace layout", () => {
  it("stores and restores both pane ratios", () => {
    const storage = new MemoryStorage();
    saveWorkspaceLayout(storage, { columnRatio: 0.68, editorRatio: 0.62 });

    expect(loadWorkspaceLayout(storage)).toEqual({ columnRatio: 0.68, editorRatio: 0.62 });
    expect(JSON.parse(storage.values.get(WORKSPACE_LAYOUT_STORAGE_KEY)!)).toEqual({
      schemaVersion: 1,
      columnRatio: 0.68,
      editorRatio: 0.62,
    });
  });

  it("falls back for malformed or unsupported stored values", () => {
    const storage = new MemoryStorage();
    storage.values.set(WORKSPACE_LAYOUT_STORAGE_KEY, '{"schemaVersion":2}');
    expect(loadWorkspaceLayout(storage)).toEqual(DEFAULT_WORKSPACE_LAYOUT);

    storage.values.set(WORKSPACE_LAYOUT_STORAGE_KEY, "not-json");
    expect(loadWorkspaceLayout(storage)).toEqual(DEFAULT_WORKSPACE_LAYOUT);
  });

  it("keeps restored ratios inside the supported range", () => {
    expect(normalizeWorkspaceLayout({ columnRatio: 10, editorRatio: -10 })).toEqual({
      columnRatio: 0.78,
      editorRatio: 0.45,
    });
    expect(normalizeWorkspaceLayout({ columnRatio: Number.NaN, editorRatio: Infinity })).toEqual(
      DEFAULT_WORKSPACE_LAYOUT,
    );
  });
});
