import { expect, test, type Page } from "@playwright/test";
import { PROJECT_DATABASE_NAME } from "../src/project/database";

/** Include selection, files, editor buffers and wiring; browsing must not write any of them. */
async function savedState(page: Page): Promise<string> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const tx = db.transaction(["experimentSets", "experimentWorkspace"], "readonly");
        const sets = tx.objectStore("experimentSets").getAll();
        const workspace = tx.objectStore("experimentWorkspace").get("current");
        tx.oncomplete = () => resolve(JSON.stringify({ sets: sets.result, workspace: workspace.result }));
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, PROJECT_DATABASE_NAME);
}

for (const locale of ["ja", "en"] as const) {
  for (const width of [320, 736, 1280]) {
    test(`offers three entrances and keyboard-only browsing in ${locale} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.addInitScript(locale => localStorage.setItem("micropython-web-lab:locale:v1", locale), locale);
      await page.goto("/lab/");
      await expect(page.locator("#run-script-button")).toBeEnabled();
      await expect(page.locator(".lede")).toContainText(locale === "ja" ? "マイコンがなくても" : "No microcontroller needed");
      for (const id of ["open-experiment-button", "choose-experiment-button", "open-workspace-button"]) {
        await expect(page.locator(`#${id}`)).toBeVisible();
      }
      const before = await savedState(page);
      await page.locator("#open-experiment-button").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#run-script-button")).toBeFocused();
      expect(await savedState(page)).toBe(before);
      await page.locator("#choose-experiment-button").focus();
      await page.keyboard.press("Enter");
      const picker = page.locator("#experiment-picker");
      await expect(picker).toBeVisible();
      await expect(picker.locator("[data-experiment-template]")).toHaveCount(3);
      await expect(picker.locator("[data-create-experiment]")).toHaveText(Array(3).fill(locale === "ja" ? "この実験を開く" : "Open this experiment"));
      if (width === 320) {
        for (const button of await picker.locator("[data-create-experiment]").all()) {
          expect(await button.evaluate(element => {
            const text = document.createRange();
            text.selectNodeContents(element);
            return text.getClientRects().length;
          })).toBe(1);
        }
      }
      await expect(picker.locator("#experiment-browse")).toBeHidden();
      await expect(page.locator("#close-experiment-picker")).toBeFocused();
      for (const id of ["button-led", "one-axis-arm", "ym2203"]) {
        await page.keyboard.press("Tab");
        await expect(picker.locator(`[data-create-experiment="${id}"]`)).toBeFocused();
      }
      await page.keyboard.press("Tab");
      await expect(page.locator("#experiment-all-topics")).toBeFocused();
      expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(page.locator("body")).toHaveAttribute("data-app-screen", "experiment");
      await page.screenshot({ path: `.playwright/entry-review/${locale}-picker-${width}.png` });
      await page.locator("#experiment-all-topics").focus();
      await page.keyboard.press("Enter");
      await expect(picker.locator("[data-experiment-category]")).toHaveCount(5);
      await page.locator('[data-experiment-category="books"]').focus();
      await page.keyboard.press("Enter");
      await expect(picker).toContainText(locale === "ja" ? "この分野の実験は準備中" : "Experiments in this category are in preparation");
      await expect(picker.locator("[data-create-experiment]")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();
      await expect(page.locator("#choose-experiment-button")).toBeFocused();
      expect(await savedState(page)).toBe(before);
      await expect(page.locator("#code-editor")).toHaveValue(/interval_ms = 500/);
      await expect(page.locator("#terminal")).not.toContainText("LED blink complete");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (width === 320) {
        const run = (await page.locator("#run-script-button").boundingBox())!;
        expect(run.y + run.height).toBeLessThanOrEqual(700);
      }
      await page.screenshot({ path: `.playwright/entry-review/${locale}-entry-${width}.png`, fullPage: true });
    });
  }

  for (const id of ["button-led", "one-axis-arm", "ym2203"] as const) {
    test(`opens featured ${id} from a fresh ${locale} /lab/ without running it`, async ({ page }) => {
      await page.addInitScript(locale => localStorage.setItem("micropython-web-lab:locale:v1", locale), locale);
      await page.goto("/lab/");
      await expect(page.locator("#run-script-button")).toBeEnabled();
      await page.locator("#choose-experiment-button").click();
      await page.locator(`[data-create-experiment="${id}"]`).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#experiment-picker")).toBeHidden();
      await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
      await expect(page.locator("#run-script-button")).toBeEnabled();
      await expect(page.locator("#code-editor")).toBeFocused();
      const state = JSON.parse(await savedState(page));
      expect(state.sets).toHaveLength(2);
      expect(state.sets.find((record: { id: string }) => record.id === state.workspace.selectedSetId).origin.id).toBe(id);
      if (id === "one-axis-arm") {
        await expect(page.locator("#arm-workbench")).toBeVisible();
        await expect(page.locator("#arm-workbench")).not.toHaveAttribute("data-result", "completed");
        await expect(page.locator("#code-editor")).toHaveValue(/experiment.step\(\)/);
      } else {
        await expect(page.locator("#terminal")).not.toContainText("Script started");
        if (id === "button-led") {
          await expect(page.locator('#device-ui-root [data-device-instance="button-gp15"]')).toBeVisible();
          await expect(page.locator('#device-ui-root [data-device-instance="built-in-led"] output')).toHaveAttribute("data-active", "false");
        } else {
          await expect(page.locator('#device-ui-root [data-device-instance="ym2203-prototype"] [data-ym-mute]')).toHaveAttribute("aria-pressed", "true");
          await expect(page.locator("#code-editor")).toHaveValue(/web_lab_ym2203_score_v1/);
        }
      }
    });
  }
}

