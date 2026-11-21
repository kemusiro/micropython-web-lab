import { expect, test, type Page } from "@playwright/test";
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

for (const [navigation, locale] of [["reload", "ja"], ["reopen", "ja"], ["reload", "en"]] as const) {
  test(`keeps edit guidance consistent with retained code after ${navigation} in ${locale}`, async ({ page }) => {
    await page.goto("/");
    if (locale === "en") await page.locator("#language-select").selectOption("en");
    const editor = page.locator("#code-editor");
    const run = page.locator("#run-script-button");
    const step = page.locator("#experiment-step");
    const instruction = page.locator("#experiment-instruction");
    const complete = locale === "ja" ? "実験完了" : "Experiment complete";
    await expect(run).toBeEnabled();
    await run.click();
    await expect(step).toContainText("2 / 2");
    await expect(instruction).toContainText("500");

    const edited = (await editor.inputValue()).replace("interval_ms = 500", "interval_ms = 200");
    await editor.fill(edited);
    await run.click();
    await expect(step).toHaveText(complete);
    if (navigation === "reload") {
      await page.reload();
    } else {
      await page.locator("#open-workspace-button").click();
      await page.locator("#open-experiment-button").click();
    }
    await expect(run).toBeEnabled();
    await expect(editor).toHaveValue(edited);
    await run.click();
    await expect(step).toContainText("2 / 2");
    await expect(page.locator("#experiment-title")).toHaveText(locale === "ja" ? "点滅の間隔を変えてみよう" : "Change the blink interval");
    await expect(instruction).toHaveText(locale === "ja"
      ? "点滅の間隔を決める値を変えて、もう一度「実行」を押してください。"
      : "Change the value that controls the blink interval, then press Run again.");
    await expect(editor).toHaveValue(edited);

    await editor.fill(edited.replace("interval_ms = 200", "interval_ms = 100"));
    await run.click();
    await expect(step).toHaveText(complete);
  });
}

async function openButtonExperiment(page: Page, url = "/", inputAvailable = true): Promise<void> {
  await page.goto(url);
  const editor = page.locator("#code-editor");
  const run = page.locator("#run-script-button");
  await expect(run).toBeEnabled();
  if (await page.locator("body").getAttribute("data-app-screen") === "workspace") {
    await page.locator("#open-experiment-button").click();
    await expect(page.locator("body")).toHaveAttribute("data-app-screen", "experiment");
  }
  await run.click();
  await expect(page.locator("#experiment-step")).toContainText("2 / 2");
  await editor.fill((await editor.inputValue()).replace("interval_ms = 500", "interval_ms = 200"));
  await run.click();
  await expect(page.locator("#experiment-step")).toHaveText("実験完了");
  // Preserve a low scroll position before the asynchronous guided-set switch.
  await page.locator("#experiment-button-example").evaluate(node => node.scrollIntoView({ block: "end" }));
  await page.locator("#experiment-button-example").click();
  await expect(page.locator("body")).toHaveAttribute("data-experiment-topic", "button");
  if (inputAvailable) await expect(run).toBeEnabled();
}

