import { describe, expect, it, vi } from "vitest";
import { makeExperiment } from "../../fixtures/experiments/fixture";
import { ExperimentCoordinator, ExperimentProjectPersistence, type ExperimentHost } from "./coordinator";
import { snapshotExperiment, type ExperimentSet } from "./record";
import type { SwitchTarget } from "./store";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const first = makeExperiment("first"), second = makeExperiment("second");
  let live = snapshotExperiment(first);
  const events: string[] = [];
  const store = {
    load: vi.fn(async () => snapshotExperiment(second)),
    save: vi.fn(async (record: ExperimentSet) => snapshotExperiment({ ...record, revision: record.revision + 1 })),
    switch: vi.fn(async (_source: ExperimentSet, _target: SwitchTarget) => snapshotExperiment(second)),
  };
  const host: ExperimentHost = {
    prepare: vi.fn(async () => { events.push("prepare"); }),
    lock: vi.fn(locked => { events.push(locked ? "lock" : "unlock"); }),
    stop: vi.fn(() => { events.push("stop"); }),
    capture: () => live,
    install: vi.fn(record => { live = snapshotExperiment(record); events.push(`install:${record.id}`); }),
    start: vi.fn(async record => { events.push(`start:${record.id}`); }),
  };
  const coordinator = new ExperimentCoordinator(store, host, first);
  return { first, second, store, host, coordinator, events, edit: (record: ExperimentSet) => { live = record; } };
}

