import { describe, expect, it } from "vitest";
import { hasUnsavedEditorChanges } from "./editor-file-state";

const tab = { id: "file", title: "blink.py", path: "blink.py", source: "print('点灯')\n" };
const file = { kind: "file" as const, path: tab.path, data: new TextEncoder().encode(tab.source) };

describe("unsaved editor changes", () => {
  it("marks pathless drafts as unsaved, including empty drafts", () => {
    expect(hasUnsavedEditorChanges({ ...tab, path: undefined })).toBe(true);
    expect(hasUnsavedEditorChanges({ ...tab, path: undefined, source: "" })).toBe(true);
  });
  it("compares against the saved file and detects edits, clearing all text and reverting edits", () => {
    expect(hasUnsavedEditorChanges(tab, file)).toBe(false);
    expect(hasUnsavedEditorChanges({ ...tab, source: "print(42)" }, file)).toBe(true);
    expect(hasUnsavedEditorChanges({ ...tab, source: "" }, file)).toBe(true);
    expect(hasUnsavedEditorChanges(tab, file)).toBe(false);
    expect(hasUnsavedEditorChanges({ ...tab, source: "" }, { ...file, data: new Uint8Array() })).toBe(false);
  });
  it("does not count textarea line ending normalization as an edit", () => {
    expect(hasUnsavedEditorChanges(tab, { ...file, data: new TextEncoder().encode(tab.source.replace(/\n/g, "\r\n")) })).toBe(false);
  });
  it("requires confirmation for missing or non-text files", () => {
    expect(hasUnsavedEditorChanges(tab)).toBe(true);
    expect(hasUnsavedEditorChanges(tab, { kind: "directory", path: tab.path })).toBe(true);
    expect(hasUnsavedEditorChanges(tab, { ...file, data: new Uint8Array([255]) })).toBe(true);
  });
});
