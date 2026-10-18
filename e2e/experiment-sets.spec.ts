import { expect, test } from "./workspace-test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { browserFixture } from "../scripts/lib/browser-fixture.mjs";

async function createSet(page: Page, id: string, category = "devices") {
  await page.locator("#experiment-browse").click();
  await page.locator(`[data-experiment-category="${category}"]`).click();
  await page.locator(`[data-create-experiment="${id}"]`).click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
}
async function openSaved(page: Page, name: string) {
  await page.locator("#experiment-saved").click();
  await page.locator("[data-saved-experiment]").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
}

test("button and LED respond to Python, turn off on completion, and a running switch discards the old worker", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await createSet(page, "button-led");
  const button = page.locator('#device-ui-root [data-device-instance="button-gp15"]').getByRole("button", { name: "GP15", exact: true });
  const led = page.locator('#device-ui-root [data-device-instance="built-in-led"] output');
  await expect(led).toHaveAttribute("data-active", "false");
  await page.locator("#run-script-button").click();
  await button.focus(); await page.keyboard.down("Space");
  await expect(led).toHaveAttribute("data-active", "true");
  await page.keyboard.up("Space"); await expect(led).toHaveAttribute("data-active", "false");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(led).toHaveAttribute("data-active", "false");
  await page.locator("#code-editor").fill("old_session_variable = 99\nwhile True:\n    pass");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("スクリプト実行中");
  await page.locator("#experiment-browse").click();
  await expect(page.locator("#runtime-status")).toHaveText("スクリプト実行中");
  await page.locator('[data-experiment-category="devices"]').click();
  await expect(page.locator('[data-create-experiment="led-blink"]')).toContainText("実行は停止");
  await page.locator('[data-create-experiment="led-blink"]').click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator('#device-ui-root [data-device-instance="button-gp15"]')).toHaveCount(0);
  await page.locator("#repl-input").fill("print('fresh-session', 'old_session_variable' in globals())");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("fresh-session False");
});

test("keeps unapplied wiring, panel order and collapsed cards with their set", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  const led = page.locator('#device-ui-root [data-device-instance="built-in-led"]');
  await led.locator(".device-ui-collapse").click();
  await page.locator('[data-device-move-handle="button-gp15"]').press("Home");
  await page.locator("#open-device-configuration").click();
  await page.getByLabel("BME280環境センサーを接続", { exact: true }).uncheck();
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.locator("#close-device-configuration").click();
  await createSet(page, "led-blink");
  await openSaved(page, "自由なデバイス実験");
  await expect(page.locator("#device-ui-root > [data-device-instance]").first()).toHaveAttribute("data-device-instance", "button-gp15");
  await expect(led.locator(".device-ui-collapse")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('#device-ui-root [data-device-instance="ae-bme280-0x76"]')).toBeVisible();
  await page.locator("#open-device-configuration").click();
  await expect(page.getByLabel("BME280環境センサーを接続", { exact: true })).not.toBeChecked();
  await page.reload(); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#open-device-configuration").click();
  await expect(page.getByLabel("BME280環境センサーを接続", { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "配線を適用", exact: true }).click();
  await page.locator("#close-device-configuration").click();
  await expect(page.locator('#device-ui-root [data-device-instance="ae-bme280-0x76"]')).toHaveCount(0);
});

test("a failed switch retains source edits and selection, and can be retried", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#code-editor").fill("print('source survives')");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).restorePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = () => { throw new DOMException("forced switch quota", "QuotaExceededError"); };
  });
  await page.locator("#experiment-browse").click(); await page.locator('[data-experiment-category="devices"]').click();
  await page.locator('[data-create-experiment="button-led"]').click();
  await expect(page.locator("#experiment-set-status")).toContainText("forced switch quota");
  await expect(page.locator("#experiment-set-name")).toHaveText("自由なデバイス実験");
  await expect(page.locator("#code-editor")).toHaveValue("print('source survives')");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await page.evaluate(() => (window as any).restorePut());
  await page.locator('[data-create-experiment="button-led"]').click();
  await expect(page.locator("#experiment-set-name")).toHaveText("ボタンでLEDを点ける");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await openSaved(page, "自由なデバイス実験");
  await expect(page.locator("#code-editor")).toHaveValue("print('source survives')");
});

