import { describe, expect, it } from "vitest";
import { snapshotStoredProject, type ProjectPersistence, type StoredProject } from "./project-state";
import { ProjectWorkspace } from "./workspace";

const tab = { id: "main", title: "main.py", path: "main.py", source: "print(1)" };
function project(): StoredProject {
  return { version: 1, filesystem: { version: 1, entries: [
    { kind: "file", path: tab.path, data: new TextEncoder().encode(tab.source) },
  ] }, tabs: [tab], activeTabId: tab.id };
}

function delayedStore() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  let pending!: StoredProject;
  const committed = project();
  const store: ProjectPersistence = {
    load: async () => committed,
    save: value => {
      pending = value;
      return new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    },
  };
  return { store, committed, get pending() { return pending; },
    finish: () => resolve(), fail: () => reject(new Error("save aborted")) };
}

describe("workspace persistence boundary", () => {
  it("rebinds a retained source without mistaking uncommitted filesystem changes for saved files", () => {
    const workspace = new ProjectWorkspace(null);
    const uncommitted = project();
    uncommitted.filesystem.entries = [{ kind: "file", path: "main.py", data: new TextEncoder().encode("Python changed the file") }];
    workspace.restore(uncommitted, project().filesystem);
    expect(workspace.loaded).toBe(true);
    expect(workspace.files.snapshot()).toEqual(uncommitted.filesystem);
    expect(workspace.isTabUnsaved(tab)).toBe(false);
    expect(workspace.isTabUnsaved({ ...tab, source: "Python changed the file" })).toBe(true);
  });
  it("owns the loaded data independently of the persistence adapter", async () => {
    const port = delayedStore();
    const workspace = new ProjectWorkspace(port.store);
    const restored = await workspace.load([tab], tab.id);
    port.committed.tabs.splice(0);
    port.committed.filesystem.entries.splice(0);
    expect(restored).toEqual(project());
    expect(workspace.isTabUnsaved(tab)).toBe(false);
  });

  it("captures an explicit file save before awaiting commit", async () => {
    const port = delayedStore();
    const workspace = new ProjectWorkspace(port.store);
    await workspace.load([tab], tab.id);
    const edited = { ...tab, source: "print(2)" };
    const replacement = project().filesystem;
    const file = replacement.entries[0]!;
    if (file.kind !== "file") throw new Error("Expected file");
    file.data = new TextEncoder().encode(edited.source);
    const tabs = [edited];
    const saving = workspace.replace(replacement, tabs, tab.id);
    expect(workspace.isTabUnsaved(edited)).toBe(true);
    expect(workspace.files.snapshot()).toEqual(project().filesystem);
    // Further UI edits must not alter either the transaction or its committed baseline.
    file.data.fill(0);
    tabs.splice(0);
    expect(port.pending.tabs).toEqual([edited]);
    expect(port.pending.filesystem.entries[0]).toMatchObject({ data: new TextEncoder().encode(edited.source) });
    port.finish();
    await saving;
    expect(workspace.files.snapshot()).toEqual(port.pending.filesystem);
    expect(workspace.isTabUnsaved(edited)).toBe(false);
  });

  it("leaves files and dirty buffers intact when explicit replacement fails", async () => {
    const port = delayedStore();
    const workspace = new ProjectWorkspace(port.store);
    await workspace.load([tab], tab.id);
    const edited = { ...tab, source: "print(2)" };
    const staged = snapshotStoredProject(project());
    staged.filesystem.entries = [{ kind: "file", path: tab.path, data: new TextEncoder().encode(edited.source) }];
    const saving = workspace.replace(staged.filesystem, [edited], tab.id);
    port.fail();
    await expect(saving).rejects.toThrow("save aborted");
    expect(workspace.files.snapshot()).toEqual(project().filesystem);
    expect(workspace.isTabUnsaved(edited)).toBe(true);
    expect(workspace.isTabUnsaved(tab)).toBe(false);
  });

  it("validates legacy staging before committing any files to memory", () => {
    const workspace = new ProjectWorkspace(null);
    workspace.files.replace(project().filesystem);
    expect(() => workspace.stageTabs([{ ...tab, path: undefined }], "missing", true)).toThrow();
    expect(workspace.files.snapshot()).toEqual(project().filesystem);
  });
});
