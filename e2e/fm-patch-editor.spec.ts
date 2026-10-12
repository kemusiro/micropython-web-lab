import { openYmConnections, applyYmConnections } from "./ym2203-workspace";
import { test, expect } from "./workspace-test";
import type { Page } from "@playwright/test";
const card = '[data-device-instance="ym2203-prototype"]';
const dialog = '[data-ym-patch-editor]';
async function connect(page: Page) {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
  await expect(page.locator(`${card} [data-ym-patch-open]`)).toBeEnabled();
  await expect(page.locator(`${card} .ym-audio-panel`)).toHaveAttribute("data-audio-state", "ready");
}
async function rms(page: Page) { return Number(await page.locator(`${card} [data-ym-scope]`).getAttribute("data-output-rms")); }
async function audition(page: Page) {
  await page.locator("[data-ym-patch-preview]").click();
  await expect.poll(() => rms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
}

test("installing the sound sample during a slow Worker restart retains its libraries", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  let release!: () => void;
  const downloading = new Promise<void>(resolve => { release = resolve; });
  await page.route(/micropython.*\.wasm/, async route => {
    await downloading;
    await route.continue();
  });
  try {
    await openYmConnections(page);
    await page.getByLabel("YM2203音源（実験用）を接続").check();
    await applyYmConnections(page);
    await expect(page.locator("#status-indicator")).toHaveAttribute("data-status", "starting");
    await page.locator(`${card} [data-ym-tone-example]`).click();
  } finally { release(); }
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill('print("Library retained", len(open("lib/web_lab_ym2203_tone_v1.py").read()))');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Library retained");
  await expect(page.locator("#terminal")).not.toContainText("[script error]");
});

test("mute and runtime recovery remain independent inside the patch editor", async ({ page }) => {
  await connect(page);
  await page.locator("#stop-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await page.locator("[data-ym-patch-open]").click();
  await expect(page.locator("[data-ym-patch-status]")).toContainText("実行環境が停止しています");
  await page.getByRole("button", { name: "初期値に戻す", exact: true }).click();
  await expect(page.locator("[data-ym-patch-status]")).toContainText("実行環境が停止しています");
  await page.locator("[data-ym-patch-mute]").click();
  await expect(page.locator("[data-ym-patch-preview]")).toBeDisabled();
  await page.locator("[data-ym-patch-restart]").click();
  await expect(page.locator("[data-ym-patch-preview]")).toBeEnabled();
  await audition(page);
});

test("the runtime can be recovered without closing the editor after a host stop", async ({ page }) => {
  await connect(page);
  await page.locator("[data-ym-patch-open]").click();
  await page.locator("[data-ym-patch-mute]").click();
  await expect(page.locator("[data-ym-patch-speaker]")).toContainText("ミュート解除");
  await page.locator('[data-patch-field="feedback"]').fill("5");
  await audition(page);
  // Host stop also represents stops caused by page visibility/runtime recovery.
  await page.locator("#stop-button").evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("[data-ym-patch-preview]")).toBeDisabled();
  await expect(page.locator("[data-ym-patch-status]")).toContainText("実行環境が停止しています");
  await page.locator("[data-ym-patch-stop]").click();
  await expect(page.locator("[data-ym-patch-status]")).toContainText("実行環境が停止しています");
  await page.locator("[data-ym-patch-restart]").click();
  await expect(page.locator("[data-ym-patch-preview]")).toBeEnabled();
  await expect(page.locator("[data-ym-patch-restart]")).not.toBeVisible();
  await expect(page.locator('[data-patch-field="feedback"]')).toHaveValue("5");
  await audition(page);
});

