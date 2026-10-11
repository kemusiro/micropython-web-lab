import { openYmConnections, applyYmConnections } from "./ym2203-workspace";
import { test, expect } from "./workspace-test";
import type { Page, Route } from "@playwright/test";
const card = '[data-device-instance="ym2203-prototype"]';
const panel = `${card} .ym-audio-panel`;
const mute = `${card} [data-ym-mute]`;
const scope = `${card} [data-ym-scope]`;
async function connect(page: Page) {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await openYmConnections(page);
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
}
async function rms(page: Page) { return Number(await page.locator(scope).getAttribute("data-output-rms")); }
async function volume(page: Page, value: number) {
  await page.locator(`${card} input[type="range"]`).evaluate((input: HTMLInputElement, percent) => {
    input.value = String(percent); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
test("mute and slider are independent, shared with the editor, and do not reset playback", async ({ page }) => {
  await connect(page);
  await expect(page.locator(panel)).toHaveAttribute("data-audio-state", "ready");
  await expect(page.locator(mute)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "音声を有効にする", exact: true })).toHaveCount(0);
  await volume(page, 90);
  await page.locator("#code-editor").fill('from machine import I2C\ni = I2C(0)\ni.writeto(0x44, bytes((4, 50)))\ni.writeto(0x44, bytes((0, 7, 62, 0, 28, 1, 1, 8, 11)))');
  await page.locator("#run-script-button").click();
  await expect.poll(async () => Number(await page.locator(scope).getAttribute("data-ssg-rms"))).toBeGreaterThan(0.001);
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
  const epoch = await page.locator(scope).getAttribute("data-epoch");
  await page.locator(mute).click();
  await expect.poll(() => rms(page)).toBeGreaterThan(0.08);
  await expect(page.locator(`${card} input[type="range"]`)).toHaveValue("90");
  await expect(page.locator(mute)).toHaveText("ミュート");
  await page.locator(mute).click();
  await volume(page, 25);
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
  await page.locator(`${card} [data-ym-patch-open]`).click();
  await expect(page.locator("[data-ym-patch-mute]")).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-ym-patch-mute]").click();
  await expect(page.locator("[data-ym-patch-speaker]")).toContainText("ミュート解除");
  await expect.poll(() => rms(page)).toBeGreaterThan(0.025);
  await page.locator("[data-ym-patch-close]").click();
  await expect(page.locator(mute)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(`${card} input[type="range"]`)).toHaveValue("25");
  await expect(page.locator(scope)).toHaveAttribute("data-epoch", epoch!);
  await expect(page.locator(scope)).toHaveAttribute("data-active", "true");
  await page.locator(`${card} .device-ui-collapse`).click();
  await expect(page.locator(panel)).toBeHidden();
  await expect.poll(() => rms(page)).toBeGreaterThan(0.025);
  await expect(page.locator(scope)).toHaveAttribute("data-epoch", epoch!);
  await page.locator(`${card} .device-ui-collapse`).click();
  await expect(page.locator(mute)).toBeVisible();
  await expect(page.locator(mute)).toHaveAttribute("aria-pressed", "false");
});
test("restored connections prepare while suspended and reconnecting starts muted at the previous slider value", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        if (localStorage.getItem("test-block-autoplay")) void super.suspend();
        (window as unknown as { testAudio: AudioContext }).testAudio = this;
      }
      resume() {
        // Simulate the autoplay gate while using a real context/worklet/core.
        if (localStorage.getItem("test-block-autoplay") && !navigator.userActivation.isActive) return new Promise<void>(() => {});
        return super.resume();
      }
    };
  });
  await connect(page);
  await expect(page.locator(panel)).toHaveAttribute("data-audio-state", "ready");
  await page.locator(mute).click();
  await page.evaluate(() => localStorage.setItem("test-block-autoplay", "1"));
  await page.reload();
  await expect(page.locator(panel)).toHaveAttribute("data-audio-state", "waiting");
  await expect(page.locator(mute)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${card} [data-ym-status]`)).toContainText("クリック待ち");
  await page.locator(mute).click();
  await expect(page.locator(panel)).toHaveAttribute("data-audio-state", "ready");
  await expect(page.locator(mute)).toHaveAttribute("aria-pressed", "false");
  await volume(page, 25);
  await openYmConnections(page);
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").uncheck();
  await applyYmConnections(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { testAudio: AudioContext }).testAudio.state)).toBe("closed");
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
  await expect(page.locator(panel)).toHaveAttribute("data-audio-state", "ready");
  await expect(page.locator(mute)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${card} input[type="range"]`)).toHaveValue("25");
});
test("disconnect during loading cancels the old context and permits a fresh muted connection", async ({ page }) => {
  const held: Route[] = [];
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) { super(options); (window as unknown as { testAudio: AudioContext }).testAudio = this; }
    };
  });
  // Match the asset filename, including when a parent directory contains "ym2203-".
  const audioWasm = /\/ym2203-[^/]+\.wasm(?:\?.*)?$/;
  await page.route(audioWasm, route => { held.push(route); });
  await connect(page);
  await expect.poll(() => held.length).toBe(1);
  await expect(page.locator(panel)).toHaveAttribute("data-audio-state", "preparing");
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").uncheck();
  await applyYmConnections(page);
  await expect(page.locator(card)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { testAudio: AudioContext }).testAudio.state)).toBe("closed");
  await page.unroute(audioWasm);
  for (const route of held) await route.abort().catch(() => {});
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
  await expect(page.locator(panel)).toHaveAttribute("data-audio-state", "ready");
  await expect(page.locator(mute)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${card} [data-ym-status]`)).not.toContainText("cancelled");
});
