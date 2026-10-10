import { test as base } from "@playwright/test";
export { expect, type Locator } from "@playwright/test";

/** Existing runtime/device checks exercise the full workspace, not the first-use flow. */
export const test = base.extend<{ workspaceScreen: void }>({
  workspaceScreen: [async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem("micropython-web-lab:app-screen:v1", "workspace");
      // Runtime tests use batch input repeatedly; the dedicated layout tests
      // exercise its closed-by-default presentation separately.
      window.addEventListener("DOMContentLoaded", () => {
        const batch = document.querySelector<HTMLDetailsElement>("#repl-batch");
        if (batch !== null) batch.open = true;
      });
    });
    await use();
  }, { auto: true }],
});
