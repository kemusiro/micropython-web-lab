import { expect, test } from "@playwright/test";
import { browserFixture } from "../scripts/lib/browser-fixture.mjs";

test("missing isolation visibly disables shared inputs while REPL remains usable", async ({ page }) => {
  const server = await browserFixture();
  try {
    server.setFault("isolation");
    await page.goto(server.url);
    await expect(page.locator("#status-indicator")).toHaveAttribute("data-status", "ready");
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    await expect(page.locator("#device-ui-input-status")).toHaveAttribute("data-state", "unavailable");
    await expect(page.locator('[data-device-instance="analog-gp26"] input[type="range"]')).toBeDisabled();
    await page.locator("#repl-input").fill('print("fallback", 42)');
    await page.locator("#send-button").click();
    await expect(page.locator("#terminal")).toContainText("fallback 42");
  } finally { await server.close(); }
});

for (const fault of ["wasm", "worker"]) {
  test(`${fault} loading failure is visible and manual restart recovers`, async ({ page }) => {
    const server = await browserFixture();
    try {
      server.setFault(fault);
      await page.goto(server.url);
      await expect(page.locator("#status-indicator")).toHaveAttribute("data-status", "error");
      await expect(page.locator("#terminal")).toContainText(fault === "worker"
        ? "短時間に繰り返し失敗したため自動再生成を停止" : "[runtime error]");
      await expect(page.locator("#run-script-button")).toBeDisabled();
      const source = 'print("source-preserved", 42)';
      await page.locator("#code-editor").fill(source);
      server.setFault("none");
      await page.locator("#restart-button").click();
      await expect(page.locator("#status-indicator")).toHaveAttribute("data-status", "ready");
      await expect(page.locator("#code-editor")).toHaveValue(source);
      await page.locator("#run-script-button").click();
      await expect(page.locator("#terminal")).toContainText("source-preserved 42");
    } finally { await server.close(); }
  });
}
