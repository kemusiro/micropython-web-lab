import { expect, test, type Locator } from "@playwright/test";

async function visibleLines(locator: Locator) {
  return locator.evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element);
    return (
      (element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) /
      parseFloat(style.lineHeight)
    );
  });
}

for (const width of [1366, 1280, 960]) {
  test(`preserves usable code and REPL heights in a short ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto("/");
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await expect.poll(() => visibleLines(page.locator("#code-editor"))).toBeGreaterThanOrEqual(10);
    await expect.poll(() => visibleLines(page.locator("#terminal"))).toBeGreaterThanOrEqual(6);

    for (const key of ["Home", "End"]) {
      await page.locator("#workspace-row-resizer").press(key);
      await expect.poll(() => visibleLines(page.locator("#code-editor"))).toBeGreaterThanOrEqual(10);
      await expect.poll(() => visibleLines(page.locator("#terminal"))).toBeGreaterThanOrEqual(6);
    }

    // Font enlargement and translated/wrapped controls must grow the workspace too.
    await page.locator("#language-select").selectOption("en");
    await page.locator("html").evaluate((element) => {
      element.style.fontSize = "20px";
    });
    await expect.poll(() => visibleLines(page.locator("#code-editor"))).toBeGreaterThanOrEqual(10);
    await expect.poll(() => visibleLines(page.locator("#terminal"))).toBeGreaterThanOrEqual(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("keeps Stop available while scrolling the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const start = await page.locator("#workspace").boundingBox();
  await page.evaluate((y) => window.scrollTo(0, y), start!.y + 150);
  const stop = await page.locator("#stop-button").boundingBox();
  expect(stop!.y).toBeGreaterThanOrEqual(0);
  expect(stop!.y + stop!.height).toBeLessThan(600);
  await page.locator("#stop-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
});

for (const width of [1280, 390]) {
  test(`switches views without losing code, REPL drafts, runtime state or pane ratios at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 650 });
    await page.goto("/");
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await page.locator("#code-editor").fill('print("view retained")');
    await page.locator("#repl-input").fill("retained_value = 73");
    await page.locator("#send-button").click();
    await expect(page.locator("#terminal")).toContainText(">>>");
    await page.locator("#repl-input").fill("retained_value + 1");
    const ratio = await page.locator("#workspace-row-resizer").getAttribute("aria-valuenow");

    await page.locator('[data-workspace-view-button="editor"]').click();
    await expect(page.locator("#script-form")).toBeVisible();
    await expect(page.locator("#terminal-shell")).toBeHidden();
    await expect(page.locator("#input-form")).toBeHidden();
    await expect(page.locator("#workspace-row-resizer")).toBeHidden();
    if (width < 960) await expect(page.locator(".virtual-board-panel")).toBeHidden();
    await page.locator("#run-script-button").click();

    await page.locator('[data-workspace-view-button="repl"]').click();
    await expect(page.locator("#script-form")).toBeHidden();
    await expect(page.locator("#terminal-shell")).toBeVisible();
    await expect(page.locator("#terminal")).toContainText("view retained");
    await expect(page.locator("#repl-input")).toHaveValue("retained_value + 1");
    await page.locator("#send-button").click();
    await expect(page.locator("#terminal")).toContainText("74");

    const normal = page.locator('[data-workspace-view-button="normal"]');
    await normal.focus();
    await page.keyboard.press("Enter");
    await expect(normal).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".virtual-board-panel")).toBeVisible();
    await expect(page.locator("#code-editor")).toHaveValue('print("view retained")');
    await expect(page.locator("#terminal-shell")).toBeVisible();
    await expect(page.locator("#workspace-row-resizer")).toHaveAttribute("aria-valuenow", ratio!);
    await page.locator('[data-workspace-view-button="repl"]').click();
    await page.reload();
    await expect(normal).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#script-form")).toBeVisible();
    await expect(page.locator("#terminal-shell")).toBeVisible();
  });
}

test("keeps debugger controls and minimum working heights across view changes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/");
  await expect(page.locator("#debug-script-button")).toBeEnabled();
  await page.locator("#code-editor").fill('value = 1\nprint(value)');
  await page.locator("#debug-script-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("デバッガ停止中");
  await expect.poll(() => visibleLines(page.locator("#code-editor"))).toBeGreaterThanOrEqual(10);
  await expect.poll(() => visibleLines(page.locator("#terminal"))).toBeGreaterThanOrEqual(6);
  await page.locator('[data-workspace-view-button="editor"]').click();
  await expect(page.locator("#debugger-command-form")).toBeHidden();
  await expect(page.locator("#runtime-status")).toHaveText("デバッガ停止中");
  await page.locator('[data-workspace-view-button="repl"]').click();
  await expect(page.locator("#debugger-command-form")).toBeVisible();
  await page.locator('[data-debugger-command="continue"]').click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#terminal")).toContainText("1");
});
