import { expect, test } from "./workspace-test";
import { readFile } from "node:fs/promises";
import { importProjectZip } from "../src/project/zip";

test("recovers edited files and untitled drafts without changing saved files, execution or ZIP contents", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const savedSource = "print('saved-version')";
  const draftSource = "print('recovered-version')";
  await page.locator("#code-editor").fill(savedSource);
  await page.locator("#save-draft-button").click();
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("main.py");
  await page.locator("#code-editor").fill(draftSource);
  await expect(page.locator("#draft-status")).toContainText("復元用の下書き: このブラウザに保存済み");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
  await page.locator(".editor-tab-new").click();
  await page.locator("#code-editor").fill("print('untitled-recovery')");
  await expect(page.locator("#draft-status")).toContainText("復元用の下書き: このブラウザに保存済み");
  await page.close();

  const recovered = await context.newPage();
  await recovered.goto("/");
  await expect(recovered.locator("#run-script-button")).toBeEnabled();
  await expect(recovered.locator("#code-editor")).toHaveValue("print('untitled-recovery')");
  await expect(recovered.getByRole("tab", { name: "無題", exact: true })).toHaveText("●無題");
  const main = recovered.getByRole("tab", { name: "main.py", exact: true });
  await main.click();
  await expect(recovered.locator("#code-editor")).toHaveValue(draftSource);
  await expect(main).toHaveText("●main.py");
  await recovered.locator("#run-script-button").click();
  await expect(recovered.locator("#terminal")).toContainText("recovered-version");
  await expect(recovered.locator("#run-script-button")).toBeEnabled();
  await expect(main).toHaveText("●main.py");
  await recovered.locator("#repl-batch > summary").click();
  await recovered.locator("#repl-input").fill("print('file-version', open('main.py').read())");
  await recovered.locator("#send-button").click();
  await expect(recovered.locator("#terminal")).toContainText("file-version print('saved-version')");
  await expect(recovered.locator("#run-script-button")).toBeEnabled();
  await recovered.locator("#project-file-tools > summary").click();
  const downloading = recovered.waitForEvent("download");
  await recovered.locator("#project-zip-export").click();
  const downloaded = await downloading;
  const exported = await importProjectZip(new Uint8Array(await readFile((await downloaded.path())!)));
  expect(exported.entries).toHaveLength(1);
  const file = exported.entries[0]!;
  expect(file.kind === "file" && new TextDecoder().decode(file.data)).toBe(savedSource);
  await expect(main).toHaveText("●main.py");
  await recovered.locator("#save-draft-button").click();
  await expect(main).toHaveText("main.py");
  await expect(recovered.locator("#draft-status")).toContainText("ファイル: このブラウザに保存済み");
  await recovered.reload();
  await expect(recovered.locator("#run-script-button")).toBeEnabled();
  await expect(recovered.locator("#code-editor")).toHaveValue(draftSource);
  await expect(main).toHaveText("main.py");
  await recovered.locator("#repl-batch > summary").click();
  await recovered.locator("#repl-input").fill("print('explicit-file', open('main.py').read())");
  await recovered.locator("#send-button").click();
  await expect(recovered.locator("#terminal")).toContainText("explicit-file print('recovered-version')");
});

test("restores a newer exit journal as drafts without rewriting files or naming untitled tabs", async ({ page }) => {
  const now = new Date("2026-10-11T00:00:00Z");
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const savedSource = await page.locator("#code-editor").inputValue();
  await page.clock.runFor(1);
  await page.locator("#code-editor").fill("print('pending-recovery')");
  await page.locator(".editor-tab-new").click();
  await page.locator("#code-editor").fill("print('pending-untitled')");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "pending");
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue("print('pending-untitled')");
  await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveText("●無題");
  await expect(page.locator("#project-file-tree [data-kind='file']")).toHaveCount(1);
  await page.getByRole("tab", { name: "main.py", exact: true }).click();
  await expect(page.locator("#code-editor")).toHaveValue("print('pending-recovery')");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
  const storedSource = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("micropython-web-lab-project", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const request = db.transaction("project").objectStore("project").get("current");
        request.onsuccess = () => resolve(new TextDecoder().decode(request.result.filesystem.entries.find((entry: { path: string }) => entry.path === "main.py").data));
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
  expect(storedSource).toBe(savedSource);
});