test("keeps the button experiment attached to its restored tab instead of an older workspace tab", async ({ page }) => {
  const music = '# YM2203 playback workspace\nprint("my YM2203 playback")';
  await page.addInitScript(source => {
    if (localStorage.getItem("micropython-web-lab:editor-workspace:v2") !== null) return;
    localStorage.setItem("micropython-web-lab:app-screen:v1", "workspace");
    localStorage.setItem("micropython-web-lab:editor-workspace:v2", JSON.stringify({
      schemaVersion: 2, savedAt: "2000-01-01T00:00:00.000Z",
      boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      tabs: [{ id: "main", title: "main.py", source }], activeTabId: "main",
    }));
  }, music);
  await page.goto("/");
  const editor = page.locator("#code-editor");
  const run = page.locator("#run-script-button");
  await expect(run).toBeEnabled();
  await page.locator("#open-experiment-button").click();
  await run.click();
  await expect(page.locator("#experiment-step")).toContainText("2 / 2");
  await editor.fill((await editor.inputValue()).replace("interval_ms = 500", "interval_ms = 200"));
  await run.click();
  await expect(page.locator("#experiment-step")).toHaveText("実験完了");
  await page.locator("#experiment-button-example").click();
  await expect(page.locator("body")).toHaveAttribute("data-experiment-topic", "button");
  await expect(run).toBeEnabled();
  const buttonSource = (await editor.inputValue()) + "\n# retained button experiment";
  await editor.fill(buttonSource);
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  // The exit journal can be older than the authoritative IndexedDB workspace.
  await page.addInitScript(source => localStorage.setItem("micropython-web-lab:editor-workspace:v2", JSON.stringify({
    schemaVersion: 2, savedAt: "2000-01-01T00:00:00.000Z",
    boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
    tabs: [{ id: "main", title: "main.py", source }], activeTabId: "main",
  })), music);
  await page.reload();
  await expect(run).toBeEnabled();
  await expect(editor).toHaveValue(buttonSource);
  await page.locator("#open-workspace-button").click();
  await page.locator("#open-experiment-button").click();
  await run.click();
  await expect(page.locator("#experiment-step")).toContainText("2 / 2");
  await editor.fill((await editor.inputValue()).replace("interval_ms = 200", "interval_ms = 100"));
  await run.click();
  await expect(page.locator("#experiment-step")).toHaveText("実験完了");
  await page.locator("#experiment-button-example").click();
  await expect(editor).toHaveValue(buttonSource);
  await run.click();
  await page.getByRole("button", { name: "GP15", exact: true }).press("Space");
  await expect(page.locator("#experiment-output")).toContainText("Button: pressed");
  await expect(page.locator("#experiment-feedback")).toContainText("押す・離す入力を確認できました");
  await page.locator("#open-workspace-button").click();
  await page.locator("#experiment-saved").click();
  await page.locator("[data-saved-experiment]").filter({ has: page.getByRole("heading", { name: "これまでの作業", exact: true }) }).getByRole("button", { name: "開く", exact: true }).click();
  await expect(editor).toHaveValue(music);
});

test("retains unrelated legacy code instead of treating an old button preference as an experiment", async ({ page }) => {
  const music = '# YM2203 playback workspace\nprint("my YM2203 playback")';
  await page.addInitScript(source => {
    localStorage.setItem("micropython-web-lab:app-screen:v1", "experiment");
    localStorage.setItem("micropython-web-lab:experiment-topic:v1", "button");
    localStorage.setItem("micropython-web-lab:editor-workspace:v2", JSON.stringify({
      schemaVersion: 2, savedAt: "2000-01-01T00:00:00.000Z",
      boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      tabs: [{ id: "main", title: "main.py", source }], activeTabId: "main",
    }));
  }, music);
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
  await expect(page.locator("#code-editor")).toHaveValue(music);
});

test("preserves all 24 legacy tabs and opens a guided set without consuming their tab limit", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("micropython-web-lab:app-screen:v1", "experiment");
    localStorage.setItem("micropython-web-lab:experiment-topic:v1", "button");
    localStorage.setItem("micropython-web-lab:editor-workspace:v2", JSON.stringify({
      schemaVersion: 2, savedAt: "2000-01-01T00:00:00.000Z",
      boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      tabs: Array.from({ length: 24 }, (_, index) => ({ id: `tab-${index}`, title: `work-${index}.py`, source: `print(${index})` })),
      activeTabId: "tab-0",
    }));
  });
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
  await expect(page.locator("#code-editor")).toHaveValue("print(0)");
  await expect(page.locator("#editor-tabs .editor-tab")).toHaveCount(24);
  await page.locator("#open-experiment-button").click();
  await expect(page.locator("#code-editor")).toHaveValue(/interval_ms = 500/);
  await expect(page.locator("#editor-tabs .editor-tab")).toHaveCount(1);
  await page.locator("#open-workspace-button").click();
  await page.locator("#experiment-saved").click();
  await page.locator("[data-saved-experiment]").filter({ has: page.getByRole("heading", { name: "これまでの作業", exact: true }) }).getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.locator("#editor-tabs .editor-tab")).toHaveCount(24);
});

