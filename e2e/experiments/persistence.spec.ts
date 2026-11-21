import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => { await page.goto("/fixtures/experiments/"); });

test("migrates bytes, paths, dirty buffers and wiring once, retaining the legacy record", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const options = f.migrationOptions();
    await f.seedLegacy("migration", options.fallback);
    const database = new f.ProjectDatabase(indexedDB, "migration");
    const store = new f.ExperimentStore(database);
    const journal = { savedAt: "2026-10-19T00:00:00Z", activeTabId: "new", tabs: [
      { id: "main", title: "main.py", source: "recovered draft" },
      { id: "new", title: "無題", source: "new untitled" },
    ] };
    const first = await store.migrateLegacy({ ...options, journal,
      view: { id: "devices-v1", section: "configuration", deviceOrder: ["button"] } });
    const again = await store.migrateLegacy(options);
    const old = await f.rawValue(await database.connection(), "project");
    const selected = await store.selected();
    return { first, againId: again.id, count: (await store.list()).length, selectedId: selected!.id,
      binary: Array.from(first.filesystem.entries.find((entry: any) => entry.path === "data.bin")!.data),
      oldTabs: old.tabs, oldSavedSource: new TextDecoder().decode(old.filesystem.entries.find((entry: any) => entry.path === "main.py").data),
      savedSource: new TextDecoder().decode(first.filesystem.entries.find((entry: any) => entry.path === "main.py")!.data) };
  });
  expect(result.againId).toBe(result.first.id);
  expect(result.selectedId).toBe(result.first.id);
  expect(result.count).toBe(1);
  expect(result.binary).toEqual([0, 255, 128]);
  expect(result.first.editor).toEqual({ tabs: [
    { id: "main", title: "main.py", path: "main.py", source: "recovered draft" },
    { id: "new", title: "無題", source: "new untitled" },
  ], activeTabId: "new" });
  expect(result.first.environment.connectionGraph.devices[0].ports[0].endpoint.pin).toBe("GP15");
  expect(result.first.view).toEqual({ id: "devices-v1", section: "configuration", deviceOrder: ["button"] });
  expect(result.oldTabs[0].source).toContain("draft-first");
  expect(result.savedSource).toBe(result.oldSavedSource);
  expect(result.savedSource).toContain("saved-first");
});

for (const ordinal of [1, 2]) {
  test(`migration abort after put ${ordinal} leaves no duplicate or partial selection`, async ({ page }) => {
    const result = await page.evaluate(async ordinal => {
      const f = await import("/fixtures/experiments/fixture.ts");
      await f.seedLegacy("migration-abort");
      const database = new f.ProjectDatabase(indexedDB, "migration-abort");
      const store = new f.ExperimentStore(database);
      await database.connection();
      const restore = f.abortAfterPut(ordinal);
      let failed = false;
      try { await store.migrateLegacy(f.migrationOptions()); } catch { failed = true; }
      finally { restore(); }
      const db = await database.connection();
      const beforeRetry = { count: (await store.list()).length, selected: await store.selected(), old: await f.rawValue(db, "project") };
      const retried = await store.migrateLegacy(f.migrationOptions());
      return { failed, beforeRetry, count: (await store.list()).length, id: retried.id, again: (await store.migrateLegacy(f.migrationOptions())).id };
    }, ordinal);
    expect(result.failed).toBe(true);
    expect(result.beforeRetry.count).toBe(0);
    expect(result.beforeRetry.selected).toBeUndefined();
    expect(result.beforeRetry.old.tabs[0].source).toContain("draft-first");
    expect(result.count).toBe(1);
    expect(result.id).toBe(result.again);
  });
}

for (const ordinal of [1, 2, 3]) {
  test(`switch abort after put ${ordinal} rolls back source, new set and selection together`, async ({ page }) => {
    const result = await page.evaluate(async ordinal => {
      const f = await import("/fixtures/experiments/fixture.ts");
      const database = new f.ProjectDatabase(indexedDB, "switch-abort");
      const store = new f.ExperimentStore(database);
      const source = await store.migrateLegacy(f.migrationOptions());
      const edited = f.snapshotExperiment({ ...source, editor: { ...source.editor,
        tabs: [{ ...source.editor.tabs[0], source: "latest source draft" }, source.editor.tabs[1]] } });
      const target = f.makeExperiment("second");
      const restore = f.abortAfterPut(ordinal);
      let failed = false;
      try { await store.switch(edited, { kind: "new", record: target }); } catch { failed = true; }
      finally { restore(); }
      const old = await store.load(source.id);
      const selection = await store.selected();
      const count = (await store.list()).length;
      await store.switch(edited, { kind: "new", record: target });
      const committedSource = await store.load(source.id);
      return { failed, count, unchanged: JSON.stringify(old) === JSON.stringify(source), selection: selection!.id,
        sourceId: source.id, current: await store.selected(), committedSource };
    }, ordinal);
    expect(result.failed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.unchanged).toBe(true);
    expect(result.selection).toBe(result.sourceId);
    expect(result.current.id).toBe("second");
    expect(result.current.environment.connectionGraph.devices[0].ports[0].endpoint.pin).toBe("GP14");
    expect(result.committedSource.editor.tabs[0].source).toBe("latest source draft");
    expect(result.committedSource.revision).toBe(2);
  });
}