test("browsing and closing the picker keep running Python and the selected set", async ({ page }) => {
  await page.goto("/lab/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#code-editor").fill("while True:\n    pass");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("スクリプト実行中");
  const before = await savedState(page);
  await page.locator("#choose-experiment-button").click();
  await expect(page.locator("#experiment-switch-note")).toContainText("閲覧だけなら続行");
  await page.locator("#experiment-all-topics").click();
  await page.locator('[data-experiment-category="physical"]').click();
  await expect(page.locator('[data-create-experiment="one-axis-arm"]')).toBeVisible();
  await page.locator("#close-experiment-picker").click();
  await expect(page.locator("#choose-experiment-button")).toBeFocused();
  await expect(page.locator("#runtime-status")).toHaveText("スクリプト実行中");
  expect(await savedState(page)).toBe(before);
  await page.locator("#experiment-stop-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
});

test("restores named work, edited code and wiring through the entrance and existing links", async ({ page }) => {
  await page.goto("/lab/#experiment-guide");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const source = (await page.locator("#code-editor").inputValue()).replace("interval_ms = 500", "interval_ms = 233");
  await page.locator("#code-editor").fill(source);
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.locator("#open-workspace-button").click();
  await page.locator(".experiment-management summary").click();
  await page.getByRole("textbox", { name: "実験セット名" }).fill("わたしのLED実験");
  await page.getByRole("button", { name: "名前を保存", exact: true }).click();
  await expect(page.locator("#experiment-set-name")).toHaveText("わたしのLED実験");
  await page.locator("#open-device-configuration").click();
  await page.getByLabel("押しボタンを接続", { exact: true }).check();
  await page.getByLabel("押しボタン 入力 接続先").selectOption("GP13");
  await page.getByRole("button", { name: "配線を適用", exact: true }).click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#close-device-configuration").click();
  await page.locator("#open-experiment-button").click();
  await expect(page.locator("#continue-work-name")).toContainText("わたしのLED実験");
  await expect(page.locator("#code-editor")).toHaveValue(source);
  await page.reload();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#continue-work-name")).toContainText("わたしのLED実験");
  await expect(page.locator("#code-editor")).toHaveValue(source);
  const before = await savedState(page);
  await page.locator("#choose-experiment-button").click();
  await page.keyboard.press("Escape");
  await page.locator("#open-workspace-button").click();
  await expect(page.locator('#device-ui-root [data-device-instance="button-gp15"]').getByRole("button", { name: "GP13", exact: true })).toBeVisible();
  expect(await savedState(page)).toBe(before);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "workspace");
  await expect(page.locator("#code-editor")).toHaveValue(source);
});

test("reopens an edited featured copy instead of replacing it or creating another", async ({ page }) => {
  await page.goto("/lab/");
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await page.locator("#choose-experiment-button").click();
  await page.locator('[data-create-experiment="button-led"]').click();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  const source = "# my edited button experiment\nprint('only run when asked')";
  await page.locator("#code-editor").fill(source);
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.locator("#open-experiment-button").click();
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "experiment");
  await page.locator("#choose-experiment-button").click();
  const card = page.locator('[data-experiment-template="button-led"]');
  await card.getByRole("button", { name: "保存したセットを開く", exact: true }).click();
  await expect(page.locator("#experiment-picker")).toBeHidden();
  await expect(page.locator("#run-script-button")).toBeEnabled();
  await expect(page.locator("#code-editor")).toHaveValue(source);
  await expect(page.locator("#terminal")).not.toContainText("only run when asked");
  expect(JSON.parse(await savedState(page)).sets).toHaveLength(2);
});
