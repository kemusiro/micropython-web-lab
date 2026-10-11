import { expect, test, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("/fm-prototype.html");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#run")).toBeDisabled();
  await page.locator("#enable-audio").click();
  await expect(page.locator("#audio-status")).toContainText("音声有効");
  await expect(page.locator("#run")).toBeEnabled();
}
async function rms(page: Page, name: string) { return Number(await page.locator("#scope").getAttribute(`data-${name}`)); }

test("I2C plays the same nine-note melody with FM alone then SSG alone in an actual AudioWorklet", async ({ page }) => {
  const faults: string[] = [];
  page.on("pageerror", error => faults.push(error.message));
  await start(page);
  await page.evaluate(() => {
    const scope = document.querySelector<HTMLElement>("#scope")!;
    const observations: { fm: number; ssg: number; rms: number; runtime: string; applied: number }[] = [];
    (window as unknown as { audioObservations: typeof observations }).audioObservations = observations;
    new MutationObserver(() => {
      observations.push({ fm: Number(scope.dataset.fmRms), ssg: Number(scope.dataset.ssgRms),
        rms: Number(scope.dataset.outputRms), runtime: document.querySelector("#runtime-status")!.textContent!, applied: Number(scope.dataset.applied) });
      if (observations.length > 400) observations.shift();
    }).observe(scope, { attributes: true, attributeFilter: ["data-frame"] });
  });
  await page.locator("#run").click();
  await expect(page.locator("#output")).toContainText("FMのみ: ドレミファソファミレド");
  await expect(page.locator("#runtime-status")).toHaveText("Python実行中");
  await expect.poll(() => rms(page, "output-rms"), { intervals: [30] }).toBeGreaterThan(0.0001);
  await expect.poll(async () => Number(await page.locator("#scope").getAttribute("data-applied")), { intervals: [50] }).toBe(36);
  await expect(page.locator("#output")).toContainText("SSGのみ: ドレミファソファミレド");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#playing")).toHaveText("PLAYING");
  await expect.poll(async () => Number(await page.locator("#scope").getAttribute("data-applied")), { intervals: [50] }).toBeGreaterThan(0);
  await expect(page.locator("#playing")).toHaveText("STANDBY");
  await expect.poll(() => rms(page, "output-rms")).toBeLessThan(1e-6);
  await expect(page.locator("#module-status")).toContainText("2 plays");
  const observations = await page.evaluate(() => (window as unknown as { audioObservations: { fm: number; ssg: number; rms: number; runtime: string; applied: number }[] }).audioObservations);
  expect(observations.some(value => value.fm > 0.001 && value.ssg < 0.00001)).toBe(true);
  expect(observations.some(value => value.ssg > 0.001 && value.fm < 0.00001 && value.runtime === "Python実行中")).toBe(true);
  expect(observations.some(value => value.ssg > 0.001 && value.fm < 0.00001 && value.runtime === "実行可能")).toBe(true);
  expect(observations.every(value => value.fm < 0.00001 || value.ssg < 0.00001)).toBe(true);
  expect(observations.at(-1)?.applied).toBe(36);
  expect(faults).toEqual([]);
});

test("host mute and stop silence reserved audio; restart preserves editor and allows playback again", async ({ page }) => {
  await start(page);
  await page.locator("#run").click();
  await expect(page.locator("#output")).toContainText("FMのみ: ドレミファソファミレド");
  const original = await page.locator("#source").inputValue();
  await expect.poll(() => rms(page, "output-rms")).toBeGreaterThan(0.0001);
  await page.locator("#mute-audio").click();
  await expect.poll(() => rms(page, "output-rms")).toBeLessThan(1e-6);
  await page.locator("#mute-audio").click();
  await expect.poll(() => rms(page, "output-rms"), { intervals: [30] }).toBeGreaterThan(0.0001);
  await page.locator("#stop").click();
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await expect.poll(() => rms(page, "output-rms")).toBeLessThan(1e-6);
  await expect(page.locator("#scope")).toHaveAttribute("data-active", "false");
  await page.locator("#restart").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#source")).toHaveValue(original);
  await page.locator("#run").click();
  await expect.poll(() => rms(page, "output-rms"), { intervals: [30] }).toBeGreaterThan(0.0001);
});

test("unresponsive Python and an audio command flood recover without leaving notes sounding", async ({ page }) => {
  await start(page);
  await page.locator("#source").fill('from machine import I2C, Pin\ni = I2C(0, scl=Pin(9), sda=Pin(8))\ni.writeto(0x44, bytes((0, 7, 62, 0, 200, 1, 1, 8, 12)))\nwhile True:\n    pass');
  await page.locator("#run").click();
  await expect.poll(() => rms(page, "output-rms"), { intervals: [30] }).toBeGreaterThan(0.0001);
  await page.locator("#stop").click();
  await expect.poll(() => rms(page, "output-rms")).toBeLessThan(1e-6);
  await page.locator("#restart").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#source").fill('from machine import I2C, Pin\ni = I2C(0, scl=Pin(9), sda=Pin(8))\nwhile True:\n    i.writeto(0x44, bytes((0, 8, 12)))');
  await page.locator("#run").click();
  await expect.poll(() => rms(page, "output-rms")).toBeLessThan(1e-6);
  await expect(page.locator("#output")).toContainText(/budget exceeded|命令が過多/);
  await page.locator("#restart").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
});

test("a failed audio load is visible and retryable", async ({ page }) => {
  const audioWasm = /\/ym2203-[^/]+\.wasm(?:\?.*)?$/;
  await page.route(audioWasm, route => route.abort());
  await page.goto("/fm-prototype.html");
  await page.locator("#enable-audio").click();
  await expect(page.locator("#audio-status")).toContainText(/Error|fetch/);
  await expect(page.locator("#run")).toBeDisabled();
  await page.unroute(audioWasm);
  await page.locator("#enable-audio").click();
  await expect(page.locator("#audio-status")).toContainText("音声有効");
});