test("a target revision changed after preflight aborts the complete switch", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "target-conflict"));
    const first = await store.migrateLegacy(f.migrationOptions());
    const second = await store.switch(first, { kind: "new", record: f.makeExperiment("second") });
    const source = await store.switch(second, { kind: "saved", id: first.id, revision: 2 });
    const prepared = await store.load("second");
    await store.save(prepared);
    let error = "";
    try { await store.switch(source, { kind: "saved", id: prepared.id, revision: prepared.revision }); }
    catch (e) { error = (e as Error).name; }
    return { error, sourceBefore: source.revision, sourceAfter: (await store.load(first.id)).revision,
      selected: (await store.selected())!.id, expected: first.id };
  });
  expect(result.error).toBe("ExperimentConflictError");
  expect(result.sourceBefore).toBe(result.sourceAfter);
  expect(result.selected).toBe(result.expected);
});

test("two browser windows saving the same revision yield one commit and one conflict", async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto("/fixtures/experiments/");
  await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "windows"));
    await store.migrateLegacy(f.migrationOptions());
  });
  for (const tab of [page, second]) {
    await tab.evaluate(async () => {
      const f = await import("/fixtures/experiments/fixture.ts");
      (window as any).testStore = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "windows"));
      (window as any).testRecord = await (window as any).testStore.selected();
    });
  }
  const outcomes = await Promise.all([page, second].map((tab, i) => tab.evaluate(async i => {
    const w = window as any;
    w.testRecord.editor.tabs[0].source = `writer-${i}`;
    try { await w.testStore.save(w.testRecord); return "committed"; }
    catch (error) { return (error as Error).name; }
  }, i)));
  expect(outcomes.sort()).toEqual(["ExperimentConflictError", "committed"].sort());
  const saved = await page.evaluate(async () => (window as any).testStore.selected());
  expect(saved.revision).toBe(2);
  expect(saved.editor.tabs[0].source).toMatch(/^writer-[01]$/);
});

test("legacy saves cannot pass the migration barrier or overwrite an experiment", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    await f.seedLegacy("legacy-barrier");
    const database = new f.ProjectDatabase(indexedDB, "legacy-barrier");
    await database.connection();
    const store = new f.ExperimentStore(database);
    const legacy = new f.ProjectStore(database);
    const migration = store.migrateLegacy(f.migrationOptions());
    const delayed = legacy.save(f.experimentProject(f.makeExperiment("obsolete"))).then(() => "saved", e => e.message);
    const migrated = await migration;
    const lateResult = await delayed;
    let loadError = "";
    try { await legacy.load(); } catch (e) { loadError = (e as Error).message; }
    const raw = await f.rawValue(await database.connection(), "project");
    return { lateResult, loadError, rawSource: raw.tabs[0].source, source: (await store.load(migrated.id)).editor.tabs[0].source };
  });
  expect(result.lateResult).toContain("legacy writes are disabled");
  expect(result.loadError).toContain("legacy writes are disabled");
  expect(result.rawSource).toContain("draft-first");
  expect(result.source).toContain("draft-first");
});

test("versionchange closes an obsolete connection and requires reload", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const database = new f.ProjectDatabase(indexedDB, "versionchange");
    await new f.ExperimentStore(database).migrateLegacy(f.migrationOptions());
    const next = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("versionchange", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let error = "";
    try { await database.connection(); } catch (e) { error = (e as Error).message; }
    next.close();
    return { closed: database.closed, error };
  });
  expect(result.closed).toBe(true);
  expect(result.error).toContain("再読み込み");
});

test("blocked upgrades fail visibly and cannot silently migrate after the blocking tab closes", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("blocked", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("project");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = new f.ProjectDatabase(indexedDB, "blocked");
    let error = "";
    try { await database.connection(); } catch (e) { error = (e as Error).message; }
    held.close();
    const recovered = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("blocked", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const version = recovered.version;
    recovered.close();
    return { error, version };
  });
  expect(result.error).toContain("blocked by another tab");
  expect(result.version).toBe(1);
});