describe("experiment switching coordinator", () => {
  it("does not let a caller rebind an old workspace by mutating its session object", async () => {
    const s = setup();
    const mutable = { ...s.coordinator.session };
    const port = new ExperimentProjectPersistence(s.coordinator, mutable);
    await s.coordinator.switchTo({ kind: "saved", id: "second" });
    Object.assign(mutable, s.coordinator.session);
    expect(Object.isFrozen(port.session)).toBe(true);
    expect(Object.isFrozen(s.coordinator.session)).toBe(true);
    await expect(port.load()).rejects.toThrow("Obsolete");
  });
  it("preflights, stops, commits, installs and initializes the complete target without running code", async () => {
    const s = setup();
    const old = s.coordinator.session;
    const port = new ExperimentProjectPersistence(s.coordinator);
    await s.coordinator.switchTo({ kind: "saved", id: "second" });
    expect(s.events).toEqual(["prepare", "lock", "stop", "install:second", "start:second", "unlock"]);
    expect(s.store.switch).toHaveBeenCalledWith(s.first, { kind: "saved", id: "second", revision: 1 });
    expect(s.coordinator.current).toEqual(s.second);
    expect(s.coordinator.isCurrent(old)).toBe(false);
    await expect(port.save({ version: 1, filesystem: s.first.filesystem, ...s.first.editor })).rejects.toThrow("Obsolete");
    expect(s.store.save).not.toHaveBeenCalled();
  });

  it("does not stop live execution or lock inputs if target capability checks fail", async () => {
    const s = setup();
    const old = s.coordinator.session;
    vi.mocked(s.host.prepare).mockRejectedValueOnce(new Error("runtime unavailable"));
    await expect(s.coordinator.switchTo({ kind: "saved", id: "second" })).rejects.toThrow("runtime unavailable");
    expect(s.coordinator.isCurrent(old)).toBe(true);
    expect(s.events).toEqual([]);
    expect(s.store.switch).not.toHaveBeenCalled();
  });

  it("rejects concurrent switch requests and supports cancellation only before the barrier", async () => {
    const s = setup();
    const prepare = deferred();
    vi.mocked(s.host.prepare).mockReturnValueOnce(prepare.promise);
    const abort = new AbortController();
    const switching = s.coordinator.switchTo({ kind: "new", record: s.second }, abort.signal);
    await expect(s.coordinator.switchTo({ kind: "saved", id: "second" })).rejects.toThrow("in progress");
    abort.abort();
    await expect(switching).rejects.toThrow("cancelled");
    expect(s.host.stop).not.toHaveBeenCalled();
    prepare.resolve();
    await prepare.promise;
    expect(s.store.switch).not.toHaveBeenCalled();
  });

  it("keeps the latest source edits after commit failure and rebinds a stopped session for retry", async () => {
    const s = setup();
    const edited = makeExperiment("first", "print('latest buffer')");
    s.edit(edited);
    const old = s.coordinator.session;
    s.store.switch.mockRejectedValueOnce(new Error("quota failure"));
    await expect(s.coordinator.switchTo({ kind: "new", record: s.second })).rejects.toThrow("quota failure");
    expect(s.coordinator.current).toEqual(edited);
    expect(s.events).toEqual(["prepare", "lock", "stop", "install:first", "unlock"]);
    expect(s.coordinator.isCurrent(old)).toBe(false);
    await s.coordinator.save(edited, s.coordinator.session);
    expect(s.coordinator.current.revision).toBe(2);
    expect(s.host.start).not.toHaveBeenCalled();
  });

  it("retains the committed target after startup failure instead of pretending to resume the old worker", async () => {
    const s = setup();
    vi.mocked(s.host.start).mockImplementationOnce(async record => { s.events.push(`start:${record.id}`); throw new Error("worker failed"); });
    await expect(s.coordinator.switchTo({ kind: "new", record: s.second })).rejects.toThrow("worker failed");
    expect(s.coordinator.current).toEqual(s.second);
    expect(s.coordinator.phase).toBe("failed");
    expect(s.events).toEqual(["prepare", "lock", "stop", "install:second", "start:second", "unlock"]);
  });

  it("keeps a stopped source editable if runtime disposal itself fails", async () => {
    const s = setup();
    vi.mocked(s.host.stop).mockImplementationOnce(() => { throw new Error("audio disposal failed"); });
    const old = s.coordinator.session;
    await expect(s.coordinator.switchTo({ kind: "saved", id: "second" })).rejects.toThrow("audio disposal failed");
    expect(s.coordinator.current.id).toBe("first");
    expect(s.coordinator.isCurrent(old)).toBe(false);
    expect(s.host.install).toHaveBeenCalledWith(s.first, s.coordinator.session);
    expect(s.store.switch).not.toHaveBeenCalled();
  });

  it("drains old queued saves before switching and ignores cancellation after the barrier", async () => {
    const s = setup();
    const saving = deferred();
    s.store.save.mockImplementationOnce(async record => { await saving.promise; return snapshotExperiment({ ...record, revision: 2 }); });
    const save = s.coordinator.save(s.first, s.coordinator.session);
    const abort = new AbortController();
    const switching = s.coordinator.switchTo({ kind: "saved", id: "second" }, abort.signal);
    await vi.waitFor(() => expect(s.host.lock).toHaveBeenCalledWith(true));
    abort.abort();
    expect(s.host.stop).not.toHaveBeenCalled();
    saving.resolve();
    await save;
    await switching;
    expect(s.store.switch.mock.calls[0]![0].revision).toBe(2);
    expect(s.coordinator.current).toEqual(s.second);
  });

  it("serializes revisions without losing newer unsaved buffers while an older save completes", async () => {
    const s = setup();
    const pending = deferred();
    s.store.save.mockImplementationOnce(async record => { await pending.promise; return snapshotExperiment({ ...record, revision: 2 }); });
    const first = s.coordinator.save(makeExperiment("first", "older"), s.coordinator.session);
    const next = s.coordinator.save(makeExperiment("first", "newer"), s.coordinator.session);
    pending.resolve();
    await first;
    expect(s.coordinator.current.editor.tabs[0]!.source).toBe("newer");
    await next;
    expect(s.store.save.mock.calls.map(([record]) => record.revision)).toEqual([1, 2]);
    expect(s.coordinator.current.revision).toBe(3);
  });

  it("keeps the running source if draining a failed autosave cannot establish a safe switch", async () => {
    const s = setup();
    s.store.save.mockRejectedValueOnce(new Error("save failure"));
    await expect(s.coordinator.save(s.first, s.coordinator.session)).rejects.toThrow("save failure");
    await expect(s.coordinator.switchTo({ kind: "saved", id: "second" })).rejects.toThrow("save failure");
    expect(s.host.stop).not.toHaveBeenCalled();
    expect(s.coordinator.current.id).toBe("first");
  });
});