test("two windows preserve conflicting buffers and can download both saved and unsaved work", async ({ page, context }) => {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  const second = await context.newPage(); await second.goto("/"); await expect(second.locator("#run-script-button")).toBeEnabled();
  await page.locator("#code-editor").fill("print('first window')");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await second.locator("#code-editor").fill("print('second conflicting window')");
  await expect(second.locator("#experiment-set-status")).toContainText("競合");
  await expect(second.locator("#code-editor")).toHaveValue("print('second conflicting window')");
  const downloading = second.waitForEvent("download");
  await second.locator("#experiment-emergency-backup").click();
  const downloaded = await downloading;
  const backup = JSON.parse(await readFile((await downloaded.path())!, "utf8"));
  expect(backup.current.tabs[0].source).toBe("print('second conflicting window')");
  expect(backup.stored.sets[0].value.editor.tabs[0].source).toBe("print('first window')");
});

test("creates the sound set with libraries, and switching away and back resets the speaker to mute", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (window as any).testContexts = [];
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) { super(options); (window as any).testContexts.push(this); }
    };
  });
  await page.reload(); await expect(page.locator("#run-script-button")).toBeEnabled();
  await createSet(page, "ym2203", "sound");
  const card = page.locator('#device-ui-root [data-device-instance="ym2203-prototype"]');
  await expect(card).toBeVisible();
  await expect(page.locator("#code-editor")).toHaveValue(/web_lab_ym2203_score_v1/);
  await expect(page.locator("#project-file-tree [data-path='lib']")).toBeVisible();
  await card.locator("[data-ym-mute]").click();
  await expect(card.locator("[data-ym-mute]")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#code-editor").fill('from machine import I2C\ni = I2C(0)\ni.writeto(0x44, bytes((4, 50)))\ni.writeto(0x44, bytes((0, 7, 62, 0, 28, 1, 1, 8, 11)))');
  await page.locator("#run-script-button").click();
  await expect.poll(async () => Number(await card.locator("[data-ym-scope]").getAttribute("data-ssg-rms"))).toBeGreaterThan(0.001);
  await createSet(page, "led-blink");
  await expect.poll(() => page.evaluate(() => (window as any).testContexts.every((context: AudioContext) => context.state === "closed"))).toBe(true);
  await openSaved(page, "YM2203の合奏");
  await expect(card.locator("[data-ym-mute]")).toHaveAttribute("aria-pressed", "true");
});

