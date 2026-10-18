import { test, expect } from "./workspace-test";
import type { Page } from "@playwright/test";
import { runArmControl, DEFAULT_ARM_CONTROL } from "../src/physics/arm-control";

async function captureArm(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    (window as any).armProfiles = [];
    (window as any).armWorkers = [];
    window.Worker = class extends NativeWorker {
      stopped = false;
      arm = false;
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); (window as any).armWorkers.push(this); }
      postMessage(message: any, ...rest: any[]) {
        if (message.runtimeProfile?.kind === "arm") (window as any).armProfiles.push(message.runtimeProfile);
        if (message.kind === "arm" || message.runtimeProfile?.kind === "arm") this.arm = true;
        super.postMessage(message, ...rest as [any]);
      }
      terminate() { this.stopped = true; super.terminate(); }
    };
  });
}
async function openArm(page: Page) {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#experiment-browse").click(); await page.locator('[data-experiment-category="physical"]').click();
  await page.locator('[data-create-experiment="one-axis-arm"]').click();
  await expect(page.locator("#arm-workbench")).toBeVisible();
  await expect(page.locator("#run-script-button")).toBeEnabled();
}
async function setup(page: Page) { await page.locator('[data-experiment-view="configuration"]').click(); }
async function experience(page: Page) { await page.locator('[data-experiment-view="experience"]').click(); }
async function change(page: Page, key: string, value: string) {
  await page.locator(`#arm-${key}`).fill(value); await page.locator(`#arm-${key}`).dispatchEvent("change");
}
async function run(page: Page) {
  await page.locator("#run-script-button").click();
  await expect(page.locator("#arm-workbench")).toHaveAttribute("data-result", "completed", { timeout: 15000 });
  await expect(page.locator("#run-script-button")).toBeEnabled();
}
async function rows(page: Page) {
  return page.evaluate(() => { const p = (window as any).armProfiles.at(-1); const tick = Atomics.load(new Int32Array(p.buffer), 7); return Array.from(new Float64Array(p.buffer, 72, (tick + 1) * 12)); });
}

test("opens an arm without running or board controls, then displays the real Python reference result", async ({ page }) => {
  await captureArm(page); await openArm(page);
  await expect(page.locator("#arm-run-status")).toContainText("未実行");
  expect(await page.evaluate(() => (window as any).armProfiles.length)).toBe(0);
  await expect(page.locator("#device-ui-root")).toBeHidden(); await expect(page.locator("#open-device-configuration")).toBeHidden();
  await expect(page.locator("#send-button")).toBeDisabled(); await expect(page.locator("#debug-script-button")).toBeDisabled();
  await run(page);
  await expect(page.locator("#arm-workbench")).toHaveAttribute("data-last-tick", "600");
  await expect(page.locator("#arm-values")).toContainText("45.13°");
  await expect(page.locator("#arm-metrics")).toContainText("14.87°");
  const actual = await rows(page), reference = runArmControl(DEFAULT_ARM_CONTROL);
  expect(actual).toHaveLength(601 * 12);
  expect(Math.max(...reference.observations.map((p, i) => Math.abs(p.angleRad - Number(actual[i * 12]))))).toBeLessThan(1e-10);
  await expect(page.locator("#arm-pose")).toHaveAttribute("aria-label", /45.13/);
  await page.locator(".virtual-board-panel").evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: ".playwright/e5-arm-workspace.png", fullPage: true });
});

test("keeps browsing and section changes separate from execution, and inspects a shared recorded tick", async ({ page }) => {
  await captureArm(page); await openArm(page);
  await page.locator("#run-script-button").click();
  await expect.poll(() => page.locator("#arm-workbench").getAttribute("data-last-tick").then(Number)).toBeGreaterThan(10);
  await page.locator("#experiment-browse").click(); await expect(page.locator("#runtime-status")).toHaveText("スクリプト実行中");
  await page.locator("#experiment-return").click(); await setup(page); await expect(page.locator("#arm-targetAngleRad")).toBeDisabled();
  await page.locator('[data-experiment-view="explanation"]').click(); await expect(page.locator("#arm-workbench")).toContainText("read()");
  await experience(page); await expect(page.locator("#arm-workbench")).toHaveAttribute("data-result", "completed", { timeout: 15000 });
  expect(await page.evaluate(() => (window as any).armProfiles.length)).toBe(1);
  const time = page.locator("#arm-record-time"); await time.focus(); await time.press("Home"); await time.press("ArrowRight");
  await expect(page.locator("#arm-workbench")).toHaveAttribute("data-view-tick", "1");
  await expect(page.locator("#arm-time")).toContainText("記録を見る: 0.01 s");
  const data = await rows(page); await expect(page.locator("#arm-pose")).toHaveAttribute("aria-label", new RegExp((Number(data[12]) * 180 / Math.PI).toFixed(2)));
  const cursor = await page.locator(".arm-cursor").first().getAttribute("x1");
  for (const x of await page.locator(".arm-cursor").evaluateAll(nodes => nodes.map(node => node.getAttribute("x1")))) expect(x).toBe(cursor);
  await page.locator("#experiment-browse").click(); await page.locator("#experiment-return").click();
  await expect(page.locator("#arm-workbench")).toHaveAttribute("data-view-tick", "1");
  await page.locator("#arm-follow-latest").click(); await expect(page.locator("#arm-workbench")).toHaveAttribute("data-view-tick", "600");
});

