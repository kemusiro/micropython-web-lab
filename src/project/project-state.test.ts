import { describe, expect, it } from "vitest";
import { MAX_EDITOR_TABS } from "./editor-draft";
import { MAX_PROJECT_BYTES } from "./filesystem";
import { snapshotStoredProject, type StoredProject } from "./project-state";

function project(): StoredProject {
  return {
    version: 1, savedAt: "2026-10-18T00:00:00.000Z",
    filesystem: { version: 1, entries: [
      { kind: "directory", path: "empty" },
      { kind: "file", path: "main.py", data: new TextEncoder().encode("print(1)\r\n") },
      { kind: "file", path: "data.bin", data: new Uint8Array([0, 255, 128]) },
    ] },
    tabs: [
      { id: "main", title: "main.py", path: "main.py", source: "print(2)\n" },
      { id: "draft", title: "無題", source: "print('draft')" },
      { id: "empty", title: "無題", source: "" },
    ], activeTabId: "draft",
  };
}

describe("legacy project snapshot contract", () => {
  it("retains bytes, empty directories, paths and all editor buffers independently", () => {
    const input = project();
    const captured = snapshotStoredProject(input);
    expect(captured).toEqual(input);
    expect(snapshotStoredProject(captured)).toEqual(input);
    input.filesystem.entries = [];
    input.tabs.splice(0);
    expect(captured.filesystem.entries).toHaveLength(3);
    expect(captured.tabs).toHaveLength(3);
    expect(captured.tabs[1]!.path).toBeUndefined();
    expect(captured.tabs[2]!.path).toBeUndefined();
  });

  it("detaches file bytes and tabs in both directions and excludes transient fields", () => {
    const input = project();
    const captured = snapshotStoredProject({ ...input, runtime: { running: true },
      tabs: input.tabs.map(tab => ({ ...tab, executionLine: 7 })) });
    const file = captured.filesystem.entries[2]!;
    if (file.kind !== "file") throw new Error("Expected file");
    file.data[0] = 42;
    captured.tabs[0] = { ...captured.tabs[0]!, source: "changed" };
    expect(captured).not.toHaveProperty("runtime");
    expect(captured.tabs[1]).not.toHaveProperty("executionLine");
    expect(input.filesystem.entries[2]).toMatchObject({ data: new Uint8Array([0, 255, 128]) });
    expect(input.tabs[0]!.source).toBe("print(2)\n");
  });

  it("keeps a tab whose file was deleted without recreating that file", () => {
    const input = project();
    input.filesystem.entries = [];
    expect(snapshotStoredProject(input)).toEqual(input);
  });

  it.each([
    ["null record", () => null],
    ["unknown version", (p: StoredProject) => ({ ...p, version: 2 })],
    ["empty tabs", (p: StoredProject) => ({ ...p, tabs: [] })],
    ["too many tabs", (p: StoredProject) => ({ ...p, tabs: Array.from({ length: MAX_EDITOR_TABS + 1 }, (_, i) => ({ id: `tab-${i}`, title: "無題", source: "" })) })],
    ["missing active tab", (p: StoredProject) => ({ ...p, activeTabId: "missing" })],
    ["duplicate IDs", (p: StoredProject) => ({ ...p, tabs: [p.tabs[0], p.tabs[0]] })],
    ["duplicate paths", (p: StoredProject) => ({ ...p, tabs: [p.tabs[0], { ...p.tabs[0], id: "other" }] })],
    ["null tab", (p: StoredProject) => ({ ...p, tabs: [null] })],
    ["sparse tabs", (p: StoredProject) => ({ ...p, tabs: [p.tabs[0], ,] })],
    ["invalid ID", (p: StoredProject) => ({ ...p, tabs: [{ ...p.tabs[0], id: "../main" }] })],
    ["empty title", (p: StoredProject) => ({ ...p, tabs: [{ ...p.tabs[0], title: "" }] })],
    ["long title", (p: StoredProject) => ({ ...p, tabs: [{ ...p.tabs[0], title: "x".repeat(81) }] })],
    ["oversized source", (p: StoredProject) => ({ ...p, tabs: [{ ...p.tabs[0], source: "x".repeat(200_001) }] })],
    ["non-string path", (p: StoredProject) => ({ ...p, tabs: [{ ...p.tabs[0], path: null }] })],
    ["path traversal", (p: StoredProject) => ({ ...p, tabs: [{ ...p.tabs[0], path: "../main.py" }] })],
    ["invalid bytes", (p: StoredProject) => ({ ...p, filesystem: { version: 1, entries: [{ kind: "file", path: "data.bin", data: [255] }] } })],
  ])("rejects %s without mutating the supplied record", (_name, invalid) => {
    const value = invalid(project());
    const before = structuredClone(value);
    expect(() => snapshotStoredProject(value)).toThrow();
    expect(value).toEqual(before);
  });

  it("rejects over-quota files without changing their bytes", () => {
    const data = new Uint8Array(MAX_PROJECT_BYTES + 1);
    const input = project();
    input.filesystem.entries = [{ kind: "file", path: "data.bin", data }];
    expect(() => snapshotStoredProject(input)).toThrow("4 MiB");
    expect(input.filesystem.entries[0]).toMatchObject({ path: "data.bin" });
    expect(data.byteLength).toBe(MAX_PROJECT_BYTES + 1);
    expect(data.every(byte => byte === 0)).toBe(true);
  });
});
