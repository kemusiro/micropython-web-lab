import type { Page } from "@playwright/test";

/** The current workspace keeps wiring in a dedicated screen. */
export async function openYmConnections(page: Page): Promise<void> {
  if (!await page.locator("#device-configuration-screen").isVisible()) {
    await page.locator("#open-device-configuration").click();
  }
}

export async function applyYmConnections(page: Page): Promise<void> {
  await page.getByRole("button", { name: "配線を適用", exact: true }).click();
  await page.locator("#close-device-configuration").click();
}