test("edits a patch, auditions through I2C without overwriting source, then exports a saved Python tab", async ({ page }) => {
  await connect(page);
  const original = "print('my existing code')";
  await page.locator("#code-editor").fill(original);
  await page.locator("[data-ym-patch-open]").click();
  await expect(page.locator(dialog)).toBeVisible();
  await page.locator("[data-ym-patch-mute]").click();
  await expect(page.locator("[data-ym-patch-speaker]")).toContainText("ミュート解除");
  await page.locator('[data-patch-field="algorithm"]').selectOption("7");
  await page.locator('[data-patch-field="feedback"]').fill("3");
  await page.getByRole("spinbutton", { name: "OP2 MULT", exact: true }).fill("2");
  await expect(page.locator(`${dialog} svg`)).toHaveAttribute("aria-label", /algorithm 7, feedback 3, output OP1, OP2, OP3, OP4/);
  await audition(page);
  await expect(page.locator("#code-editor")).toHaveValue(original);
  await expect.poll(async () => Number(await page.locator(`${card} [data-ym-scope]`).getAttribute("data-fm-rms"))).toBeGreaterThan(0.001);
  await expect(page.locator(`${dialog} span`)).toHaveText("STANDBY");
  await expect(page.locator("[data-ym-patch-status]")).toContainText("試聴が終わりました");
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
  await page.locator("[data-ym-patch-export]").click();
  await expect(page.locator(dialog)).not.toBeVisible();
  await expect(page.locator("#code-editor")).toHaveValue(/sound.fm_patch\(operators, algorithm=7, feedback=3/);
  await page.locator("#run-script-button").click();
  await expect.poll(() => rms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#save-draft-button").click();
  await expect(page.locator("#project-save-dialog")).toBeVisible();
  await page.locator("#project-save-filename").fill("edited-patch.py");
  await page.locator("#project-save-dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#project-save-dialog")).toBeHidden();
  await expect(page.getByRole("tab", { name: "edited-patch.py", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#editor-highlighted-code")).toContainText("algorithm=7, feedback=3");
  await page.reload();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#code-editor")).toHaveValue(/algorithm=7, feedback=3/);
});

test("invalid values block playback/export, and SSG auditions stop on Stop, close and Escape", async ({ page }) => {
  await connect(page);
  await page.locator("[data-ym-patch-open]").click();
  await page.getByRole("spinbutton", { name: "OP4 AR", exact: true }).fill("32");
  await expect(page.locator("[data-ym-patch-preview]")).toBeDisabled();
  await expect(page.locator("[data-ym-patch-export]")).toBeDisabled();
  await expect(page.locator("[data-ym-patch-status]")).toContainText("OP4 AR");
  await page.getByRole("spinbutton", { name: "OP4 AR", exact: true }).fill("31");
  await page.locator('[data-patch-field="source"]').selectOption("ssg");
  await page.locator('[data-patch-field="noise"]').check();
  await page.locator('[data-patch-field="envelope"]').check();
  await page.locator("[data-ym-patch-mute]").click();
  await expect(page.locator("[data-ym-patch-speaker]")).toContainText("ミュート解除");
  await audition(page);
  await page.locator("[data-ym-patch-stop]").click();
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
  await audition(page);
  await page.locator("[data-ym-patch-close]").click();
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
  await page.locator("[data-ym-patch-open]").click();
  await expect(page.locator('[data-patch-field="noise"]')).toBeChecked();
  await audition(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(dialog)).not.toBeVisible();
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
});

test("export keeps a conflicting edited driver and audition needs no installed library", async ({ page }) => {
  await connect(page);
  await page.locator(`${card} [data-ym-tone-example]`).click();
  await page.locator("#code-editor").fill('with open("lib/web_lab_ym2203_tone_v1.py", "w") as f:\n    f.write("# my edited patch driver\\n")\nprint("Edited")');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Edited");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  const original = await page.locator("#code-editor").inputValue();
  await page.locator("[data-ym-patch-open]").click();
  await page.locator("[data-ym-patch-export]").click();
  await expect(page.locator("[data-ym-patch-status]")).toContainText("既存の音源ドライバーと競合");
  await expect(page.locator("#code-editor")).toHaveValue(original);
  await page.locator("[data-ym-patch-mute]").click();
  await expect(page.locator("[data-ym-patch-speaker]")).toContainText("ミュート解除");
  await audition(page);
  await page.keyboard.press("Escape");
  await page.locator("#code-editor").fill('print(open("lib/web_lab_ym2203_tone_v1.py").read().strip())');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("# my edited patch driver");
});
