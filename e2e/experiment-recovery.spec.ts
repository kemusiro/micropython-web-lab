import { expect, test } from "./workspace-test";
import { readFile } from "node:fs/promises";

test("migrates legacy binary files and a newer draft once while retaining the originals", async ({ page }) => {
  await page.goto("/distribution-LICENSES.txt");
  await page.evaluate(async () => {
    const project = { version: 1, savedAt: "2000-01-01T00:00:00.000Z", filesystem: { version: 1, entries: [
      { kind: "file", path: "main.py", data: new TextEncoder().encode("print('saved legacy')\r\n") },
      { kind: "file", path: "data.bin", data: new Uint8Array([255, 0, 128]) },
      { kind: "directory", path: "empty" },
    ] }, tabs: [{ id: "main", title: "main.py", path: "main.py", source: "print('old buffer')" }], activeTabId: "main" };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("micropython-web-lab-project", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("project");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("project", "readwrite"); tx.objectStore("project").put(project, "current");
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
    localStorage.setItem("micropython-web-lab:editor-workspace:v2", JSON.stringify({ schemaVersion: 2, savedAt: "2026-10-19T00:00:00Z",
      boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 }, tabs: [
        { id: "main", title: "main.py", source: "print('recovered legacy draft')" },
        { id: "new", title: "無題", source: "print('untitled legacy')" },
      ], activeTabId: "new" }));
  });
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#experiment-set-name")).toHaveText("これまでの作業");
  await expect(page.locator("#code-editor")).toHaveValue("print('untitled legacy')");
  await page.getByRole("tab", { name: "main.py", exact: true }).click();
  await expect(page.locator("#code-editor")).toHaveValue("print('recovered legacy draft')");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
  await page.reload(); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#experiment-saved").click();
  await expect(page.locator("[data-saved-experiment]")).toHaveCount(1);
  const downloading = page.waitForEvent("download"); await page.locator("#experiment-emergency-backup").click();
  const packet = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
  expect(packet.stored.legacy.tabs[0].source).toBe("print('old buffer')");
  const migrated = packet.stored.sets[0].value;
  expect(migrated.filesystem.entries.find((entry: any) => entry.path === "data.bin").data.data).toEqual([255, 0, 128]);
  expect(migrated.filesystem.entries.some((entry: any) => entry.kind === "directory" && entry.path === "empty")).toBe(true);
  expect(migrated.editor.tabs[1].path).toBeUndefined();
});

test("keeps code read-only for invalid legacy wiring and recovers only after an explicit repair", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("micropython-web-lab:connection-project:v1") !== null) return;
    localStorage.setItem("micropython-web-lab:connection-project:v1", "{invalid legacy graph");
    localStorage.setItem("micropython-web-lab:editor-workspace:v2", JSON.stringify({ schemaVersion: 2, savedAt: "2026-10-19T00:00:00Z",
      boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 }, tabs: [{ id: "main", title: "main.py", source: "print('recovered wiring')" }], activeTabId: "main" }));
  });
  await page.goto("/");
  await expect(page.locator("#code-editor")).toHaveValue("print('recovered wiring')");
  await expect(page.locator("#run-script-button")).toBeDisabled();
  await expect(page.locator("#experiment-set-status")).toContainText("配線を復旧");
  await page.locator("#experiment-repair-wiring").click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#terminal")).not.toContainText("recovered wiring");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("recovered wiring");
  expect(await page.evaluate(() => localStorage.getItem("micropython-web-lab:connection-project:v1"))).toBe("{invalid legacy graph");
});

for (const fault of ["runtime", "schema"] as const) {
  test(`keeps an unsupported ${fault} record available for recovery without substituting or executing it`, async ({ page }) => {
    await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
    await page.locator("#code-editor").fill("print('retained unsupported experiment')");
    await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
    await page.evaluate(async fault => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("micropython-web-lab-project"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["experimentSets", "experimentWorkspace"], "readwrite");
        const selected = tx.objectStore("experimentWorkspace").get("current");
        selected.onsuccess = () => {
          const request = tx.objectStore("experimentSets").get(selected.result.selectedSetId);
          request.onsuccess = () => {
            const record = request.result;
            if (fault === "schema") record.recordVersion = 77;
            else record.runtimeRef.buildHash = "f".repeat(64);
            tx.objectStore("experimentSets").put(record, record.id);
          };
        };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      }); db.close();
    }, fault);
    await page.reload();
    await expect(page.locator("#code-editor")).toHaveValue("print('retained unsupported experiment')");
    await expect(page.locator("#code-editor")).toHaveAttribute("readonly");
    await expect(page.locator("#run-script-button")).toBeDisabled();
    await expect(page.locator("#restart-button")).toBeDisabled();
    const downloading = page.waitForEvent("download"); await page.locator("#experiment-emergency-backup").click();
    const backup = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
    const record = backup.stored.sets[0].value;
    expect(record.editor.tabs[0].source).toBe("print('retained unsupported experiment')");
    if (fault === "schema") expect(record.recordVersion).toBe(77);
    else expect(record.runtimeRef.buildHash).toBe("f".repeat(64));
  });
}

test("retains recovered exit buffers in memory if their first IndexedDB save fails", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-19T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-19T00:00:01Z"));
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#code-editor").fill("print('pending recovered buffer')");
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "experimentSets") throw new DOMException("recovery save quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue("print('pending recovered buffer')");
  await expect(page.locator("#code-editor")).not.toHaveAttribute("readonly");
  await expect(page.locator("#draft-status")).toContainText("recovery save quota");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
});
