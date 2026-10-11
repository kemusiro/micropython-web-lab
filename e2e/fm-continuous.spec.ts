import { openYmConnections, applyYmConnections } from "./ym2203-workspace";
import { test, expect } from "./workspace-test";
import type { Page } from "@playwright/test";
const card = '[data-device-instance="ym2203-prototype"]';
const dialog = '[data-ym-patch-editor]';
const scope = `${card} [data-ym-scope]`;
async function setup(page: Page) {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await openYmConnections(page);
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
  await expect(page.locator(`${card} .ym-audio-panel`)).toHaveAttribute("data-audio-state", "ready");
  await page.locator("#code-editor").fill("print('keep my source')");
  await page.locator(`${card} [data-ym-patch-open]`).click();
  await expect(page.locator("[data-ym-patch-speaker]")).toContainText("ミュート中");
  await page.locator("[data-ym-patch-mute]").click();
  await expect(page.locator("[data-ym-patch-speaker]")).toContainText("ミュート解除");
  await page.locator("[data-ym-patch-mode]").selectOption("continuous");
}
async function value(page: Page, name: string) { return Number(await page.locator(scope).getAttribute(`data-${name}`)); }
async function start(page: Page) {
  await page.locator("[data-ym-patch-preview]").click();
  await expect(page.locator(dialog)).toHaveAttribute("data-continuous", "true");
  await expect.poll(() => value(page, "output-rms"), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
}
test("continuous SSG lasts beyond ten seconds without recurring I2C writes, follows edits and stops", async ({ page }) => {
  await setup(page);
  await page.locator('[data-patch-field="source"]').selectOption("ssg");
  await start(page);
  const epoch = await page.locator(scope).getAttribute("data-epoch");
  const sent = await value(page, "sent");
  const begin = Date.now();
  // Actual worklet PCM must still be present after both the old 8 s deadline and 10 s.
  await expect.poll(async () => Date.now() - begin > 11_000 && await value(page, "sent") === sent && await value(page, "output-rms") > 0.001,
    { timeout: 15_000, intervals: [300] }).toBe(true);
  await expect(page.locator(scope)).toHaveAttribute("data-epoch", epoch!);
  const loud = await value(page, "output-rms");
  await page.locator('[data-patch-field="ssgVolume"]').fill("3");
  await expect.poll(() => value(page, "output-rms"), { intervals: [50] }).toBeLessThan(loud * 0.25);
  await expect.poll(() => value(page, "output-rms")).toBeGreaterThan(0.0001);
  await page.locator('[data-patch-field="note"]').fill("81");
  await page.locator('[data-patch-field="channel"]').fill("2");
  await expect.poll(() => value(page, "ssg-rms")).toBeGreaterThan(0.001);
  await expect(page.locator("#code-editor")).toHaveValue("print('keep my source')");
  await page.locator("[data-ym-patch-stop]").click();
  await expect(page.locator(dialog)).toHaveAttribute("data-continuous", "false");
  await expect.poll(() => value(page, "output-rms")).toBeLessThan(1e-6);
  const stopped = await value(page, "sent");
  await page.waitForTimeout(2300); // Cross a scheduled renewal interval to detect resurrection.
  await expect(page.locator(scope)).toHaveAttribute("data-sent", String(stopped));
  await expect.poll(() => value(page, "output-rms")).toBeLessThan(1e-6);
});
test("FM/SSG switch, invalid edits, background stop, restart and Escape cancel continuous ownership", async ({ page }) => {
  await setup(page);
  await start(page);
  await page.locator('[data-patch-field="algorithm"]').selectOption("7");
  await page.getByRole("spinbutton", { name: "OP2 MULT", exact: true }).fill("4");
  await expect.poll(() => value(page, "fm-rms")).toBeGreaterThan(0.001);
  await page.locator('[data-patch-field="source"]').selectOption("ssg");
  await expect.poll(() => value(page, "ssg-rms")).toBeGreaterThan(0.001);
  await expect.poll(() => value(page, "fm-rms")).toBeLessThan(1e-6);
  await page.locator('[data-patch-field="ssgVolume"]').fill("");
  await expect(page.locator("[data-ym-patch-status]")).toContainText("SSG volume");
  await expect.poll(() => value(page, "output-rms")).toBeLessThan(1e-6);
  await page.locator('[data-patch-field="ssgVolume"]').fill("11");
  await expect.poll(() => value(page, "output-rms")).toBeGreaterThan(0.001);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await expect(page.locator(dialog)).toHaveAttribute("data-continuous", "false");
  await expect.poll(() => value(page, "output-rms")).toBeLessThan(1e-6);
  await page.evaluate(() => { Reflect.deleteProperty(document, "hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  await page.locator("[data-ym-patch-restart]").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.waitForTimeout(2300);
  await expect.poll(() => value(page, "output-rms")).toBeLessThan(1e-6);
  await start(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(dialog)).not.toBeVisible();
  await expect.poll(() => value(page, "output-rms")).toBeLessThan(1e-6);
});