for (const width of [320, 736, 1280]) {
  test(`allows keyboard navigation and keeps the entrance within ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
    await page.locator("#experiment-browse").focus(); await page.keyboard.press("Enter");
    const category = page.locator('[data-experiment-category="learn"]');
    await category.focus(); await page.keyboard.press("Enter");
    const create = page.locator('[data-create-experiment="button-led"]');
    await create.focus(); await page.keyboard.press("Enter");
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await expect(page.locator("#experiment-set-name")).toHaveText("ボタンでLEDを点ける");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `.playwright/experiment-workspace-${width}.png`, fullPage: true });
    if (width === 1280) {
      await page.locator("#experiment-browse").click();
      await page.locator(".virtual-board-panel").screenshot({ path: ".playwright/experiment-topics.png" });
    }
  });
}

test("browses categories without stopping Python, then saves and switches complete sets", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#code-editor").fill("print('my unsaved buffer')");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.locator("#repl-input").fill("kept_variable = 42");
  await page.locator("#send-button").click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#experiment-browse").click();
  await expect(page.locator("[data-experiment-category]")).toHaveCount(5);
  await page.locator('[data-experiment-category="physical"]').click();
  await expect(page.locator('[data-create-experiment="one-axis-arm"]')).toBeVisible();
  await page.locator("#experiment-return").click();
  await page.locator("#repl-input").fill("print('kept', kept_variable)");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("kept 42");
  await page.locator("#experiment-browse").click();
  await page.locator('[data-experiment-category="devices"]').click();
  await page.locator('[data-create-experiment="button-led"]').click();
  await expect(page.locator("#experiment-set-name")).toHaveText("ボタンでLEDを点ける");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue(/led.value\(1 - button.value\(\)\)/);
  await expect(page.locator("#device-ui-root .device-ui-card")).toHaveCount(2);
  await expect(page.locator("#terminal")).not.toContainText("my unsaved buffer");
  await page.locator("#experiment-saved").click();
  const previous = page.locator("[data-saved-experiment]").filter({ has: page.getByRole("heading", { name: "自由なデバイス実験", exact: true }) });
  await previous.getByRole("button", { name: "開く", exact: true }).click();
  await expect(page.locator("#code-editor")).toHaveValue("print('my unsaved buffer')");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue("print('my unsaved buffer')");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
});


test("renames a set, creates independent copies and deletes only an inactive set after confirmation", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await createSet(page, "button-led");
  await page.locator(".experiment-management summary").click();
  await page.getByRole("textbox", { name: "実験セット名", exact: true }).fill("自分の実験");
  await page.getByRole("button", { name: "名前を保存", exact: true }).click();
  await expect(page.locator("#experiment-set-name")).toHaveText("自分の実験");
  await createSet(page, "button-led");
  await expect(page.locator("#experiment-set-name")).toHaveText("ボタンでLEDを点ける");
  await page.locator("#experiment-saved").click();
  const current = page.locator("[data-saved-experiment]").filter({ has: page.getByRole("heading", { name: "ボタンでLEDを点ける", exact: true }) });
  await expect(current.getByRole("button", { name: "削除", exact: true })).toBeDisabled();
  const previous = page.locator("[data-saved-experiment]").filter({ has: page.getByRole("heading", { name: "自分の実験", exact: true }) });
  page.once("dialog", dialog => dialog.dismiss());
  await previous.getByRole("button", { name: "削除", exact: true }).click();
  await expect(previous).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await previous.getByRole("button", { name: "削除", exact: true }).click();
  await expect(previous).toHaveCount(0);
  await page.reload(); await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#experiment-set-name")).toHaveText("ボタンでLEDを点ける");
});

test("retains the newly committed set when its Worker cannot start, and permits restart", async ({ page }) => {
  const server = await browserFixture();
  try {
    await page.goto(server.url); await expect(page.locator("#run-script-button")).toBeEnabled();
    server.setFault("wasm");
    await page.locator("#experiment-browse").click(); await page.locator('[data-experiment-category="devices"]').click();
    await page.locator('[data-create-experiment="button-led"]').click();
    await expect(page.locator("#experiment-set-name")).toHaveText("ボタンでLEDを点ける");
    await expect(page.locator("#runtime-status")).toHaveText("エラー");
    await expect(page.locator("#code-editor")).toBeEnabled();
    server.setFault("none");
    await page.locator("#restart-button").click();
    await expect(page.locator("#run-script-button")).toBeEnabled();
    await expect(page.locator("#code-editor")).toHaveValue(/led.value/);
    await page.reload(); await expect(page.locator("#run-script-button")).toBeEnabled();
    await expect(page.locator("#experiment-set-name")).toHaveText("ボタンでLEDを点ける");
  } finally { await server.close(); }
});

test("an automatic view save waits until a slow explicit file replacement is installed", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#project-file-tools > summary").click();
  await page.locator("#project-root-select").click();
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete")!;
    let delayed = false;
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", { ...descriptor, set(callback) {
      if (!delayed && this.mode === "readwrite") {
        delayed = true;
        descriptor.set!.call(this, (event: Event) => window.setTimeout(() => callback.call(this, event), 1200));
      } else descriptor.set!.call(this, callback);
    } });
  });
  await page.locator("#project-directory-create").click();
  await page.locator("#project-entry-name").fill("retained-folder");
  await page.locator("#project-name-dialog").getByRole("button", { name: "作成", exact: true }).click();
  await page.locator('#device-ui-root [data-device-instance="built-in-led"] .device-ui-collapse').click();
  await expect(page.locator("#project-directory-create")).toBeEnabled();
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.reload(); await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#project-file-tree [data-path='retained-folder']")).toHaveCount(1);
  await expect(page.locator('#device-ui-root [data-device-instance="built-in-led"] .device-ui-collapse')).toHaveAttribute("aria-expanded", "false");
});


test("shows English categories in forced colors and preserves the work pane scroll while browsing", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#language-select").selectOption("en");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const panel = page.locator(".virtual-board-panel");
  await panel.evaluate(element => { element.scrollTop = 120; });
  const previous = await panel.evaluate(element => element.scrollTop);
  await page.locator("#experiment-browse").evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("button", { name: "Explore devices", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Robots and control", exact: true }).click();
  await expect(page.locator("#experiment-pane")).toContainText("One-axis arm with a load");
  await page.locator("#experiment-return").click();
  expect(await panel.evaluate(element => element.scrollTop)).toBe(previous);
  await page.locator("#experiment-browse").click();
  await page.locator('[data-experiment-category="devices"]').focus();
  await expect(page.locator('[data-experiment-category="devices"]')).toBeFocused();
  expect(previous).toBeGreaterThan(0);
});


test("retry saving backs up buffers after an autosave failure without writing them into the saved file", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).restoreSaving = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = () => { throw new DOMException("retryable quota", "QuotaExceededError"); };
  });
  await page.locator("#code-editor").fill("print('retry buffer')");
  await expect(page.locator("#experiment-set-status")).toContainText("retryable quota");
  await page.evaluate(() => (window as any).restoreSaving());
  await page.locator("#experiment-retry-save").click();
  await expect(page.locator("#experiment-retry-save")).toBeHidden();
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
  await page.reload(); await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue("print('retry buffer')");
  await expect(page.getByRole("tab", { name: "main.py", exact: true })).toHaveText("●main.py");
});
