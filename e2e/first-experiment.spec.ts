import { expect, test } from "@playwright/test";
import { browserFixture } from "../scripts/lib/browser-fixture.mjs";
import { MANAGED_CONNECTION_GRAPH } from "../src/connections/managed-connection-graph";

for (const width of [1280, 390]) {
  test(`runs and edits the first experiment in a simple ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const editor = page.locator("#code-editor");
    const run = page.getByRole("button", { name: "実行", exact: true });
    await expect(run).toBeEnabled();
    await expect(page.getByRole("heading", { name: "LEDを点滅させてみよう" })).toBeVisible();
    await expect(page.locator(".virtual-board-panel")).toBeHidden();
    await expect(page.locator("#workspace-toolbar")).toBeHidden();
    await expect(page.locator(".examples")).toBeHidden();
    await expect(page.locator("#terminal-shell")).toBeHidden();
    await expect(page.locator("#editor-tabs")).toBeHidden();
    await expect(page.locator("#debug-script-button")).toBeHidden();
    await expect(editor).toHaveValue(/interval_ms = 500/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await run.click();
    await expect(page.locator("#experiment-stop-button")).toBeVisible();
    await expect(page.locator("#experiment-led")).toHaveAttribute("data-on", "true");
    await expect(page.locator("#experiment-title")).toHaveText("点滅を速くしてみよう");
    await expect(page.locator("#experiment-led")).toHaveAttribute("data-on", "false");
    await expect(page.locator("#experiment-next")).toBeHidden();

    const modified = (await editor.inputValue()).replace("interval_ms = 500", "interval_ms = 200");
    await editor.fill(modified);
    await run.click();
    await expect(page.locator("#experiment-step")).toHaveText("実験完了");
    await expect(page.locator("#experiment-next")).toBeVisible();
    await page.locator("#experiment-finish-button").click();
    await expect(page.locator(".virtual-board-panel")).toBeVisible();
    await expect(editor).toHaveValue(modified);
    await expect(page.locator("#terminal")).toContainText("LED blink complete");
    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
    await expect(editor).toHaveValue(modified);
  });
}

test("the next button sample observes repeated presses and releases while running", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator("#code-editor");
  const run = page.locator("#run-script-button");
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.locator("#experiment-step")).toContainText("2 / 2");
  await editor.fill((await editor.inputValue()).replace("interval_ms = 500", "interval_ms = 200"));
  await run.click();
  await expect(page.locator("#experiment-step")).toHaveText("実験完了");
  await page.locator("#experiment-button-example").click();
  await expect(editor).toHaveValue(/button = Pin\(15, Pin.IN, Pin.PULL_UP\)/);
  await run.click();

  const terminal = page.locator("#terminal");
  const button = page.locator('[data-device-instance="button-gp15"]').getByRole("button", { name: "GP15", exact: true });
  await expect(terminal).toContainText("Press and release GPIO 15 for 8 seconds");
  await expect(terminal).toContainText("Button: released");
  for (let count = 1; count <= 2; count += 1) {
    await button.focus();
    await page.keyboard.down("Space");
    await expect.poll(async () => (await terminal.textContent())!.split("Button: pressed").length - 1).toBe(count);
    await expect(page.locator("#runtime-status")).toHaveText("スクリプト実行中");
    await page.keyboard.up("Space");
    await expect.poll(async () => (await terminal.textContent())!.split("Button: released").length - 1).toBe(count + 1);
  }
  await expect(terminal).toContainText("Button test complete");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(terminal).not.toContainText("実行時間が10秒の上限を超えた");
  await expect(terminal).not.toContainText("[script error]");
});

test("switches screens without resetting Python, drafts, or connections and reopens the experiment in a separate tab", async ({ page }) => {
  const savedConnections = JSON.stringify({
    schemaVersion: 1,
    savedAt: "2026-10-10T00:00:00.000Z",
    graph: {
      ...MANAGED_CONNECTION_GRAPH,
      devices: MANAGED_CONNECTION_GRAPH.devices.filter((device) => device.instanceId !== "spi-register-0"),
    },
  });
  await page.addInitScript((saved) => {
    if (localStorage.getItem("micropython-web-lab:connection-project:v1") === null) {
      localStorage.setItem("micropython-web-lab:connection-project:v1", saved);
    }
  }, savedConnections);
  await page.goto("/");
  const editor = page.locator("#code-editor");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const source = 'retained_value = 73\nprint("kept")';
  await editor.fill(source);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#experiment-feedback")).toContainText("LEDの点滅を確認できません");
  await expect(page.locator("#experiment-step")).toContainText("1 / 2");
  await page.locator("#open-workspace-button").click();
  await page.locator("#repl-batch > summary").click();
  await page.locator("#repl-input").fill("print(retained_value)");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("73");
  await page.locator("#repl-input").fill("unfinished input");
  const connectionBefore = await page.evaluate(() => localStorage.getItem("micropython-web-lab:connection-project:v1"));
  expect(connectionBefore).toBe(savedConnections);
  await page.locator("#open-experiment-button").click();
  await expect(editor).toHaveValue(source); // The existing experiment tab is retained.
  await page.locator("#open-workspace-button").click();
  await expect(page.locator("#repl-input")).toHaveValue("unfinished input");
  expect(await page.evaluate(() => localStorage.getItem("micropython-web-lab:connection-project:v1"))).toBe(connectionBefore);

  // A pre-existing project without a preference defaults to the full workspace.
  await page.evaluate(() => localStorage.removeItem("micropython-web-lab:app-screen:v1"));
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
  await page.locator("#open-experiment-button").click();
  await expect(editor).toHaveValue(/interval_ms = 500/);
  await expect(page.locator("#editor-tabs .editor-tab")).toHaveCount(2);
  await page.locator("#open-workspace-button").click();
  await page.getByRole("tab", { name: "main.py", exact: true }).click();
  await expect(editor).toHaveValue(source);
});

for (const viewport of [{ width: 1280, height: 600 }, { width: 390, height: 700 }, { width: 320, height: 700 }]) {
  test(`shows Run and the LED without scrolling at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#run-script-button")).toBeEnabled();
    for (const selector of ["#run-script-button", "#experiment-led"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}

test("keeps first-use edits in the experiment on reload and lets keyboard users leave the editor", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator("#code-editor");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const edited = (await editor.inputValue()).replace("500", "200");
  await editor.fill(edited);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "experiment");
  await expect(editor).toHaveValue(edited);
  await editor.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();
});

test("shows damaged saved data in the workspace without replacing it", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("micropython-web-lab:editor-workspace:v2", "damaged");
    localStorage.setItem("micropython-web-lab:app-screen:v1", "experiment");
  });
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "error");
  expect(await page.evaluate(() => localStorage.getItem("micropython-web-lab:editor-workspace:v2"))).toBe("damaged");
});

