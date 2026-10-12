import { openYmConnections, applyYmConnections } from "./ym2203-workspace";
import { test, expect } from "./workspace-test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const cardSelector = '[data-device-instance="ym2203-prototype"]';
async function connect(page: Page) {
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await openYmConnections(page);
  await expect(page.getByLabel("YM2203音源（実験用）を接続")).not.toBeChecked();
  await expect(page.locator(cardSelector)).toHaveCount(0);
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
  await expect(page.locator(cardSelector)).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
}
async function unmute(page: Page) {
  await page.locator(`${cardSelector} [data-ym-mute]`).click();
  await expect(page.locator(`${cardSelector} .ym-audio-panel`)).toHaveAttribute("data-audio-state", "ready");
  await expect(page.locator(`${cardSelector} [data-ym-mute]`)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(`${cardSelector} [data-ym-status]`)).toContainText("音声有効");
}
async function outputRms(page: Page) {
  return Number(await page.locator(`${cardSelector} [data-ym-scope]`).getAttribute("data-output-rms"));
}

test("a 24-hour Pocket Signal loop replays without new I2C commands and stops on request", async ({ page }) => {
  await connect(page); await unmute(page);
  await page.locator(`${cardSelector} [data-ym-song-example]`).click();
  const source = (await page.locator("#code-editor").inputValue()).replace("REPEAT_MS = None", "REPEAT_MS = 24 * 60 * 60 * 1000");
  await page.locator("#code-editor").fill(source);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("予約演奏: 86400000 ms");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  const scope = page.locator(`${cardSelector} [data-ym-scope]`);
  await expect(scope).toHaveAttribute("data-duration-ms", "86400000");
  await expect(page.locator(`${cardSelector} [data-ym-playback]`)).toContainText("24:00:00");
  const sequence = await scope.getAttribute("data-sent"), epoch = await scope.getAttribute("data-epoch");
  await expect.poll(async () => Number(await scope.getAttribute("data-elapsed-ms")) > 13000 && Number(await scope.getAttribute("data-applied")) > 960 && await outputRms(page) > 0.001,
    { timeout: 16000, intervals: [100] }).toBe(true);
  await expect(scope).toHaveAttribute("data-sent", sequence!);
  await expect(scope).toHaveAttribute("data-epoch", epoch!);
  await page.locator("#stop-button").click();
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
  await expect(scope).toHaveAttribute("data-playback-state", "stopped");
  await page.locator("#restart-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
});

test("opening a new sample upgrades exact old libraries, refreshes open tabs and clears old imports", async ({ page }) => {
  await connect(page); await unmute(page);
  const oldBase = await readFile(new URL("../src/drivers/pre-long-playback/web_lab_ym2203_v1.py", import.meta.url), "utf8");
  const oldScore = await readFile(new URL("../src/drivers/pre-long-playback/web_lab_ym2203_score_v1.py", import.meta.url), "utf8");
  await page.locator("#code-editor").fill(`import os\ntry:\n os.mkdir('lib')\nexcept OSError:\n pass\nopen('lib/web_lab_ym2203_v1.py','w').write(${JSON.stringify(oldBase)})\nopen('lib/web_lab_ym2203_score_v1.py','w').write(${JSON.stringify(oldScore)})\nfrom web_lab_ym2203_v1 import YM2203\nprint('old driver loaded')`);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("old driver loaded");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.getByRole("treeitem", { name: "lib", exact: true }).press("ArrowRight");
  await page.locator("#project-file-tree [data-path='lib/web_lab_ym2203_v1.py'] > .project-tree-row").dblclick();
  await expect(page.locator("#code-editor")).toHaveValue(oldBase);
  await page.locator(`${cardSelector} [data-ym-song-example]`).click();
  await expect(page.locator("#code-editor")).toHaveValue(/Pocket Signal/);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.getByRole("tab", { name: /web_lab_ym2203_v1/ }).click();
  await expect(page.locator("#code-editor")).toHaveValue(/repeat_ms=None/);
  await page.locator("#code-editor").fill("from machine import I2C, Pin\nfrom web_lab_ym2203_score_v1 import YM2203\nsound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8)))\nsound.reserve((60,), source='ssg', repeat_ms=86400000)\nprint('new loop API works')");
  // Execute from a separate new sample tab, so the library itself stays unchanged.
  await page.locator(`${cardSelector} [data-ym-song-example]`).click();
  await expect(page.locator("#draft-status")).toContainText("競合");
  await page.locator("#code-editor").fill((await readFile(new URL("../src/drivers/web_lab_ym2203_v1.py", import.meta.url), "utf8")));
  await page.getByRole("tab", { name: /YM2203 Pocket Signal/ }).click();
  await page.locator("#code-editor").fill("from machine import I2C, Pin\nfrom web_lab_ym2203_score_v1 import YM2203\nsound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8)))\nsound.reserve((60,), source='ssg', repeat_ms=86400000)\nprint('new loop API works')");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("new loop API works");
  await page.locator("#stop-button").click();
});

test("a conflicting saved driver and unsaved draft can be backed up before the new sample plays", async ({ page }, testInfo) => {
  await connect(page); await unmute(page);
  await page.locator(`${cardSelector} [data-ym-song-example]`).click();
  const oldBase = (await readFile(new URL("../src/drivers/pre-long-playback/web_lab_ym2203_v1.py", import.meta.url), "utf8")) + "\n# retained customization\n";
  await page.locator("#code-editor").fill(`open('lib/web_lab_ym2203_v1.py','w').write(${JSON.stringify(oldBase)})\nopen('web_lab_ym2203_score_v1.py','w').write("MARKER = 'saved shadow'\\n")\nimport web_lab_ym2203_v1\nprint('custom driver loaded')`);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("custom driver loaded");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.getByRole("treeitem", { name: "lib", exact: true }).press("ArrowRight");
  await page.locator("#project-file-tree [data-path='lib/web_lab_ym2203_v1.py'] > .project-tree-row").dblclick();
  await page.locator("#code-editor").fill("# unsaved driver draft\n");
  await page.locator(`${cardSelector} [data-ym-song-example]`).click();
  await expect(page.locator(".ym-library-recovery")).toContainText("lib/web_lab_ym2203_v1.py");
  await expect(page.locator(".ym-library-recovery")).toContainText("web_lab_ym2203_score_v1.py");
  await expect(page.locator("#code-editor")).toHaveValue("# unsaved driver draft\n");
  await page.locator(".ym-library-recovery").screenshot({ path: testInfo.outputPath("library-conflict-desktop.png") });
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".ym-library-recovery").screenshot({ path: testInfo.outputPath("library-conflict-mobile.png") });
  await page.setViewportSize(viewport);
  await page.locator(".ym-library-recovery").getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator(".ym-library-recovery")).toBeHidden();
  await page.locator(`${cardSelector} [data-ym-song-example]`).click();
  await page.locator("[data-ym-library-update]").click();
  await expect(page.locator("#code-editor")).toHaveValue(/REPEAT_MS = None/);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator(".ym-library-recovery")).toContainText("ym2203-backups/1/");
  await page.locator("#code-editor").fill(`import os\nfrom machine import I2C, Pin\nfrom web_lab_ym2203_score_v1 import YM2203\nassert open('ym2203-backups/1/files/lib/web_lab_ym2203_v1.py').read() == ${JSON.stringify(oldBase)}\nassert 'saved shadow' in open('ym2203-backups/1/files/web_lab_ym2203_score_v1.py').read()\nfound = False\nfor index in os.listdir('ym2203-backups/1/drafts'):\n try:\n  if open('ym2203-backups/1/drafts/' + index + '/lib/web_lab_ym2203_v1.py').read() == '# unsaved driver draft\\n':\n   found = True\n except OSError:\n  pass\nassert found\nsound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8)))\nsound.reserve((60,), source='ssg', repeat_ms=86400000)\nprint('Recovery backups verified')`);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Recovery backups verified");
  await expect.poll(() => outputRms(page)).toBeGreaterThan(0.001);
  await page.locator("#stop-button").click();
  await page.getByRole("tab", { name: /web_lab_ym2203_v1/ }).click();
  await expect(page.locator("#code-editor")).toHaveValue("# unsaved driver draft\n");
  await expect(page.locator("#draft-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#code-editor")).toHaveValue("# unsaved driver draft\n");
});

