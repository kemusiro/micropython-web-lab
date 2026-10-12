import { openYmConnections, applyYmConnections } from "./ym2203-workspace";
import { test, expect } from "./workspace-test";
import type { Page } from "@playwright/test";
const card = '[data-device-instance="ym2203-prototype"]';
const scope = `${card} [data-ym-scope]`;
async function setup(page: Page) {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await openYmConnections(page);
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator(`${card} .ym-audio-panel`)).toHaveAttribute("data-audio-state", "ready");
  await page.locator(`${card} [data-ym-mute]`).click();
  await expect(page.locator(`${card} [data-ym-status]`)).toContainText("音声有効");
  await page.locator(`${card} [data-device-example]`).first().click();
}
const prelude = 'from machine import I2C\nfrom time import sleep_ms\nfrom web_lab_ym2203_v1 import YM2203\nsound = YM2203(I2C(0))\nsound.reset()\nsound.volume(30)\nsound.fm_tone()\n';
async function rms(page: Page) { return Number(await page.locator(scope).getAttribute("data-output-rms")); }
async function settled(page: Page) {
  await expect.poll(async () => page.locator(scope).evaluate(node => Number((node as HTMLElement).dataset.sent) - Number((node as HTMLElement).dataset.rendered))).toBe(0);
  await expect(page.locator(`${card} [data-ym-delivery]`)).toContainText("音源へ反映済み");
}
test("replacement playback reports its own progress, completes and does not revive on stop/restart", async ({ page }) => {
  await setup(page);
  await page.locator("#code-editor").fill(prelude + 'sound.reserve((60, 62, 64), step_ms=1200, gate_ms=1100, tail_ms=200)\nsleep_ms(250)\nsound.reserve((72,), step_ms=1500, gate_ms=1300, tail_ms=100)\nprint("Replaced reservation")');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Replaced reservation");
  await expect(page.locator(scope)).toHaveAttribute("data-total", "4");
  await expect(page.locator(scope)).toHaveAttribute("data-duration-ms", "1600");
  await expect(page.locator(`${card} [data-ym-playback]`)).toContainText("予約演奏中");
  await settled(page);
  await expect.poll(() => rms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect(page.locator(`${card} [data-ym-playback]`)).toContainText("演奏完了");
  await expect(page.locator(scope)).toHaveAttribute("data-applied", "4");
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
  await page.locator("#stop-button").click();
  await expect(page.locator(scope)).toHaveAttribute("data-playback-state", "stopped");
  await expect(page.locator(scope)).toHaveAttribute("data-total", "0");
  await page.locator("#restart-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(prelude + 'sound.reserve((69,), step_ms=500, gate_ms=400, tail_ms=100)');
  await page.locator("#run-script-button").click();
  await expect.poll(() => rms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect(page.locator(scope)).toHaveAttribute("data-duration-ms", "600");
  await expect(page.locator(`${card} [data-ym-playback]`)).toContainText("演奏完了");
  await settled(page);
});
test("consecutive reservations each complete with matching worklet receipts", async ({ page }) => {
  await setup(page);
  const completed: number[] = [];
  // Match each completion to the new command sequence. The previous note's
  // completed state remains visible until the next worklet meter arrives.
  for (const [index, note] of [60, 64, 67].entries()) {
    const previous = Number(await page.locator(scope).getAttribute("data-sent"));
    await page.locator("#code-editor").fill((index === 0 ? prelude : "sound.fm_tone()\n") +
      `sound.reserve((${note},), step_ms=1000, gate_ms=800, tail_ms=200)\nprint("reservation-${note}")`);
    await page.locator("#run-script-button").click();
    await expect(page.locator("#terminal")).toContainText(`reservation-${note}`);
    const sequence = Number(await page.locator(scope).getAttribute("data-sent"));
    expect(sequence).toBeGreaterThan(previous);
    await expect(page.locator(scope)).toHaveAttribute("data-rendered", String(sequence));
    await expect(page.locator(scope)).toHaveAttribute("data-mode", "scheduled");
    await expect.poll(() => rms(page), { intervals: [30] }).toBeGreaterThan(0.001);
    await expect(page.locator(scope)).toHaveAttribute("data-playback-state", "completed");
    await expect(page.locator(scope)).toHaveAttribute("data-rendered", String(sequence));
    await expect(page.locator(scope)).toHaveAttribute("data-applied", "4");
    await expect.poll(() => rms(page)).toBeLessThan(1e-6);
    await settled(page);
    completed.push(sequence);
  }
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  expect(completed).toHaveLength(3);
  expect(completed[0]).toBeLessThan(completed[1]!);
  expect(completed[1]).toBeLessThan(completed[2]!);
});

test("a suspended audio context is actionable and resumes without stale playback", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) { super(options); (window as unknown as { testAudio: AudioContext }).testAudio = this; }
    };
  });
  await setup(page);
  await page.locator("#code-editor").fill(prelude + 'sound.reserve((60,), step_ms=4000, gate_ms=3500, tail_ms=200)');
  await page.locator("#run-script-button").click();
  await expect.poll(() => rms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  await page.evaluate(() => (window as unknown as { testAudio: AudioContext }).testAudio.suspend());
  await expect(page.locator(`${card} [data-ym-status]`)).toContainText("クリック待ち");
  await expect(page.locator(scope)).toHaveAttribute("data-playback-state", "stopped");
  await page.locator(`${card} [data-ym-mute]`).click();
  await expect(page.locator(`${card} [data-ym-status]`)).toContainText("音声有効");
  await expect.poll(() => rms(page)).toBeLessThan(1e-6);
  await page.locator(`${card} [data-ym-mute]`).click();
  await page.locator("#code-editor").fill(prelude + 'sound.reserve((72,), step_ms=500, gate_ms=400, tail_ms=100)');
  await page.locator("#run-script-button").click();
  await expect.poll(() => rms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect(page.locator(`${card} [data-ym-playback]`)).toContainText("演奏完了");
  await settled(page);
});
