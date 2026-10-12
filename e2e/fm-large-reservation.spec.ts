import { openYmConnections, applyYmConnections } from "./ym2203-workspace";
import { test, expect } from "./workspace-test";
import { ProjectFiles } from "../src/project/filesystem";
import { exportProjectZip } from "../src/project/zip";
import { MAX_YM_EVENTS } from "../src/audio/ym2203-protocol";

// Synthetic tone updates, no external music data. Exercise the real Python/JS
// byte-buffer bridge, fixed heap, status extension and worklet at full capacity.
test("accepts a full-capacity binary reservation through I2C and stops native playback", async ({ page }) => {
  const data = new Uint8Array(MAX_YM_EVENTS * 6);
  const view = new DataView(data.buffer);
  const initial = [[0, 28], [1, 1], [7, 62], [8, 11]];
  for (let i = 0; i < MAX_YM_EVENTS; i++) {
    view.setUint32(i * 6, Math.max(0, i - 4), true);
    data[i * 6 + 4] = i < initial.length ? initial[i]![0]! : 8;
    data[i * 6 + 5] = i < initial.length ? initial[i]![1]! : 11;
  }
  const files = new ProjectFiles();
  files.write("events.bin", data);
  files.write("main.py", new TextEncoder().encode(`from machine import I2C, Pin
from gc import collect
bus = I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000)
bus.writeto(0x44, b'\\x03')
bus.writeto(0x44, b'\\x04\\x14')
with open('events.bin', 'rb') as data:
    batches = 0
    while True:
        if batches % 16 == 0:
            collect()
        chunk = data.read(252)
        if not chunk:
            break
        bus.writeto(0x44, b'\\x05' + chunk)
        batches += 1
collect()
status = bus.readfrom(0x44, 6)
count = status[1] | status[2] << 8 | status[4] << 16 | status[5] << 24
assert count == ${MAX_YM_EVENTS}
assert bus.readfrom(0x44, 4)[1:3] == b'\\xff\\xff'
bus.writeto(0x44, b'\\x06\\xff\\xff\\xff\\xff')
print('large-ready', count)
`));
  await page.goto("/");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#project-file-tools > summary").click();
  await page.locator("#project-zip-file").setInputFiles({ name: "large-tone.zip", mimeType: "application/zip", buffer: Buffer.from(exportProjectZip(files.snapshot())) });
  await expect(page.locator("#project-zip-import")).toBeVisible();
  page.once("dialog", dialog => dialog.accept()); await page.locator("#project-zip-import").click();
  await expect(page.locator("#code-editor")).toHaveValue(/large-ready/);
  await openYmConnections(page);
  await openYmConnections(page);
  await page.getByLabel("YM2203音源（実験用）を接続").check();
  await applyYmConnections(page);
  const sound = page.locator('[data-device-instance="ym2203-prototype"]');
  await expect(sound).toHaveAttribute("data-state", "ready");
  await sound.locator("[data-ym-mute]").click();
  await expect(sound.locator(".ym-audio-panel")).toHaveAttribute("data-audio-state", "ready");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText(`large-ready ${MAX_YM_EVENTS}`, { timeout: 15000 });
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  const scope = sound.locator("[data-ym-scope]");
  await expect(scope).toHaveAttribute("data-total", String(MAX_YM_EVENTS));
  await expect.poll(async () => Number(await scope.getAttribute("data-output-rms"))).toBeGreaterThan(0.001);
  await expect.poll(async () => Number(await scope.getAttribute("data-applied"))).toBeGreaterThan(1024);
  await page.locator("#stop-button").click();
  await expect.poll(async () => Number(await scope.getAttribute("data-output-rms"))).toBe(0);
  await page.locator("#restart-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await expect(scope).toHaveAttribute("data-output-rms", "0");
});