test("the complete public Pocket Signal sample plays three FM voices, completes and survives saved-project restoration", async ({ page }) => {
  await connect(page);
  await unmute(page);
  await page.locator(`${cardSelector} [data-ym-song-example]`).click();
  await expect(page.locator("#code-editor")).toHaveValue(/Pocket Signal.*[\s\S]*CC0-1.0/);
  await expect(page.locator("#code-editor")).toHaveValue(/MELODY = \([\s\S]*sound.fm_patch/);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("予約演奏: 12020 ms");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect.poll(() => outputRms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  const scope = page.locator(`${cardSelector} [data-ym-scope]`);
  await expect.poll(async () => Number(await scope.getAttribute("data-fm-rms"))).toBeGreaterThan(0.001);
  await expect(scope).toHaveAttribute("data-ssg-rms", "0");
  await expect(scope).toHaveAttribute("data-playback-state", "completed", { timeout: 15000 });
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);

  await page.reload();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#code-editor")).toHaveValue(/Copyright \(c\) 2026 Keitark/);
  await expect(page.locator("#code-editor")).toHaveValue(/MELODY = \(/);
  await unmute(page);
  await page.locator("#run-script-button").click();
  await expect.poll(() => outputRms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  await page.locator("#stop-button").click();
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
});

test("the patch sample plays custom FM, SSG envelope and noise and preserves its editable library", async ({ page }) => {
  await connect(page);
  await unmute(page);
  await page.locator(`${cardSelector} [data-ym-tone-example]`).click();
  await expect(page.locator("#code-editor")).toHaveValue(/from web_lab_ym2203_tone_v1 import YM2203/);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("FM音色: algorithm = 4 feedback = 0");
  await expect.poll(async () => Number(await page.locator(`${cardSelector} [data-ym-scope]`).getAttribute("data-fm-rms")), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect(page.locator("#terminal")).toContainText("FM音色: algorithm = 4 feedback = 5");
  await expect(page.locator("#terminal")).toContainText("FM音色: algorithm = 7 feedback = 0");
  await expect(page.locator("#terminal")).toContainText("SSG: トーン＋エンベロープ");
  await expect.poll(async () => Number(await page.locator(`${cardSelector} [data-ym-scope]`).getAttribute("data-ssg-rms")), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect(page.locator("#terminal")).toContainText("SSG: ノイズのみ");
  await expect.poll(() => outputRms(page), { intervals: [30] }).toBeGreaterThan(0.001);
  await expect(page.locator("#terminal")).toContainText("SSG: トーン＋ノイズ");
  await expect(page.locator("#terminal")).toContainText("音色設定サンプル完了");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
  await page.reload();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator("#code-editor")).toHaveValue(/sound.fm_patch\(operators/);
  await page.locator("#code-editor").fill('from web_lab_ym2203_tone_v1 import YM2203\nprint("Patch APIs:", hasattr(YM2203, "fm_patch"), hasattr(YM2203, "reserve_score"))\nwith open("lib/web_lab_ym2203_tone_v1.py", "w") as f:\n    f.write("# my patch driver\\n")\nprint("Patch driver edited")');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Patch APIs: True True");
  await expect(page.locator("#terminal")).toContainText("Patch driver edited");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  const original = await page.locator("#code-editor").inputValue();
  await page.locator(`${cardSelector} [data-ym-tone-example]`).click();
  await expect(page.locator("#draft-status")).toContainText("既存の音源ドライバーと競合");
  await expect(page.locator("#code-editor")).toHaveValue(original);
});

test("speaker volume scales the stronger output and zero still silences playback", async ({ page }) => {
  await connect(page);
  await unmute(page);
  const setVolume = async (value: number) => {
    await page.locator(`${cardSelector} input[type="range"]`).evaluate((input: HTMLInputElement, percent) => {
      input.value = String(percent); input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  await setVolume(25);
  await page.locator("#code-editor").fill('from machine import I2C\ni = I2C(0)\ni.writeto(0x44, bytes((4, 50)))\ni.writeto(0x44, bytes((0, 7, 62, 0, 28, 1, 1, 8, 11)))');
  await page.locator("#run-script-button").click();
  // SSG native RMS is about 0.063: output calibration 4 * amp .5 * speaker .25.
  // Let the DC-removal startup transient settle, then average meter windows.
  const averageRms = () => page.locator(`${cardSelector} [data-ym-scope]`).evaluate(async (scope: HTMLElement) => {
    let total = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      total += Number(scope.dataset.outputRms);
    }
    return total / 12;
  });
  await expect.poll(async () => Math.abs(await outputRms(page) - 0.0315), { intervals: [30] }).toBeLessThan(0.001);
  const low = await averageRms();
  expect(low).toBeGreaterThan(0.025);
  await setVolume(100);
  await expect.poll(async () => Math.abs(await outputRms(page) - 0.126), { intervals: [30] }).toBeLessThan(0.003);
  const high = await averageRms();
  expect(high / low).toBeGreaterThan(3.8);
  expect(high / low).toBeLessThan(4.2);
  await setVolume(0);
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
  await setVolume(100);
  await expect.poll(() => outputRms(page)).toBeGreaterThan(0.1);
  await page.locator("#stop-button").click();
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
});

test("the ensemble sample reserves six channels together and plays FM plus SSG after Python finishes", async ({ page }) => {
  await connect(page);
  await unmute(page);
  await page.locator(`${cardSelector} [data-ym-score-example]`).click();
  await expect(page.locator("#code-editor")).toHaveValue(/from web_lab_ym2203_score_v1 import YM2203/);
  await page.evaluate(() => {
    const scope = document.querySelector<HTMLElement>('[data-ym-scope]')!;
    const observations: { fm: number; ssg: number; runtime: string }[] = [];
    (window as unknown as { scoreObservations: typeof observations }).scoreObservations = observations;
    new MutationObserver(() => {
      observations.push({ fm: Number(scope.dataset.fmRms), ssg: Number(scope.dataset.ssgRms), runtime: document.querySelector("#runtime-status")!.textContent! });
    }).observe(scope, { attributes: true, attributeFilter: ["data-applied"] });
  });
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("FM＋SSG合奏: メロディ・伴奏・ベース（6ch）");
  await expect(page.locator("#terminal")).toContainText("予約演奏: 3000 ms");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator(`${cardSelector} [data-ym-playing]`)).toHaveText("PLAYING");
  await expect(page.locator(`${cardSelector} [data-ym-playing]`)).toHaveText("STANDBY");
  await expect(page.locator(`${cardSelector} [data-ym-scope]`)).toHaveAttribute("data-applied", "198");
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
  const observations = await page.evaluate(() => (window as unknown as { scoreObservations: { fm: number; ssg: number; runtime: string }[] }).scoreObservations);
  for (const runtime of ["スクリプト実行中", "実行可能"]) expect(observations.some(value => value.fm > 0.001 && value.ssg > 0.001 && value.runtime === runtime), `No mixed audio observed during ${runtime}`).toBe(true);
  await page.reload();
  await expect(page.locator("#code-editor")).toHaveValue(/sound.reserve_score\(tracks\)/);
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await unmute(page);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("予約演奏: 3000 ms");
});

test("an opt-in sound module plays isolated FM and SSG from a normal editor tab", async ({ page }) => {
  await connect(page);
  await unmute(page);
  await page.locator(`${cardSelector} .device-ui-example-button`).click();
  await page.evaluate(() => {
    const scope = document.querySelector<HTMLElement>('[data-ym-scope]')!;
    const observations: { fm: number; ssg: number; applied: number }[] = [];
    (window as unknown as { soundObservations: typeof observations }).soundObservations = observations;
    new MutationObserver(() => observations.push({ fm: Number(scope.dataset.fmRms), ssg: Number(scope.dataset.ssgRms), applied: Number(scope.dataset.applied) }))
      .observe(scope, { attributes: true, attributeFilter: ["data-applied"] });
  });
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("FMのみ: ドレミファソファミレド");
  await expect.poll(() => outputRms(page), { intervals: [30] }).toBeGreaterThan(0.0001);
  await expect(page.locator("#terminal")).toContainText("SSGのみ: ドレミファソファミレド");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator(`${cardSelector} [data-ym-playing]`)).toHaveText("PLAYING");
  await expect(page.locator(`${cardSelector} [data-ym-playing]`)).toHaveText("STANDBY");
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
  const observations = await page.evaluate(() => (window as unknown as { soundObservations: { fm: number; ssg: number; applied: number }[] }).soundObservations);
  expect(observations.some(value => value.fm > 0.001 && value.ssg < 0.00001)).toBe(true);
  expect(observations.some(value => value.ssg > 0.001 && value.fm < 0.00001)).toBe(true);
  expect(observations.every(value => value.fm < 0.00001 || value.ssg < 0.00001)).toBe(true);
  expect(observations.at(-1)?.applied).toBe(36);
  // Connections and source survive a reload; audio requires a new explicit click.
  await page.reload();
  await expect(page.locator(cardSelector)).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#code-editor")).toHaveValue(/MELODY =/);
  await expect(page.locator(`${cardSelector} [data-ym-mute]`)).toBeEnabled();
  await expect(page.locator(`${cardSelector} [data-ym-mute]`)).toHaveAttribute("aria-pressed", "true");
  await page.locator("#code-editor").fill('from machine import I2C\nfrom web_lab_ym2203_v1 import YM2203\nprint("Presets:", YM2203.PRESETS)\nprint([hex(x) for x in I2C(0).scan()])');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("['0x44', '0x50', '0x76']");
  await expect(page.locator("#terminal")).toContainText("Presets: ('soft', 'bright', 'bell')");
});

test("opening the music sample installs an editable driver and preserves user changes", async ({ page }) => {
  await connect(page);
  await page.locator(`${cardSelector} .device-ui-example-button`).click();
  await expect(page.locator("#code-editor")).toHaveValue(/from web_lab_ym2203_v1 import YM2203/);
  await page.locator("#code-editor").fill('with open("lib/web_lab_ym2203_v1.py") as f:\n    print("Installed:", f.readline().strip())\nwith open("lib/web_lab_ym2203_v1.py", "w") as f:\n    f.write("# my edited driver\\n")\nprint("Library edited")');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Installed: # SPDX-License-Identifier: MIT");
  await expect(page.locator("#terminal")).toContainText("Library edited");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  const original = await page.locator("#code-editor").inputValue();
  await page.locator(`${cardSelector} .device-ui-example-button`).click();
  await expect(page.locator("#draft-status")).toContainText("既存の音源ドライバーと競合");
  await expect(page.locator("#code-editor")).toHaveValue(original);
  await page.locator("#code-editor").fill('print("Preserved:", open("lib/web_lab_ym2203_v1.py").read().strip())');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Preserved: # my edited driver");
});

test("sound is stopped on host stop, restart, and Python errors", async ({ page }) => {
  await connect(page);
  await unmute(page);
  const sound = 'from machine import I2C\ni = I2C(0)\ni.writeto(0x44, bytes((0, 7, 62, 0, 200, 1, 1, 8, 12)))\n';
  await page.locator("#code-editor").fill(sound + 'while True:\n    pass');
  await page.locator("#run-script-button").click();
  await expect.poll(() => outputRms(page), { intervals: [30] }).toBeGreaterThan(0.0001);
  await page.locator(`${cardSelector} [data-ym-mute]`).click();
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
  await page.locator(`${cardSelector} [data-ym-mute]`).click();
  await expect.poll(() => outputRms(page), { intervals: [30] }).toBeGreaterThan(0.0001);
  await page.locator("#stop-button").click();
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
  await expect(page.locator(`${cardSelector} [data-ym-scope]`)).toHaveAttribute("data-active", "false");
  await page.locator("#restart-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  // Hold the note until the browser has observed it. A fixed 400 ms window
  // can end before a loaded runner returns from click() and samples the RMS.
  const button = page.locator('[data-device-instance="button-gp15"] [data-device-component="press"] button');
  await expect(button).toHaveAttribute("data-pressed", "false");
  await page.locator("#code-editor").fill(sound + 'from machine import Pin\nbutton = Pin(15, Pin.IN, Pin.PULL_UP)\nprint("sound error waiting")\nwhile button.value():\n    pass\nraise ValueError("sound test error")');
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("sound error waiting");
  await expect.poll(() => outputRms(page), { intervals: [30] }).toBeGreaterThan(0.0001);
  await button.focus();
  await page.keyboard.down("Space");
  try {
    await expect(page.locator("#terminal")).toContainText("ValueError: sound test error");
    await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
    await expect(page.locator(`${cardSelector} [data-ym-scope]`)).toHaveAttribute("data-active", "false");
  } finally {
    await page.keyboard.up("Space");
  }
});

test("connected audio starts muted and disconnecting closes the audio context", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) { super(options); (window as unknown as { testAudio: AudioContext }).testAudio = this; }
    };
  });
  await connect(page);
  await expect(page.locator(`${cardSelector} .ym-audio-panel`)).toHaveAttribute("data-audio-state", "ready");
  await expect(page.locator(`${cardSelector} [data-ym-enable]`)).toHaveCount(0);
  await expect(page.locator(`${cardSelector} [data-ym-mute]`)).toHaveText("ミュート");
  await expect(page.locator(`${cardSelector} [data-ym-mute]`)).toHaveAttribute("aria-pressed", "true");
  await page.locator(`${cardSelector} .device-ui-example-button`).click();
  await page.locator("#run-script-button").click();
  await expect.poll(async () => Number(await page.locator(`${cardSelector} [data-ym-scope]`).getAttribute("data-fm-rms"))).toBeGreaterThan(0.001);
  await expect.poll(() => outputRms(page)).toBeLessThan(1e-6);
  await expect(page.locator(`${cardSelector} [data-ym-mute]`)).toHaveAttribute("aria-pressed", "true");
  await page.locator(`${cardSelector} [data-ym-mute]`).click();
  await expect.poll(() => outputRms(page), { intervals: [30] }).toBeGreaterThan(0.0001);
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").uncheck();
  await applyYmConnections(page);
  await expect(page.locator(cardSelector)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { testAudio: AudioContext }).testAudio.state)).toBe("closed");
  await page.reload();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(page.locator(cardSelector)).toHaveCount(0);
});
