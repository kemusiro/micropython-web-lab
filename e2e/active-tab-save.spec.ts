import { expect, test } from "./workspace-test";

test("saves a device sample from an untitled tab into a chosen directory", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#project-file-tools > summary").click();
  await page.locator("#project-root-select").click();
  await page.locator("#project-directory-create").click();
  await page.locator("#project-entry-name").fill("examples");
  await page.locator("#project-name-dialog").getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.locator("#project-name-dialog")).toBeHidden();
  await expect(page.locator("#project-directory-create")).toBeEnabled();
  await page.locator('[data-device-example="built-in-led"]').click();
  const source = await page.locator("#code-editor").inputValue();
  await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
  await expect(page.locator("#project-file-tree [data-path*='無題']")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#code-editor")).toHaveValue(source);
  await page.locator("#project-file-tools > summary").click();
  await page.locator("#project-file-save").click();
  const dialog = page.getByRole("dialog", { name: "アクティブなタブを保存" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#project-save-filename")).toHaveValue("");
  await page.getByLabel("ディレクトリ", { exact: true }).selectOption("examples");
  await page.getByLabel("ファイル名", { exact: true }).fill("blink.py");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "blink.py", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#project-file-tree [data-path='examples/blink.py']")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.getByRole("tab", { name: "blink.py", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#code-editor")).toHaveValue(source);
  await page.locator("#project-file-tree [data-path='main.py'] > .project-tree-row").click();
  await page.locator("#code-editor").fill('print("active file updated")');
  await page.locator("#project-file-tools > summary").click();
  await page.locator("#project-file-save").click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#project-file-save")).toBeEnabled();
  await page.locator("#repl-input").fill("print('saved-content', open('examples/blink.py').read())");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText('saved-content print("active file updated")');
});

for (const width of [1280, 320]) {
  test(`cancels the chooser and corrects invalid names without naming the draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/");
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await page.locator('[data-library-device-example="built-in-led"]').click();
    await page.locator("#save-draft-button").click();
    const dialog = page.locator("#project-save-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.locator("#save-draft-button").click();
    await page.locator("#project-save-filename").fill("../bad.py");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("有効なファイル名");
    await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator("#project-save-filename").fill("led.py");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("tab", { name: "led.py", exact: true })).toHaveAttribute("aria-selected", "true");
  });
}

test("preserves the unnamed tab when storage fails and can retry saving", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator('[data-library-device-example="built-in-led"]').click();
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
  await page.locator("#save-draft-button").click();
  await page.locator("#project-save-filename").fill("retry.py");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      throw new DOMException("forced save failure", "QuotaExceededError");
    };
  });
  const dialog = page.locator("#project-save-dialog");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("forced save failure");
  await expect(page.getByRole("tab", { name: "無題", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#project-file-tree [data-path='retry.py']")).toHaveCount(0);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "retry.py", exact: true })).toHaveAttribute("aria-selected", "true");
});
