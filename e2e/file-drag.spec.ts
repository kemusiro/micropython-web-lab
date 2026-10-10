import { expect, test } from "./workspace-test";

for (const width of [1280, 390]) {
  test(`drags an open file onto a nested directory and back onto /project at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await page.locator("#repl-input").fill("import os; os.mkdir('lib'); os.mkdir('lib/nested'); open('helper.py', 'w').write('answer = 7\\n'); print('drag-fixture')");
    await page.locator("#send-button").click();
    await expect(page.locator("#terminal")).toContainText("drag-fixture");
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await page.locator("#project-file-tree [data-path='lib'] > .project-tree-row").click();
    const source = page.locator("#project-file-tree [data-path='helper.py'] > .project-tree-row");
    await source.dblclick();
    await source.dragTo(page.locator("#project-file-tree [data-path='lib/nested'] > .project-tree-row"));
    await expect(page.locator("#project-file-tree [data-path='helper.py']")).toHaveCount(0);
    const moved = page.locator("#project-file-tree [data-path='lib/nested/helper.py'] > .project-tree-row");
    await expect(moved).toBeVisible();
    await expect(page.getByRole("tab", { name: "helper.py", exact: true })).toHaveAttribute("title", "/project/lib/nested/helper.py");
    await expect(page.locator("#code-editor")).toHaveValue("answer = 7\n");
    await page.locator("#code-editor").fill("answer = 9\n");
    await page.locator("#save-draft-button").click();
    await expect(page.locator("#save-draft-button")).toBeEnabled();
    await moved.dragTo(page.locator("#project-root-select"));
    await expect(source).toBeVisible();
    await expect(moved).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "helper.py", exact: true })).toHaveAttribute("title", "/project/helper.py");
    await expect(page.locator("#project-files [data-drop-active], #project-files [data-dragging]")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await expect(page.locator("#code-editor")).toHaveValue("answer = 9\n");
    await page.locator("#repl-input").fill("import os; print('drag-content', open('helper.py').read()); print('drag-old-path', 'helper.py' in os.listdir('lib/nested'))");
    await page.locator("#send-button").click();
    await expect(page.locator("#terminal")).toContainText("drag-content answer = 9");
    await expect(page.locator("#terminal")).toContainText("drag-old-path False");
  });
}

test("preserves both files on a drop collision and retries a failed drop without losing the original", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#repl-input").fill("import os; os.mkdir('a'); os.mkdir('b'); os.mkdir('c'); open('a/helper.py', 'w').write('answer = 7\\n'); open('b/helper.py', 'w').write('answer = 8\\n'); print('drag-retry-fixture')");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("drag-retry-fixture");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#project-file-tree [data-path='a'] > .project-tree-row").click();
  const source = page.locator("#project-file-tree [data-path='a/helper.py'] > .project-tree-row");
  await source.dblclick();
  await page.locator("#save-draft-button").click();
  await expect(page.locator("#save-draft-button")).toBeEnabled();
  await source.dragTo(page.locator("#project-file-tree [data-path='b'] > .project-tree-row"));
  await expect(page.locator("#draft-status")).toContainText("既に存在");
  await expect(source).toBeVisible();
  await expect(page.getByRole("tab", { name: "helper.py", exact: true })).toHaveAttribute("title", "/project/a/helper.py");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args: Parameters<typeof put>) {
      IDBObjectStore.prototype.put = put;
      throw new DOMException("forced drag failure", "QuotaExceededError");
    };
  });
  const destination = page.locator("#project-file-tree [data-path='c'] > .project-tree-row");
  await source.dragTo(destination);
  await expect(page.locator("#draft-status")).toContainText("forced drag failure");
  await expect(source).toBeVisible();
  await expect(page.locator("#project-file-tree [data-path='c/helper.py']")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "helper.py", exact: true })).toHaveAttribute("title", "/project/a/helper.py");
  await source.dragTo(destination);
  await expect(page.locator("#project-file-tree [data-path='c/helper.py']")).toBeVisible();
  await expect(source).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#repl-input").fill("print('drag-original', open('c/helper.py').read()); print('drag-collision', open('b/helper.py').read())");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("drag-original answer = 7");
  await expect(page.locator("#terminal")).toContainText("drag-collision answer = 8");
});

test("highlights valid drop targets and ignores the current parent, files and external drop data", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#repl-input").fill("import os; os.mkdir('target'); open('helper.py', 'w').write('kept'); print('drag-target-fixture')");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("drag-target-fixture");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const source = page.locator("#project-file-tree [data-path='helper.py'] > .project-tree-row");
  const directory = page.locator("#project-file-tree [data-path='target'] > .project-tree-row");
  const external = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("application/x-web-lab-project-file", "helper.py");
    return data;
  });
  await directory.dispatchEvent("dragover", { dataTransfer: external });
  await directory.dispatchEvent("drop", { dataTransfer: external });
  await expect(source).toBeVisible();
  await expect(page.locator("#project-file-tree [data-path='target/helper.py']")).toHaveCount(0);
  const internal = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer: internal });
  await directory.dispatchEvent("dragover", { dataTransfer: internal });
  await expect(directory).toHaveAttribute("data-drop-active", "true");
  await directory.dispatchEvent("dragleave");
  await expect(directory).not.toHaveAttribute("data-drop-active", "true");
  await page.locator("#project-root-select").dispatchEvent("dragover", { dataTransfer: internal });
  await expect(page.locator("#project-root-select")).not.toHaveAttribute("data-drop-active", "true");
  await page.locator("#project-root-select").dispatchEvent("drop", { dataTransfer: internal });
  await source.dragTo(page.locator("#project-file-tree [data-path='main.py'] > .project-tree-row"));
  await expect(source).toBeVisible();
  await expect(page.locator("#project-file-tree [data-kind='directory'] > .project-tree-row")).toHaveAttribute("draggable", "false");
  await expect(page.locator("#project-files [data-drop-active], #project-files [data-dragging]")).toHaveCount(0);
});

test("cancels an active file drag when Python starts running", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#repl-input").fill("import os; os.mkdir('target'); open('helper.py', 'w').write('kept'); print('drag-lock-fixture')");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("drag-lock-fixture");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#code-editor").fill("print('drag-lock-running')\nwhile True:\n pass");
  const source = page.locator("#project-file-tree [data-path='helper.py'] > .project-tree-row");
  const destination = page.locator("#project-file-tree [data-path='target'] > .project-tree-row");
  const data = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer: data });
  await destination.dispatchEvent("dragover", { dataTransfer: data });
  await expect(destination).toHaveAttribute("data-drop-active", "true");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("drag-lock-running");
  await expect(source).toHaveAttribute("draggable", "false");
  await expect(page.locator("#project-files [data-drop-active], #project-files [data-dragging]")).toHaveCount(0);
  await destination.dispatchEvent("drop", { dataTransfer: data });
  await expect(page.locator("#project-file-tree [data-path='helper.py']")).toHaveCount(1);
  await expect(page.locator("#project-file-tree [data-path='target/helper.py']")).toHaveCount(0);
  await page.locator("#stop-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await page.locator("#restart-button").click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(source).toHaveAttribute("draggable", "true");
});
