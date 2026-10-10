import { expect, test } from "./workspace-test";
import type { Page } from "@playwright/test";

async function freezeAutosave(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-10-11T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-11T00:00:01Z"));
}

test("closing an untitled tab confirms draft discard, supports cancel and leaves project files intact", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const savedSource = await page.locator("#code-editor").inputValue();
  await page.locator(".editor-tab-new").click();
  await page.locator("#code-editor").fill("print('untitled draft')");
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
  let message = "";
  page.once("dialog", dialog => { message = dialog.message(); return dialog.dismiss(); });
  await page.getByRole("button", { name: "無題を閉じる", exact: true }).click();
  expect(message).toContain("この下書きは破棄されます");
  expect(message).toContain("ファイルとして保存せずに閉じてもよい");
  expect(message).not.toContain("ブラウザから削除");
  await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#code-editor")).toHaveValue("print('untitled draft')");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "無題を閉じる", exact: true }).click();
  await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveCount(0);
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveCount(0);
  await expect(page.locator("#project-file-tree [data-path='main.py']")).toHaveCount(1);
  await expect(page.locator("#code-editor")).toHaveValue(savedSource);
});

test("marks even an empty untitled tab, then removes the marker after saving it as a file", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator(".editor-tab-new").click();
  const untitled = page.getByRole("tab", { name: "無題", exact: true });
  await expect(untitled).toHaveText("●無題");
  let message = "";
  page.once("dialog", dialog => { message = dialog.message(); return dialog.dismiss(); });
  await page.getByRole("button", { name: "無題を閉じる", exact: true }).click();
  expect(message).toContain("保存せずに閉じてもよい");
  await expect(untitled).toHaveText("●無題");
  await page.locator("#code-editor").fill("print('blink')");
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
  await expect(untitled).toHaveText("●無題");
  await page.locator("#save-draft-button").click();
  await page.locator("#project-save-filename").fill("blink.py");
  await page.locator("#project-save-dialog").getByRole("button", { name: "保存", exact: true }).click();
  const saved = page.getByRole("tab", { name: "blink.py", exact: true });
  await expect(saved).toHaveText("blink.py");
  let unexpected = "";
  page.on("dialog", dialog => { unexpected = dialog.message(); return dialog.dismiss(); });
  await page.getByRole("button", { name: "blink.pyを閉じる", exact: true }).click();
  await expect(saved).toHaveCount(0);
  expect(unexpected).toBe("");
  await expect(page.locator("#project-file-tree [data-path='blink.py']")).toHaveCount(1);
});

test("clears the marker on revert or explicit save, but keeps it after draft backup", async ({ page }) => {
  await freezeAutosave(page);
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const savedSource = await page.locator("#code-editor").inputValue();
  const tab = page.getByRole("tab", { name: "main.py", exact: true });
  await expect(tab).toHaveText("main.py");
  await page.locator("#code-editor").fill("print('changed')");
  await expect(tab).toHaveText("●main.py");
  await page.locator("#code-editor").fill(savedSource);
  await expect(tab).toHaveText("main.py");
  await page.locator("#code-editor").fill("print('autosaved')");
  await expect(tab).toHaveText("●main.py");
  await page.clock.runFor(401);
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
  await expect(tab).toHaveText("●main.py");
  await page.locator("#save-draft-button").click();
  await expect(tab).toHaveText("main.py");
  await page.locator(".editor-tab-new").click();
  let unexpected = "";
  page.on("dialog", dialog => { unexpected = dialog.message(); return dialog.dismiss(); });
  await page.getByRole("button", { name: "main.pyを閉じる", exact: true }).click();
  await expect(tab).toHaveCount(0);
  expect(unexpected).toBe("");
});

for (const changedSource of ["print('discard this edit')", ""]) {
  test(`confirms and discards changed saved content, including empty text: ${JSON.stringify(changedSource)}`, async ({ page }) => {
    await freezeAutosave(page);
    await page.goto("/");
    await expect(page.locator("#run-script-button")).toBeEnabled();
    const savedSource = await page.locator("#code-editor").inputValue();
    await page.locator(".editor-tab-new").click();
    await page.getByRole("tab", { name: "main.py", exact: true }).click();
    await page.locator("#code-editor").fill(changedSource);
    const main = page.getByRole("tab", { name: "main.py", exact: true });
    await expect(main).toHaveText("●main.py");
    await page.clock.runFor(401);
    await expect(page.locator("#draft-status")).toContainText("復元用の下書き: このブラウザに保存済み");
    await expect(main).toHaveText("●main.py");
    let message = "";
    page.once("dialog", dialog => { message = dialog.message(); return dialog.dismiss(); });
    await page.getByRole("button", { name: "main.pyを閉じる", exact: true }).click();
    expect(message).toContain("変更を保存せずに閉じてもよい");
    expect(message).toContain("保存済みのファイルはプロジェクトに残ります");
    await expect(main).toHaveText("●main.py");
    await expect(page.locator("#code-editor")).toHaveValue(changedSource);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "main.pyを閉じる", exact: true }).click();
    await expect(main).toHaveCount(0);
    await page.clock.runFor(401);
    await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
    await page.reload();
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await page.locator("#project-file-tree [data-path='main.py'] > .project-tree-row").dblclick();
    await expect(page.locator("#code-editor")).toHaveValue(savedSource);
    await expect(main).toHaveText("main.py");
  });
}

for (const revert of [false, true]) {
  test(`keeps failed autosave changes out of the saved file on close, revert=${revert}`, async ({ page }) => {
  await freezeAutosave(page);
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const savedSource = await page.locator("#code-editor").inputValue();
  await page.locator(".editor-tab-new").click();
  await page.getByRole("tab", { name: "main.py", exact: true }).click();
  await page.locator("#code-editor").fill("print('failed save')");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      throw new DOMException("forced autosave failure", "QuotaExceededError");
    };
  });
  await page.clock.runFor(401);
  await expect(page.locator("#draft-status")).toContainText("forced autosave failure");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
  if (revert) {
    await page.locator("#code-editor").fill(savedSource);
    await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("main.py");
  }
  let message = "";
  const onDialog = (dialog: import("@playwright/test").Dialog) => { message = dialog.message(); return revert ? dialog.dismiss() : dialog.accept(); };
  page.on("dialog", onDialog);
  await page.getByRole("button", { name: "main.pyを閉じる", exact: true }).click();
  page.off("dialog", onDialog);
  if (revert) expect(message).toBe("");
  else expect(message).toContain("変更を保存せずに閉じてもよい");
  await page.clock.runFor(401);
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#project-file-tree [data-path='main.py'] > .project-tree-row").dblclick();
  await expect(page.locator("#code-editor")).toHaveValue(savedSource);
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("main.py");
});
}