test("saves conditions, plot choices and unsaved buffers, reloads without running, and preserves the saved file", async ({ page }) => {
  await openArm(page); await setup(page);
  await change(page, "targetAngleRad", "80"); await change(page, "payloadMassKg", "400"); await change(page, "durationMs", "1");
  await page.locator("#arm-gravityCompensation").check(); await experience(page); await page.locator('[data-arm-series="speed"]').check();
  const original = await page.locator("#code-editor").inputValue(); await page.locator("#code-editor").fill(original + "\n# unsaved arm buffer\n");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.reload(); await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue(original + "\n# unsaved arm buffer\n");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
  await expect(page.locator("#arm-run-status")).toContainText("未実行"); await expect(page.locator('[data-arm-series="speed"]')).toBeChecked();
  await setup(page); await expect(page.locator("#arm-targetAngleRad")).toHaveValue("80"); await expect(page.locator("#arm-payloadMassKg")).toHaveValue("400");
  await expect(page.locator("#arm-gravityCompensation")).toBeChecked(); await experience(page); await run(page);
  await expect(page.locator("#arm-workbench")).toHaveAttribute("data-last-tick", "100");
});

test("changing code or conditions labels the old result and a new run uses a fresh Worker pair", async ({ page }) => {
  await captureArm(page); await openArm(page); await setup(page); await change(page, "durationMs", "1"); await experience(page); await run(page);
  const first = await page.locator("#arm-workbench").getAttribute("data-run-id");
  await setup(page); await change(page, "targetAngleRad", "90"); await experience(page);
  await expect(page.locator("#arm-stale-result")).toContainText("変更前");
  await page.locator("#code-editor").fill((await page.locator("#code-editor").inputValue()) + "\n# changed\n");
  await run(page); await expect(page.locator("#arm-stale-result")).toHaveText("");
  expect(await page.locator("#arm-workbench").getAttribute("data-run-id")).not.toBe(first);
  expect(await page.evaluate(() => (window as any).armProfiles.length)).toBe(2);
});

test("reduced-motion redraws leave every recorded value unchanged", async ({ page }) => {
  await captureArm(page); await openArm(page); await setup(page); await change(page, "durationMs", "1"); await experience(page); await run(page);
  const normal = await rows(page); await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" }); await run(page);
  expect(await rows(page)).toEqual(normal);
  await expect(page.locator("#arm-workbench")).toHaveAttribute("data-last-tick", "100");
});

test("switching out of a running arm terminates the pair, saves files, and restores buffers without records", async ({ page }) => {
  await captureArm(page); await openArm(page);
  const source = 'from weblab.control import Experiment\ne = Experiment()\nopen("arm-output.txt", "w").write("retained")\nprint("started")\nwhile True:\n    e.step()';
  await page.locator("#code-editor").fill(source); await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("started");
  await page.locator("#experiment-browse").click(); await page.locator('[data-experiment-category="devices"]').click(); await page.locator('[data-create-experiment="button-led"]').click();
  await expect(page.locator("#run-script-button")).toBeEnabled(); await expect(page.locator("#arm-workbench")).toBeHidden();
  expect(await page.evaluate(() => (window as any).armWorkers.filter((w: any) => w.arm).every((w: any) => w.stopped))).toBe(true);
  await page.locator("#experiment-saved").click(); await page.locator("[data-saved-experiment]").filter({ has: page.getByRole("heading", { name: "重り付き一軸アーム", exact: true }) }).getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.locator("#run-script-button")).toBeEnabled(); await expect(page.locator("#code-editor")).toHaveValue(source);
  await expect(page.locator('#project-file-tree [data-path="arm-output.txt"]')).toBeVisible();
  await expect(page.locator("#arm-run-status")).toContainText("未実行");
  await expect(page.locator("#arm-workbench")).toHaveAttribute("data-last-tick", "0");
});

test("stops Python without step and restarts in a fresh model environment", async ({ page }) => {
  await captureArm(page); await openArm(page);
  const original = await page.locator("#code-editor").inputValue();
  await page.locator("#code-editor").fill('print("no step running")\nwhile True:\n    pass');
  await page.locator("#run-script-button").click(); await expect(page.locator("#terminal")).toContainText("no step running");
  await page.locator("#stop-button").click(); await expect(page.locator("#arm-workbench")).toHaveAttribute("data-result", "stopped");
  await page.locator("#code-editor").fill(original); await page.locator("#restart-button").click(); await expect(page.locator("#run-script-button")).toBeEnabled();
  await setup(page); await change(page, "durationMs", "1"); await experience(page); await run(page);
  const ids = await page.evaluate(() => (window as any).armProfiles.map((p: any) => p.identity.runId)); expect(new Set(ids).size).toBe(2);
});

