import { describe, expect, it } from "vitest";
import { ProjectWorkspace } from "./workspace";
import { MAX_PROJECT_BYTES } from "./filesystem";

describe("editor and filesystem synchronization", () => {
  it("keeps untouched placeholders out of empty or binary projects", () => {
    const workspace = new ProjectWorkspace();
    workspace.files.write("data.bin", new Uint8Array([255, 0]));
    const result = workspace.stageTabs([{ id: "main", title: "main.py", source: "" }], "main");
    expect(result.tabs[0]!.path).toBeUndefined();
    expect(result.filesystem.entries).toEqual([{ kind: "file", path: "data.bin", data: new Uint8Array([255, 0]) }]);
  });
  it("retains pathless drafts without creating files during autosave or execution", () => {
    const workspace = new ProjectWorkspace();
    const draft = { id: "sample", title: "無題", source: "print(42)" };
    const staged = workspace.stageTabs([draft], "sample");
    expect(staged.tabs).toEqual([draft]);
    expect(staged.filesystem.entries).toEqual([]);
    workspace.files.write("examples/led.py", new TextEncoder().encode(draft.source));
    const saved = workspace.stageTabs([{ ...draft, path: "examples/led.py", title: "led.py" }], "sample");
    expect(workspace.files.get("examples/led.py")).toMatchObject({ kind: "file" });
    workspace.stageTabs([{ ...saved.tabs[0]!, source: "print(7)" }, { ...draft, id: "other" }], "sample");
    expect(workspace.files.get("examples/led.py")).toMatchObject({ data: new TextEncoder().encode("print(42)") });
    expect(workspace.files.snapshot().entries.filter(entry => entry.kind === "file")).toHaveLength(1);
  });
  it("preserves binary data written by Python even when its editor draft changes", () => {
    const workspace = new ProjectWorkspace();
    const saved = workspace.stageTabs([{ id: "main", title: "main.py", source: "print(42)" }], "main", true);
    workspace.files.write("main.py", new Uint8Array([255, 0]));
    workspace.stageTabs(saved.tabs, "main");
    expect(workspace.files.get("main.py")).toMatchObject({ data: new Uint8Array([255, 0]) });
    workspace.stageTabs([{ ...saved.tabs[0]!, source: "print(7)" }], "main");
    expect(workspace.files.get("main.py")).toMatchObject({ data: new Uint8Array([255, 0]) });
  });
  it("assigns distinct paths and rejects over-quota staging without partial updates", () => {
    const workspace = new ProjectWorkspace();
    const saved = workspace.stageTabs([{ id: "one", title: "main.py", source: "a=1" }, { id: "two", title: "main.py", source: "b=2" }], "one", true);
    expect(saved.tabs.map(tab => tab.path)).toEqual(["main.py", "main-2.py"]);
    workspace.files.write("full.bin", new Uint8Array(MAX_PROJECT_BYTES - 6));
    const beforeBytes = workspace.files.usedBytes;
    expect(workspace.stageTabs([{ ...saved.tabs[0]!, source: "a=100" }, saved.tabs[1]!], "one").tabs[0]!.source).toBe("a=100");
    expect(() => workspace.stageTabs([{ ...saved.tabs[0]!, source: "a=100" }, saved.tabs[1]!], "one", true)).toThrow();
    expect(workspace.files.usedBytes).toBe(beforeBytes);
    expect(workspace.files.get("main.py")).toMatchObject({ data: new TextEncoder().encode("a=1") });
    expect(workspace.files.get("main-2.py")).toMatchObject({ data: new TextEncoder().encode("b=2") });
    const full = workspace.files.get("full.bin");
    expect(full?.kind === "file" && full.data.every(byte => byte === 0)).toBe(true);
  });
});