test("unknown records remain available through read-only recovery without automatic normalization", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const database = new f.ProjectDatabase(indexedDB, "unknown-record");
    const store = new f.ExperimentStore(database);
    const first = await store.migrateLegacy(f.migrationOptions());
    const raw = { ...first, recordVersion: 77 };
    const connection = await database.connection();
    await new Promise<void>((resolve, reject) => {
      const tx = connection.transaction("experimentSets", "readwrite");
      tx.objectStore("experimentSets").put(raw, first.id);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    let error = "";
    try { await store.selected(); } catch (e) { error = (e as Error).message; }
    const recovered = await store.readForRecovery(first.id);
    return { error, recovered };
  });
  expect(result.error).toContain("Unsupported experiment record version");
  expect(result.recovered.recordVersion).toBe(77);
  expect(result.recovered.editor.tabs[0].source).toContain("draft-first");
});

test("invalid legacy wiring preserves the code as a recovery-only experiment", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "invalid-connection"));
    const record = await store.migrateLegacy({ ...f.migrationOptions(), environment: { kind: "unavailable", reason: "invalid-legacy-connection" } });
    return { record: await store.selected(), id: record.id };
  });
  expect(result.record.id).toBe(result.id);
  expect(result.record.environment.kind).toBe("unavailable");
  expect(result.record.editor.tabs[0].source).toContain("draft-first");
});

test("the 17th set is rejected without changing the source revision or selected pointer", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "set-quota"));
    let current = await store.migrateLegacy(f.migrationOptions());
    for (let i = 1; i < 16; i++) current = await store.switch(current, { kind: "new", record: f.makeExperiment(`copy-${i}`) });
    let error = "";
    try { await store.switch(current, { kind: "new", record: f.makeExperiment("over-quota") }); }
    catch (e) { error = (e as Error).message; }
    return { error, count: (await store.list()).length, before: current, after: await store.selected() };
  });
  expect(result.error).toContain("16");
  expect(result.count).toBe(16);
  expect(result.after).toEqual(result.before);
});

test("browser quota failure rejects the transaction and keeps the committed project intact", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "disk-quota"));
    const first = await store.migrateLegacy(f.migrationOptions());
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException("Disk is full", "QuotaExceededError"); };
    let error = "";
    try { await store.switch(first, { kind: "new", record: f.makeExperiment("second") }); }
    catch (e) { error = (e as Error).name; }
    finally { IDBObjectStore.prototype.put = original; }
    return { error, count: (await store.list()).length, before: first, after: await store.selected() };
  });
  expect(result.error).toBe("QuotaExceededError");
  expect(result.count).toBe(1);
  expect(result.after).toEqual(result.before);
});

test("the workspace port restores dirty buffers and rejects an old worker's late save after a real switch", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const { ProjectWorkspace } = await import("/src/project/workspace.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "coordinator"));
    const first = await store.migrateLegacy(f.migrationOptions());
    let live = first;
    const starts: string[] = [];
    const coordinator = new f.ExperimentCoordinator(store, {
      prepare: async () => {}, lock: () => {}, stop: () => {}, capture: () => live,
      install: (record: any) => { live = record; }, start: async (record: any) => { starts.push(record.id); },
    }, first);
    const oldPort = new f.ExperimentProjectPersistence(coordinator);
    const workspace = new ProjectWorkspace(oldPort);
    const restored = await workspace.load(first.editor.tabs, first.editor.activeTabId);
    const beforeDirty = restored.tabs.every(tab => workspace.isTabUnsaved(tab));
    workspace.files.write("main.py", new Uint8Array([255, 0]));
    await workspace.save(restored.tabs, restored.activeTabId);
    live = coordinator.current;
    await coordinator.switchTo({ kind: "new", record: f.makeExperiment("second") });
    let staleError = "";
    try { await oldPort.save(restored); } catch (e) { staleError = (e as Error).message; }
    await coordinator.switchTo({ kind: "saved", id: first.id });
    const returned = coordinator.current;
    const reopened = new ProjectWorkspace(new f.ExperimentProjectPersistence(coordinator));
    const editor = await reopened.load(returned.editor.tabs, returned.editor.activeTabId);
    return { beforeDirty, staleError, starts, dirty: editor.tabs.every(tab => reopened.isTabUnsaved(tab)),
      bytes: Array.from(reopened.files.get("main.py")!.data), editor: editor.tabs, returnedId: returned.id,
      target: await store.load("second"), firstId: first.id };
  });
  expect(result.beforeDirty).toBe(true);
  expect(result.dirty).toBe(true);
  expect(result.bytes).toEqual([255, 0]);
  expect(result.staleError).toContain("Obsolete");
  expect(result.starts).toEqual(["second", result.firstId]);
  expect(result.returnedId).toBe(result.firstId);
  expect(result.editor[0].source).toContain("draft-first");
  expect(result.target.editor.tabs[0].source).toContain("draft-second");
});

