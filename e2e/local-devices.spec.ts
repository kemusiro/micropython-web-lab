import { expect, test } from "@playwright/test";

test("loads and wires local BME280 and SSD1331 devices together", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  const banner = page.locator("#local-device-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("ローカル開発モード · 未承認デバイス");
  await expect(banner).toContainText("2インスタンス／2ソース");
  await expect(banner).toContainText("Local BME280 Fixture（environment-sensor）");
  await expect(banner).toContainText("Local SSD1331 Fixture（environment-display）");

  const sensorConnection = page.locator(
    '[data-connection-device="environment-sensor"]',
  );
  const displayConnection = page.locator(
    '[data-connection-device="environment-display"]',
  );
  await expect(sensorConnection).toContainText("org.example.local-bme280@0.1.0");
  await expect(sensorConnection).toContainText("7-bit address 0x76");
  await expect(page.getByLabel("Local BME280 Fixture I2C 接続先")).toHaveValue("0");
  await expect(displayConnection).toContainText("org.example.local-ssd1331@0.1.0");
  await expect(page.getByLabel("Local SSD1331 Fixture SPI 接続先")).toHaveValue("0");
  await expect(page.getByLabel("Local SSD1331 Fixture CS 接続先")).toHaveValue("GP5");
  await expect(page.locator('[data-device-instance="built-in-led"]')).toBeVisible();
  await expect(page.locator('[data-device-instance="ae-bme280-0x76"]')).toHaveCount(0);

  const source = [
    "from machine import I2C, Pin, SPI",
    "i2c = I2C(0)",
    "print('local scan', [hex(address) for address in i2c.scan()])",
    "print('local chip', hex(i2c.readfrom_mem(0x76, 0xD0, 1)[0]))",
    "cs = Pin(5, Pin.OUT)",
    "cs.value(1)",
    "spi = SPI(0, baudrate=2000000)",
    "received = bytearray(3)",
    "cs.value(0)",
    "spi.write_readinto(bytes([1, 2, 3]), received)",
    "cs.value(1)",
    "print('local display', list(received))",
  ].join("\n");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  await expect(runtimeReady).toBeVisible();
  await page.locator("#code-editor").fill(source);
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  const terminal = page.locator("#terminal");
  await expect(terminal).toContainText("local scan ['0x76']");
  await expect(terminal).toContainText("local chip 0x60");
  await expect(terminal).toContainText("local display [164, 167, 166]");

  await page.getByRole("button", { name: "再起動" }).click();
  await expect(runtimeReady).toBeVisible();
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(terminal).toContainText("local scan ['0x76']");
  await expect(terminal).toContainText("local display [164, 167, 166]");
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
  expect(errors).toEqual([]);
});
