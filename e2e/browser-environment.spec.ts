import os from "node:os";
import { test } from "@playwright/test";

test("records the actual browser and host environment", async ({ browser, page }, testInfo) => {
  await page.goto("/");
  const environment = {
    project: testInfo.project.name,
    browserVersion: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    os: { platform: os.platform(), release: os.release(), version: os.version(), arch: os.arch() },
  };
  await testInfo.attach("browser-environment", {
    body: JSON.stringify(environment, null, 2), contentType: "application/json",
  });
});
