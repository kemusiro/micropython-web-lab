import { expect, test } from "@playwright/test";

test("loads an unapproved local I2C device and labels the development build", async ({ page }) => {
  await page.goto("/");

  const banner = page.locator("#local-device-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("ローカル開発モード · 未承認デバイス");
  await expect(banner).toContainText(
    "I2C Register Template（org.example.i2c-register-template）",
  );
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();

  await page.locator("#code-editor").fill(
    [
      "from machine import I2C",
      "i2c = I2C(0)",
      "print('local devices', [hex(address) for address in i2c.scan()])",
      "i2c.writeto_mem(0x48, 0x20, b'LOCAL')",
      "print('local register', i2c.readfrom_mem(0x48, 0x20, 5))",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "スクリプトを実行" }).click();

  const terminal = page.locator("#terminal");
  await expect(terminal).toContainText("local devices ['0x48', '0x50', '0x76']");
  await expect(terminal).toContainText("local register b'LOCAL'");
});