test("the aggregate 64 MiB limit includes UTF-8 editor buffers and binary bytes", async ({ page }) => {
  test.setTimeout(60_000);
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "byte-quota"));
    let current = await store.migrateLegacy(f.migrationOptions());
    const source = "あ".repeat(200_000);
    for (let i = 0; i < 3; i++) {
      const template = f.makeExperiment(`large-${i}`);
      const large = f.snapshotExperiment({ ...template,
        filesystem: { version: 1, entries: [{ kind: "file", path: "data.bin", data: new Uint8Array(4 * 1024 * 1024) }] },
        editor: { tabs: Array.from({ length: 24 }, (_, j) => ({ id: `tab-${j}`, title: "無題", source })), activeTabId: "tab-0" },
      });
      current = await store.switch(current, { kind: "new", record: large });
    }
    const over = f.snapshotExperiment({ ...current, id: "over-byte-quota", revision: 1 });
    let error = "";
    try { await store.switch(current, { kind: "new", record: over }); }
    catch (e) { error = (e as Error).message; }
    return { error, selected: (await store.selected())!.id, expected: current.id, count: (await store.list()).length };
  });
  expect(result.error).toContain("64 MiB");
  expect(result.selected).toBe(result.expected);
  expect(result.count).toBe(4);
});

test("uses a fresh template only when no legacy record exists, including a migration race", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const fresh = f.makeExperiment("fresh", "new template");
    const empty = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "fresh-empty"));
    const created = await empty.migrateLegacy({ ...f.migrationOptions(), freshRecord: fresh });
    await f.seedLegacy("fresh-race");
    const raced = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "fresh-race"));
    const migrated = await raced.migrateLegacy({ ...f.migrationOptions(), freshRecord: fresh });
    return { created: created.id, source: migrated.editor.tabs[0].source, origin: migrated.origin.kind };
  });
  expect(result.created).toBe("fresh");
  expect(result.source).toContain("draft-first");
  expect(result.origin).toBe("legacy");
});

test("deletion checks the stored revision and refuses the current selection", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "delete"));
    const first = await store.migrateLegacy(f.migrationOptions());
    await store.switch(first, { kind: "new", record: f.makeExperiment("second") });
    let conflict = "", selected = "";
    try { await store.remove(first.id, first.revision); } catch (e) { conflict = (e as Error).name; }
    try { await store.remove("second", 1); } catch (e) { selected = (e as Error).message; }
    await store.remove(first.id, (await store.load(first.id)).revision);
    return { conflict, selected, ids: (await store.list()).map(record => record.id) };
  });
  expect(result.conflict).toBe("ExperimentConflictError");
  expect(result.selected).toContain("current set");
  expect(result.ids).toEqual(["second"]);
});

test("measures saves near both limits at desktop and a narrow viewport with CPU throttling", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.evaluate(async () => {
    const f = await import("/fixtures/experiments/fixture.ts");
    const store = new f.ExperimentStore(new f.ProjectDatabase(indexedDB, "capacity-timing"));
    let current = await store.migrateLegacy(f.migrationOptions());
    for (let i = 1; i < 16; i++) {
      const record = f.snapshotExperiment({ ...f.makeExperiment(`large-${i}`), filesystem: { version: 1, entries: [
        { kind: "file", path: "data.bin", data: new Uint8Array(4 * 1024 * 1024) },
      ] } });
      current = await store.switch(current, { kind: "new", record });
    }
    (window as any).timingStore = store;
    (window as any).timingCurrent = current;
  });
  const session = await page.context().newCDPSession(page);
  const samples = [];
  for (const [width, rate] of [[1280, 1], [390, 4]]) {
    await page.setViewportSize({ width, height: 800 });
    await session.send("Emulation.setCPUThrottlingRate", { rate });
    const sample = await page.evaluate(async () => {
      const w = window as any;
      const before = performance.now();
      w.timingCurrent = await w.timingStore.save(w.timingCurrent);
      return { elapsedMs: Math.round(performance.now() - before), revision: w.timingCurrent.revision };
    });
    samples.push({ width, cpuRate: rate, ...sample });
  }
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await testInfo.attach("capacity-save-timing.json", { body: JSON.stringify({ sets: 16, binaryMiB: 60, samples }), contentType: "application/json" });
  console.log("experiment capacity save timing", JSON.stringify(samples));
  expect(samples[1]!.revision).toBe(samples[0]!.revision + 1);
});
