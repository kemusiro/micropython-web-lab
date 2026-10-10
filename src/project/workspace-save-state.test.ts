import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspace } from "./workspace";
import type { StoredProject } from "./project-store";

const store = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("./project-store", () => ({ ProjectStore: class { load = store.load; save = store.save; } }));
const tab = { id: "file", title: "blink.py", path: "blink.py", source: "print(7)" };
const edited = { ...tab, source: "print(9)" };

describe("persisted file baseline", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", {});
    store.save.mockReset().mockResolvedValue(undefined);
    store.load.mockReset().mockResolvedValue({ version: 1,
      filesystem: { version: 1, entries: [{ kind: "file", path: tab.path, data: new TextEncoder().encode(tab.source) }] },
      tabs: [tab], activeTabId: tab.id } satisfies StoredProject);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps backed-up drafts dirty until an explicit file save succeeds", async () => {
    const workspace = new ProjectWorkspace();
    await workspace.load([tab], tab.id);
    expect(workspace.isTabUnsaved(tab)).toBe(false);
    await workspace.save([edited], tab.id);
    expect(store.save.mock.lastCall?.[0].tabs).toEqual([edited]);
    expect(store.save.mock.lastCall?.[0].filesystem.entries[0].data).toEqual(new TextEncoder().encode(tab.source));
    expect(workspace.isTabUnsaved(edited)).toBe(true);
    const snapshot = workspace.files.snapshot();
    snapshot.entries = [{ kind: "file", path: tab.path, data: new TextEncoder().encode(edited.source) }];
    let finish!: () => void;
    store.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const saving = workspace.replace(snapshot, [edited], tab.id);
    expect(workspace.isTabUnsaved(edited)).toBe(true);
    finish();
    await saving;
    expect(workspace.isTabUnsaved(edited)).toBe(false);
  });
  it("preserves the saved file when draft backup fails or changes are discarded", async () => {
    const workspace = new ProjectWorkspace();
    await workspace.load([tab], tab.id);
    workspace.stageTabs([edited], tab.id);
    store.save.mockRejectedValueOnce(new Error("storage failed"));
    await expect(workspace.save([edited], tab.id)).rejects.toThrow("storage failed");
    expect(workspace.isTabUnsaved(edited)).toBe(true);
    expect(workspace.files.get(tab.path)).toMatchObject({ data: new TextEncoder().encode(tab.source) });
    expect(workspace.isTabUnsaved(tab)).toBe(false);
    await workspace.save([tab], tab.id);
    expect(store.save.mock.lastCall?.[0].filesystem.entries[0].data).toEqual(new TextEncoder().encode(tab.source));
  });
  it("backs up Python writes alongside drafts without overwriting the file from the editor", async () => {
    const workspace = new ProjectWorkspace();
    await workspace.load([tab], tab.id);
    workspace.files.write(tab.path, new TextEncoder().encode("print('Python write')"));
    await workspace.save([edited], tab.id);
    expect(workspace.files.get(tab.path)).toMatchObject({ data: new TextEncoder().encode("print('Python write')") });
    expect(store.save.mock.lastCall?.[0].tabs).toEqual([edited]);
    expect(workspace.isTabUnsaved(edited)).toBe(true);
  });
  it("restores a newer exit journal without changing files or assigning names to untitled tabs", async () => {
    const workspace = new ProjectWorkspace();
    const untitled = { id: "new", title: "無題", source: "print('draft')" };
    const recovered = await workspace.load([{ ...edited, path: undefined }, untitled], untitled.id, "2026-10-11T01:00:00Z");
    expect(recovered.tabs).toEqual([edited, untitled]);
    expect(recovered.activeTabId).toBe(untitled.id);
    expect(workspace.files.get(tab.path)).toMatchObject({ data: new TextEncoder().encode(tab.source) });
    expect(workspace.files.snapshot().entries).toHaveLength(1);
    await workspace.save(recovered.tabs, recovered.activeTabId);
    expect(workspace.isTabUnsaved(edited)).toBe(true);
    expect(workspace.isTabUnsaved(untitled)).toBe(true);
    expect(store.save.mock.lastCall?.[0].tabs).toEqual([edited, untitled]);
  });
});
