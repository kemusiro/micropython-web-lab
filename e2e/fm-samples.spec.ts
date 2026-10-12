import { test, expect } from "./workspace-test";
import { openYmConnections, applyYmConnections } from "./ym2203-workspace";
import type { Page } from "@playwright/test";
const card = '[data-device-instance="ym2203-prototype"]';
async function connect(page: Page) {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator(card + " [data-ym-mute]").click();
  await expect(page.locator(card + " .ym-audio-panel")).toHaveAttribute("data-audio-state", "ready");
}
async function run(page: Page, message: string) {
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText(message);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#terminal")).not.toContainText("[script error]");
}
test("organized voice and MML samples retain independent FM and SSG playback", async ({ page }) => {
  await connect(page);
  await expect(page.locator(card + " .device-ui-example-button")).toHaveText("FM／SSG発声");
  await page.locator(card + " .device-ui-example-button").click();
  await expect(page.locator("#code-editor")).toHaveValue(/FMのみ: ドレミファソファミレド/);
  await page.locator(card + " [data-ym-mml-example]").click();
  await expect(page.locator("#code-editor")).toHaveValue(/reserve_mml/);
  await run(page, "MML予約演奏: 5300 ms");
  const scope = page.locator(card + " [data-ym-scope]");
  await expect(scope).toHaveAttribute("data-duration-ms", "5300");
  await expect.poll(async () => Math.min(Number(await scope.getAttribute("data-fm-rms")), Number(await scope.getAttribute("data-ssg-rms"))),
    { intervals: [50] }).toBeGreaterThan(0.001);
  await page.locator("#stop-button").click();
});
test("BIN sample plays all events and retains binary data and mute state across reload", async ({ page }) => {
  await connect(page);
  await page.locator(card + " [data-ym-bin-example]").click();
  await expect(page.locator("#code-editor")).toHaveValue(/YM2203BinPlayer/);
  await run(page, "BIN予約演奏: 3000 ms");
  const scope = page.locator(card + " [data-ym-scope]");
  await expect.poll(async () => Number(await scope.getAttribute("data-output-rms"))).toBeGreaterThan(0.001);
  await expect(scope).toHaveAttribute("data-total", "98");
  await expect(scope).toHaveAttribute("data-playback-state", "completed");
  await expect(scope).toHaveAttribute("data-applied", "98");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#code-editor")).toHaveValue(/samples\/ym2203-demo.bin/);
  await expect(page.locator(card + " [data-ym-mute]")).toHaveAttribute("aria-pressed", "true");
  await page.locator(card + " [data-ym-mute]").click();
  await run(page, "BIN予約演奏: 3000 ms");
  await expect.poll(async () => Number(await scope.getAttribute("data-output-rms"))).toBeGreaterThan(0.001);
});
test("sound guide links to the article section and additional samples remain available", async ({ page }) => {
  await connect(page);
  await expect(page.locator(card).getByRole("link", { name: "使い方ガイド" })).toHaveAttribute("href", "https://asamomiji.jp/articles/micropython-web-lab-guide/#ym2203");
  await expect(page.locator(card + " [data-ym-score-example]")).toBeVisible();
  await expect(page.locator(card + " [data-ym-tone-example]")).toBeVisible();
  await expect(page.locator(card + " [data-ym-song-example]")).toHaveText("Pocket Signal");
});
