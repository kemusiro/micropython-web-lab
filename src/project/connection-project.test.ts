import { describe, expect, it } from "vitest";

import { MANAGED_CONNECTION_GRAPH } from "../connections/managed-connection-graph";
import type { DraftStorage } from "./editor-draft";
import {
  CONNECTION_PROJECT_STORAGE_KEY,
  clearConnectionProject,
  loadConnectionProject,
  saveConnectionProject,
} from "./connection-project";

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

describe("connection project storage", () => {
  it("round-trips a validated connection graph", () => {
    const storage = new MemoryStorage();
    const saved = saveConnectionProject(
      storage,
      MANAGED_CONNECTION_GRAPH,
      new Date("2026-10-03T00:00:00.000Z"),
    );

    expect(saved.ok).toBe(true);
    const loaded = loadConnectionProject(storage);
    expect(loaded).toMatchObject({
      status: "loaded",
      project: { savedAt: "2026-10-03T00:00:00.000Z" },
    });
    if (loaded.status === "loaded") {
      expect(loaded.project.graph).toEqual(MANAGED_CONNECTION_GRAPH);
    }
  });

  it("retains invalid data and reports it without silently resetting", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      CONNECTION_PROJECT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), graph: {} }),
    );

    expect(loadConnectionProject(storage)).toMatchObject({ status: "invalid" });
    expect(storage.getItem(CONNECTION_PROJECT_STORAGE_KEY)).not.toBeNull();
  });

  it("clears the saved project explicitly", () => {
    const storage = new MemoryStorage();
    saveConnectionProject(storage, MANAGED_CONNECTION_GRAPH);

    expect(clearConnectionProject(storage)).toEqual({ ok: true });
    expect(loadConnectionProject(storage)).toEqual({ status: "empty" });
  });
});
