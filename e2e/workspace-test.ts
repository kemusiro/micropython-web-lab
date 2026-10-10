import { test as base } from "@playwright/test";
export { expect, type Locator } from "@playwright/test";

/** Existing runtime/device checks exercise the full workspace, not the first-use flow. */
export const test = base.extend<{ workspaceScreen: void }>({
  workspaceScreen: [async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem("micropython-web-lab:app-screen:v1", "workspace");
    });
    await use();
  }, { auto: true }],
});
