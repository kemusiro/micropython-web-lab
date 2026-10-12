import { expect, test } from "./workspace-test";

test("nested Python calls preserve live objects across GC and permit later execution", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  const source = "def descend(depth, recurse):\n    if depth == 0:\n        import gc\n        keep = bytearray(b'gc-root')\n        gc.collect()\n        return bytes(keep)\n    return recurse(depth - 1, recurse)\nprint('nested-gc', descend(12, descend))";
  await page.locator("#code-editor").fill(source);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("nested-gc b'gc-root'");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill('print("after-nested-gc", 6 * 7)');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("after-nested-gc 42");
});

test("Ctrl+D resets Python state and outputs while preserving editor and analog input", async ({ page }) => {
  await page.goto("/");
  const ready = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const editor = page.locator("#code-editor");
  const adc = page.locator('[data-device-instance="analog-gp26"]').getByRole("slider", { name: "ADC値" });
  const led = page.locator('[data-device-instance="built-in-led"] [data-device-component="output"] output');
  await expect(ready).toBeVisible();
  await adc.fill("60000");
  const source = 'from machine import Pin\nreset_marker = 123\nPin("LED", Pin.OUT).on()';
  await editor.fill(source);
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(led).toHaveText("点灯");
  await expect(ready).toBeVisible();
  await page.getByLabel("REPLへ直接入力").focus();
  // Ctrl+D completes a compound statement without resetting Python or device state.
  await page.keyboard.type("if True:");
  await page.keyboard.press("Enter");
  await page.keyboard.type(' print("block-result", reset_marker)');
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+d");
  await expect(terminal).toContainText("block-result 123");
  await expect(terminal).not.toContainText("ソフトリセット");
  await expect(led).toHaveText("点灯");

  await page.keyboard.press("Control+d");
  await expect(terminal).toContainText("ソフトリセット");
  await expect(ready).toBeVisible();
  await expect(editor).toHaveValue(source);
  await expect(led).toHaveText("消灯");
  await page.locator("#repl-input").fill('from machine import ADC, Pin; print("reset-result", "reset_marker" in globals(), ADC(Pin(26)).read_u16())');
  await page.getByRole("button", { name: "REPLへ送信" }).click();
  await expect(terminal).toContainText("reset-result False 60000");
  await expect(adc).toHaveValue("60000");
});

for (const [name, body] of [
  ["long lines", 'print("x" * 1000)'],
  ["no newlines", 'sys.stdout.write("x" * 1000)'],
  ["empty lines", "print()"],
  ["alternating streams", 'sys.stdout.write("x"); sys.stderr.write("y")'],
]) {
  test(`recovers from unlimited output with ${name}`, async ({ page }) => {
    await page.goto("/");
    const ready = page.getByText("実行可能", { exact: true });
    const terminal = page.locator("#terminal");
    const editor = page.locator("#code-editor");
    await expect(ready).toBeVisible();
    const source = `import sys\nwhile True:\n    ${body}`;
    await editor.fill(source);
    await page.getByRole("button", { name: "スクリプトを実行" }).click();
    await expect(terminal).toContainText("出力量が100,000文字の上限を超えた", { timeout: 15_000 });
    await expect(ready).toBeVisible();
    await expect(editor).toHaveValue(source);
    await page.locator("#repl-input").fill('print("recovered", 6 * 7)');
    await page.getByRole("button", { name: "REPLへ送信" }).click();
    await expect(terminal).toContainText("recovered 42");
    await page.getByRole("button", { name: "出力を消去" }).click();
    await expect(terminal).toHaveText("");
  });
}


test("Ctrl+D REPL execution has no deadline and can be interrupted", async ({ page }) => {
  await page.goto("/");
  const ready = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  await expect(ready).toBeVisible();
  await page.getByLabel("REPLへ直接入力").focus();
  await page.keyboard.type("while True:");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" pass");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("... ");
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(11_500); // Cross the former deadline with an actual infinite WASM loop.
  await expect(terminal).not.toContainText("上限を超えた");
  await expect(page.locator("#run-script-button")).toBeDisabled();
  await page.keyboard.press("Control+c");
  await expect(terminal).toContainText("実行中のコードを強制停止");
  await expect(ready).toBeVisible();
  await page.locator("#repl-input").fill('print("after interruption", 42)');
  await page.getByRole("button", { name: "REPLへ送信" }).click();
  await expect(terminal).toContainText("after interruption 42");
});
