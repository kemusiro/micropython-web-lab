import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("micropython-web-lab:app-screen:v1", "workspace"));
});

test("shows three panes and preserves Python state and drafts across wiring navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#project-file-tree")).toBeVisible();
  await expect(page.locator("#repl-batch")).not.toHaveAttribute("open", "");
  await expect(page.locator("#input-form")).toBeHidden();
  const explorer = await page.locator("#workspace-explorer").boundingBox();
  const editor = await page.locator("#script-form").boundingBox();
  const board = await page.locator(".virtual-board-panel").boundingBox();
  expect(explorer!.x + explorer!.width).toBeLessThanOrEqual(editor!.x + 1);
  expect(editor!.x + editor!.width).toBeLessThanOrEqual(board!.x);
  await page.locator("#repl-batch > summary").click();
  await page.locator("#repl-input").fill("layout_value = 73\nprint('layout-ready')");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("layout-ready");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill('print("retained editor")');
  await page.locator("#repl-input").fill("layout_value + 1");
  await page.locator("#open-device-configuration").click();
  await expect(page.locator("#connection-editor-root")).toBeVisible();
  await expect(page.locator("#code-editor")).toBeHidden();
  await expect(page.locator("#stop-button")).toBeVisible();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#close-device-configuration").click();
  await expect(page.locator("#code-editor")).toHaveValue('print("retained editor")');
  await expect(page.locator("#repl-input")).toHaveValue("layout_value + 1");
  await expect(page.locator("#open-device-configuration")).toBeFocused();
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("74");
});

test("opens samples in new tabs and keeps collapsed device state current", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const rows = await page.locator(".sample-library [data-scenario-example]").evaluateAll(buttons => buttons.map(button => {
    const { top, bottom } = button.getBoundingClientRect();
    return { top, bottom };
  }));
  expect(rows.length).toBeGreaterThan(1);
  for (let index = 1; index < rows.length; index++) {
    expect(Math.abs(rows[index]!.top - rows[index - 1]!.bottom)).toBeLessThanOrEqual(1);
  }
  await page.locator("#code-editor").fill('print("keep main")');
  await page.locator('[data-scenario-example="environment-dashboard"]').click();
  await expect(page.locator(".editor-tab")).toHaveCount(2);
  await expect(page.locator("#code-editor")).toHaveValue(/BME280/);
  await page.getByRole("tab", { name: "main.py", exact: true }).click();
  await expect(page.locator("#code-editor")).toHaveValue('print("keep main")');
  await page.locator('[data-library-device-example="built-in-led"]').click();
  await expect(page.locator(".editor-tab")).toHaveCount(3);
  const led = page.locator('[data-device-instance="built-in-led"]');
  await led.locator(".device-ui-collapse").click();
  await expect(led.locator(".device-ui-components")).toBeHidden();
  await page.locator("#code-editor").fill('from machine import Pin\nPin("LED", Pin.OUT).on()');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(led.locator('.device-ui-indicator')).toHaveAttribute("data-active", "true");
  await led.locator(".device-ui-collapse").click();
  await expect(led.locator(".device-ui-components")).toBeVisible();
  await expect(led.locator('.device-ui-indicator')).toHaveAttribute("data-active", "true");
});

test("keeps the filesystem tree usable and reflows at narrow widths", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#project-file-tools > summary").click();
  await page.locator("#code-editor").fill("answer = 42\n");
  await page.locator("#project-root-select").click();
  await page.locator("#project-directory-create").click();
  await page.locator("#project-entry-name").fill("lib");
  await page.locator("#project-name-dialog").getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.locator("#project-name-dialog")).toBeHidden();
  await expect(page.locator("#project-directory-create")).toBeEnabled();
  await page.locator("#project-file-save-as").click();
  await page.locator("#project-save-directory").selectOption("lib");
  await page.locator("#project-save-filename").fill("helper.py");
  await page.locator("#project-save-dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#project-file-tree [data-path='lib/helper.py']")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#project-file-tree [data-path='lib'] > .project-tree-row").click();
  await page.locator("#project-file-tree [data-path='lib/helper.py'] > .project-tree-row").dblclick();
  await expect(page.locator("#code-editor")).toHaveValue("answer = 42\n");
  for (const width of [960, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(page.locator("#project-file-tree")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