for (const width of [1280, 390]) {
  test(`the next button experiment stays focused and observes repeated presses at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await openButtonExperiment(page);
    const editor = page.locator("#code-editor");
    const run = page.locator("#run-script-button");
    await expect(page.locator("body")).toHaveAttribute("data-app-screen", "experiment");
    await expect(page.locator("body")).toHaveAttribute("data-experiment-topic", "button");
    await expect(page.locator("#experiment-title")).toHaveText("ボタンを押して、入力の変化を見よう");
    await expect(page.locator("#workspace-explorer")).toBeHidden();
    await expect(page.locator("#workspace-toolbar")).toBeHidden();
    await expect(page.locator("#experiment-preview")).toBeHidden();
    await expect(page.locator("#device-ui-root > .device-ui-card:visible")).toHaveCount(1);
    await expect(editor).toHaveValue(/button = Pin\(15, Pin.IN, Pin.PULL_UP\)/);
    const output = page.locator("#experiment-output");
    const button = page.locator('[data-device-instance="button-gp15"]').getByRole("button", { name: "GP15", exact: true });
    await expect(run).toBeInViewport();
    await expect(button).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await run.click();
    await expect(output).toBeVisible();
    await expect(output).toBeInViewport();
    await expect(output).toContainText("Press and release GPIO 15 for 8 seconds");
    await expect(output).toContainText("Button: released");
    const initialOutputHeight = await output.evaluate(element => element.getBoundingClientRect().height);
    const result = page.locator("#experiment-result");
    const initialResultHeight = await result.evaluate(element => element.getBoundingClientRect().height);
    for (let count = 1; count <= 6; count += 1) {
      if (count === 6) {
        // New input should bring the latest message back into view after scrolling up.
        await output.evaluate(element => { element.scrollTop = 0; });
        await expect.poll(() => output.evaluate(element => element.scrollTop)).toBe(0);
      }
      await button.focus();
      await page.keyboard.down("Space");
      await expect.poll(async () => (await output.textContent())!.split("Button: pressed").length - 1).toBe(count);
      await expect(page.locator("#experiment-feedback")).toContainText("押下を確認しました");
      expect(await output.evaluate(element => element.getBoundingClientRect().height)).toBe(initialOutputHeight);
      expect(await result.evaluate(element => element.getBoundingClientRect().height)).toBe(initialResultHeight);
      await expect(page.locator("#runtime-status")).toHaveText("スクリプト実行中");
      await page.keyboard.up("Space");
      await expect.poll(async () => (await output.textContent())!.split("Button: released").length - 1).toBe(count + 1);
      expect(await output.evaluate(element => element.getBoundingClientRect().height)).toBe(initialOutputHeight);
      expect(await result.evaluate(element => element.getBoundingClientRect().height)).toBe(initialResultHeight);
      await expect.poll(() => output.evaluate(element =>
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
    }
    expect(await output.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(output).toContainText("Button test complete");
    await expect.poll(() => output.evaluate(element =>
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
    await expect(page.locator("#runtime-status")).toHaveText("実行可能");
    await expect(page.locator("#experiment-feedback")).toContainText("押す・離す入力を確認できました");
    await expect(page.locator("#experiment-button-example")).toBeHidden();
    const source = await editor.inputValue();
    await page.locator("#experiment-finish-button").click();
    await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
    await expect(page.locator('[data-device-instance="analog-gp26"]')).toHaveCount(0);
    await expect(page.locator("#terminal")).toContainText("Button: pressed");
    await expect(editor).toHaveValue(source);
    await page.locator("#open-experiment-button").click();
    await expect(editor).toHaveValue(/interval_ms = 200/);
    await expect(page.locator("body")).toHaveAttribute("data-experiment-topic", "led");
  });
}

test("restores the button experiment and edited code in English and recovers from errors and stops", async ({ page }) => {
  await openButtonExperiment(page);
  const editor = page.locator("#code-editor");
  const run = page.locator("#run-script-button");
  const source = (await editor.inputValue()).replace("< 8000:", "< 500:");
  await editor.fill(source);
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.locator("#language-select").selectOption("en");
  await expect(run).toBeEnabled();
  await expect(page.locator("body")).toHaveAttribute("data-experiment-topic", "button");
  await expect(editor).toHaveValue(source);
  await expect(page.locator("#experiment-instruction")).toContainText("press and release the GP15 button");
  await run.click();
  await expect(page.locator("#experiment-feedback")).toContainText("without detecting both a press and release");
  await editor.fill('raise ValueError("button retry")');
  await run.click();
  await expect(page.locator("#experiment-output")).toContainText("ValueError");
  await expect(page.locator("#experiment-feedback")).toContainText("could not finish");
  await editor.fill("while True:\n    pass");
  await run.click();
  await page.locator("#experiment-stop-button").click();
  await expect(page.locator("#experiment-restart-button")).toBeVisible();
  await page.locator("#experiment-restart-button").click();
  await expect(run).toBeEnabled();
  await expect(editor).toHaveValue("while True:\n    pass");
  await expect(page.locator("#device-ui-root > .device-ui-card:visible")).toHaveCount(1);
});

test("keeps legacy wiring separate and releases keyboard input when leaving the focused view", async ({ page }) => {
  const graph = {
    ...MANAGED_CONNECTION_GRAPH,
    devices: MANAGED_CONNECTION_GRAPH.devices.map(device => device.instanceId === "button-gp15"
      ? { ...device, ports: device.ports.map(port => ({ ...port, endpoint: { kind: "gpio", pin: "GP13" } })) }
      : device),
  };
  const saved = JSON.stringify({ schemaVersion: 1, savedAt: "2026-10-15T00:00:00.000Z", graph });
  await page.addInitScript(value => localStorage.setItem("micropython-web-lab:connection-project:v1", value), saved);
  await openButtonExperiment(page);
  await expect(page.locator("#code-editor")).toHaveValue(/button = Pin\(15, Pin.IN, Pin.PULL_UP\)/);
  await expect(page.locator("#experiment-instruction")).toContainText("GP15");
  await page.locator("#run-script-button").click();
  const button = page.locator('[data-device-instance="button-gp15"]').getByRole("button", { name: "GP15", exact: true });
  await button.focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#experiment-output")).toContainText("Button: pressed");
  await page.locator("#open-workspace-button").click();
  await page.keyboard.up("Space");
  await expect.poll(async () => (await page.locator("#terminal").textContent())!.split("Button: released").length - 1).toBe(2);
  await expect(button).toHaveAttribute("data-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("micropython-web-lab:connection-project:v1"))).toBe(saved);
  await page.locator("#stop-button").click();
});

test("opens a wired button set while retaining the original disconnected legacy graph", async ({ page }) => {
  const graph = { ...MANAGED_CONNECTION_GRAPH, devices: MANAGED_CONNECTION_GRAPH.devices.filter(device => device.instanceId !== "button-gp15") };
  const saved = JSON.stringify({ schemaVersion: 1, savedAt: "2026-10-15T00:00:00.000Z", graph });
  await page.addInitScript(value => {
    if (localStorage.getItem("micropython-web-lab:connection-project:v1") === null)
      localStorage.setItem("micropython-web-lab:connection-project:v1", value);
  }, saved);
  await openButtonExperiment(page);
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue(/button = Pin\(15,/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("micropython-web-lab:connection-project:v1")!).graph))
    .toEqual(graph);
  await page.locator("#run-script-button").click();
  await page.getByRole("button", { name: "GP15", exact: true }).press("Space");
  await expect(page.locator("#experiment-output")).toContainText("Button: pressed");
  await expect.poll(async () => (await page.locator("#experiment-output").textContent())!.split("Button: released").length - 1).toBe(2);
  await page.locator("#experiment-stop-button").click();
  await page.locator("#experiment-restart-button").click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#open-workspace-button").click();
  await page.locator("#open-device-configuration").click();
  await expect(page.getByLabel("押しボタンを接続", { exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "配線を適用" })).toBeDisabled();
  await page.getByLabel("BME280環境センサーを接続").check();
  await page.getByRole("button", { name: "配線を適用" }).click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("micropython-web-lab:connection-project:v1")!).graph.devices
    .some((device: { instanceId: string }) => device.instanceId === "button-gp15"))).toBe(false);
});

test("ignores obsolete legacy wiring after the button set has migrated", async ({ page }) => {
  await openButtonExperiment(page);
  const source = await page.locator("#code-editor").inputValue();
  await page.evaluate(() => {
    const key = "micropython-web-lab:connection-project:v1";
    const graph = { schemaVersion: 1, boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 }, devices: [] };
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), graph }));
  });
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue(source);
  await expect(page.locator("#device-ui-root > .device-ui-card:visible")).toHaveCount(1);
  await page.locator("#run-script-button").click();
  await page.getByRole("button", { name: "GP15", exact: true }).press("Space");
  await expect(page.locator("#experiment-output")).toContainText("Button: pressed");
});

for (const blockedStorage of [false, true]) {
  test(`keeps the new button set independent of legacy GPIO conflicts and storage blocked=${blockedStorage}`, async ({ page }) => {
    const graph = { ...MANAGED_CONNECTION_GRAPH, devices: MANAGED_CONNECTION_GRAPH.devices
      .filter(device => device.instanceId !== "button-gp15")
      .map(device => device.instanceId === "gt-502mgg-n" ? { ...device, ports: device.ports.map(port => port.portId === "pps"
        ? { ...port, endpoint: { kind: "gpio", pin: "GP15" } } : port) } : device) };
    await page.addInitScript(({ graph, blockedStorage }) => {
      localStorage.setItem("micropython-web-lab:connection-project:v1", JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), graph }));
      if (blockedStorage) {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === "micropython-web-lab:connection-project:v1") throw new Error("Test connection storage blocked");
          original.call(this, key, value);
        };
      }
    }, { graph, blockedStorage });
    await openButtonExperiment(page);
    await expect(page.locator("#run-script-button")).toBeEnabled();
    const source = await page.locator("#code-editor").inputValue();
    const pin = /button = Pin\((\d+),/.exec(source)![1];
    expect(pin).toBe("15");
    await expect(page.locator("#experiment-instruction")).toContainText(`GP${pin}`);
    await expect(page.locator("#experiment-output")).not.toContainText("Test connection storage blocked");
    await page.locator("#run-script-button").click();
    await page.getByRole("button", { name: `GP${pin}`, exact: true }).press("Space");
    await expect(page.locator("#experiment-output")).toContainText("Button: pressed");
  });
}

test("keeps the button draft and workspace collapse state when the experiment is reopened", async ({ page }) => {
  await openButtonExperiment(page);
  const editor = page.locator("#code-editor");
  const source = (await editor.inputValue()) + "\n# keep my changes";
  await editor.fill(source);
  await page.locator("#open-workspace-button").click();
  await page.getByRole("button", { name: "押しボタンを折りたたむ・展開する", exact: true }).click();
  await expect(page.locator("#device-ui-button-gp15-components")).toBeHidden();
  await page.locator("#open-experiment-button").click();
  await page.locator("#run-script-button").click();
  await expect(page.locator("#experiment-step")).toContainText("2 / 2");
  await editor.fill((await editor.inputValue()).replace("interval_ms = 200", "interval_ms = 100"));
  await page.locator("#run-script-button").click();
  await expect(page.locator("#experiment-step")).toHaveText("実験完了");
  await page.locator("#experiment-button-example").click();
  await expect(editor).toHaveValue(source);
  await expect(page.locator("#editor-tabs .editor-tab")).toHaveCount(1);
  await expect(page.locator("#device-ui-button-gp15-components")).toBeVisible();
  await page.locator("#run-script-button").click();
  await page.getByRole("button", { name: "GP15", exact: true }).press("Space");
  await expect(page.locator("#experiment-output")).toContainText("Button: pressed");
  await expect.poll(async () => (await page.locator("#experiment-output").textContent())!.split("Button: released").length - 1).toBe(2);
  await page.locator("#experiment-stop-button").click();
  await page.locator("#experiment-restart-button").click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#open-workspace-button").click();
  await expect(page.locator("#device-ui-button-gp15-components")).toBeHidden();
});

test("explains unavailable synchronous input in the focused button screen", async ({ page }) => {
  const server = await browserFixture();
  try {
    server.setFault("isolation");
    await openButtonExperiment(page, server.url, false);
    await expect(page.locator("#run-script-button")).toBeDisabled();
    await expect(page.locator('[data-device-instance="button-gp15"] .device-ui-components button')).toBeDisabled();
    await expect(page.locator("#experiment-feedback")).toHaveText(await page.locator("#device-ui-input-status").textContent());
    await page.locator("#open-workspace-button").click();
    await expect(page.locator("#run-script-button")).toBeEnabled();
  } finally {
    await server.close();
  }
});

test("browses without resetting Python and opens guided experiments as separate sets", async ({ page }) => {
  const savedConnections = JSON.stringify({ schemaVersion: 1, savedAt: "2026-10-10T00:00:00.000Z", graph: MANAGED_CONNECTION_GRAPH });
  await page.addInitScript(saved => {
    if (localStorage.getItem("micropython-web-lab:connection-project:v1") === null)
      localStorage.setItem("micropython-web-lab:connection-project:v1", saved);
  }, savedConnections);
  await page.goto("/");
  const editor = page.locator("#code-editor");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const source = 'retained_value = 73\nprint("kept")';
  await editor.fill(source); await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("kept");
  await page.locator("#repl-batch > summary").click();
  await page.locator("#repl-input").fill("unfinished input");
  await page.locator("#experiment-browse").click();
  await page.locator("#experiment-return").click();
  await expect(page.locator("#repl-input")).toHaveValue("unfinished input");
  await page.locator("#repl-input").fill("print(retained_value)"); await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("73");
  await page.locator("#open-experiment-button").click();
  await expect(editor).toHaveValue(/interval_ms = 500/);
  await expect(page.locator("#editor-tabs .editor-tab")).toHaveCount(1);
  await page.locator("#open-workspace-button").click();
  await page.locator("#experiment-saved").click();
  await page.locator("[data-saved-experiment]").filter({ has: page.getByRole("heading", { name: "これまでの作業", exact: true }) }).getByRole("button", { name: "開く", exact: true }).click();
  await expect(editor).toHaveValue(source);
  await expect(page.locator("#editor-tabs .editor-tab")).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem("micropython-web-lab:connection-project:v1"))).toBe(savedConnections);
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
