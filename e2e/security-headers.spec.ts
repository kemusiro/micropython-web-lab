import { expect, test } from "@playwright/test";

test("serves the production app with the restricted security policy", async ({ page }) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};

  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["content-security-policy"]).toContain(
    "script-src 'self' 'wasm-unsafe-eval'",
  );
  expect(headers["content-security-policy"]).not.toContain("'unsafe-inline'");
  expect(headers["content-security-policy"]).not.toMatch(/(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
  expect(headers["content-security-policy"]).toContain("worker-src 'self'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self'");
  expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");

  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  await expect(page.locator("#terminal")).toContainText(">>>");
});