test("remembers the experiment screen and edited code across reloads and language changes", async ({ page }) => {
  await page.goto("/");
  await page.locator("#open-workspace-button").click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#open-experiment-button").click();
  const editor = page.locator("#code-editor");
  const edited = (await editor.inputValue()).replace("500", "200");
  await editor.fill(edited);
  await page.locator("#language-select").selectOption("en");
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "experiment");
  await expect(page.getByRole("heading", { name: "Make an LED blink" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await expect(editor).toHaveValue(edited);
  await page.reload();
  await expect(editor).toHaveValue(edited);
  await expect(page.locator(".virtual-board-panel")).toBeHidden();
});

test("keeps errors visible and lets the user stop an unresponsive script and retry", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator("#code-editor");
  const run = page.locator("#run-script-button");
  await expect(run).toBeEnabled();
  await editor.fill("");
  await run.click();
  await expect(page.locator("#experiment-output")).toHaveText("実行するコードを入力してください。");
  await editor.fill('raise ValueError("try again")');
  await run.click();
  await expect(page.locator("#experiment-feedback")).toContainText("最後まで実行できません");
  await expect(page.locator("#experiment-output")).toContainText("ValueError");
  await expect(page.locator("#experiment-step")).toContainText("1 / 2");
  await editor.fill("while True:\n    pass");
  await run.click();
  await page.locator("#experiment-stop-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await expect(editor).toHaveValue("while True:\n    pass");
  await page.locator("#experiment-restart-button").click();
  await expect(run).toBeEnabled();
  await editor.fill('print("recovered")');
  await run.click();
  await page.locator("#experiment-output-details summary").click();
  await expect(page.locator("#experiment-output")).toContainText("recovered");
  await expect(page.locator("#experiment-next")).toBeHidden();
});

test("supports first use and navigation when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage unavailable"); } });
  });
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "experiment");
  await expect(page.locator("#draft-status")).toContainText("ブラウザ保存を利用できません");
  await page.locator("#open-workspace-button").click();
  await expect(page.locator(".virtual-board-panel")).toBeVisible();
  await page.locator("#open-experiment-button").click();
  await expect(page.locator("#experiment-preview")).toBeVisible();
});

test("shows startup failures and allows restart directly in the simple screen", async ({ page }) => {
  const server = await browserFixture();
  try {
    server.setFault("wasm");
    await page.goto(server.url);
    await expect(page.locator("#experiment-feedback")).toContainText("実行環境を起動できません");
    await expect(page.locator("#experiment-output")).toBeVisible();
    await expect(page.locator("#run-script-button")).toBeDisabled();
    server.setFault("none");
    await page.locator("#experiment-restart-button").click();
    await expect(page.locator("#run-script-button")).toBeEnabled();
  } finally {
    await server.close();
  }
});