test("without isolation the arm code, conditions and explanation remain readable", async ({ page }) => {
  await page.route("**/", async route => {
    const response = await route.fetch(), headers = response.headers(); delete headers["cross-origin-opener-policy"]; delete headers["cross-origin-embedder-policy"];
    await route.fulfill({ response, headers });
  });
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#experiment-browse").click(); await page.locator('[data-experiment-category="physical"]').click(); await page.locator('[data-create-experiment="one-axis-arm"]').click();
  await expect(page.locator("#arm-availability")).toContainText("クロスオリジン分離");
  await expect(page.locator("#code-editor")).toHaveValue(/weblab.control/); await expect(page.locator("#run-script-button")).toBeDisabled();
  await page.locator('[data-experiment-view="explanation"]').click(); await expect(page.locator("#arm-workbench")).toContainText("read()");
  await setup(page); await expect(page.locator("#arm-targetAngleRad")).toBeEnabled();
});

for (const width of [320, 736, 960, 1280]) {
  test(`supports keyboard, English, both color schemes and plots within ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem("micropython-web-lab:locale:v1", "en"));
    await page.emulateMedia({ colorScheme: width === 320 || width === 960 ? "light" : "dark", reducedMotion: "reduce", forcedColors: width === 1280 ? "active" : "none" });
    await openArm(page); await setup(page); await change(page, "durationMs", "1"); await experience(page);
    await page.locator('[data-arm-series="speed"]').check(); await page.locator('[data-arm-series="acceleration"]').check(); await page.locator('[data-arm-series="gravity"]').check();
    await page.locator("#run-script-button").focus(); await page.keyboard.press("Enter");
    await expect(page.locator("#arm-workbench")).toHaveAttribute("data-result", "completed");
    await expect(page.locator("#arm-run-status")).toContainText("Experiment completed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const overflow = await page.locator("#arm-workbench").evaluate(root => Array.from(root.querySelectorAll("svg, input, button")).some(node => node.getBoundingClientRect().right > innerWidth));
    expect(overflow).toBe(false);
    await page.screenshot({ path: `.playwright/e5-arm-${width}.png`, fullPage: true });
  });
}

for (const [preset, final, overshoot] of [["compensated", "60.00°", "27.27°"], ["low-damping", "44.38°", "25.07°"], ["heavy", "0.00°", "0.00°"]]) {
  test(`shows the ${preset} reference case from Python with directional metrics`, async ({ page }) => {
    await openArm(page); await setup(page); await page.locator(`[data-arm-preset="${preset}"]`).click(); await experience(page); await run(page);
    await expect(page.locator("#arm-values")).toContainText(final!); await expect(page.locator("#arm-metrics")).toContainText(overshoot!);
  });
}

test("measures downward overshoot and marks equal initial/target angles as not applicable", async ({ page }) => {
  await openArm(page); await setup(page); await change(page, "durationMs", "1"); await change(page, "initialAngleRad", "100"); await change(page, "targetAngleRad", "60"); await experience(page); await run(page);
  const reference = runArmControl({ ...DEFAULT_ARM_CONTROL, durationMs: 1000, initialAngleRad: 100 * Math.PI / 180 });
  const overshoot = Math.max(0, ...reference.observations.map(p => (DEFAULT_ARM_CONTROL.targetAngleRad - p.angleRad) * 180 / Math.PI));
  await expect(page.locator("#arm-metrics")).toContainText(overshoot.toFixed(2) + "°");
  await setup(page); await change(page, "initialAngleRad", "60"); await experience(page); await run(page);
  await expect(page.locator("#arm-metrics")).toContainText("最大の行き過ぎ: 対象外");
});

test("marks a stopper impact acceleration invalid at its recorded tick", async ({ page }) => {
  await captureArm(page); await openArm(page); await setup(page); await change(page, "durationMs", "1"); await change(page, "initialAngleRad", "30"); await experience(page);
  await page.locator('[data-arm-series="acceleration"]').check();
  await page.locator("#code-editor").fill('from weblab.control import Experiment\ne=Experiment()\nj=e.joint("arm")\nj.set_torque(-1)\nfor _ in range(e.steps):\n    e.step()');
  await run(page); const data = await rows(page);
  const impact = Array.from({ length: data.length / 12 }, (_, tick) => tick).find(tick => Number(data[tick * 12 + 9]) & 16);
  expect(impact).toBeGreaterThan(0);
  await page.locator("#arm-record-time").fill(String(impact));
  await expect(page.locator("#arm-values")).toContainText("接触時の加速度は無効");
  await expect(page.locator("#arm-workbench")).toHaveAttribute("data-view-tick", String(impact));
});

test("rejects invalid condition edits before starting a Worker", async ({ page }) => {
  await captureArm(page); await openArm(page); await setup(page); await change(page, "payloadMassKg", "700");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#experiment-set-status")).toContainText("入力を修正");
  expect(await page.evaluate(() => (window as any).armProfiles.length)).toBe(0);
  await change(page, "payloadMassKg", "150"); await change(page, "durationMs", "1"); await experience(page); await run(page);
});
