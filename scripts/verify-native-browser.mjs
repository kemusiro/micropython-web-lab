import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { browserFixture } from "./lib/browser-fixture.mjs";

const browser = process.env.WEB_LAB_BROWSER ?? "firefox";
if (!["firefox", "safari"].includes(browser)) throw new Error("Use firefox or safari");
const endpoint = new URL(process.env.WEB_LAB_WEBDRIVER ?? "http://127.0.0.1:4444");
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("WebDriver must be loopback-only");
const fixture = await browserFixture(process.env.WEB_LAB_DIST ?? "dist");
const report = { browser, os: { platform: os.platform(), release: os.release(), version: os.version(), arch: os.arch() }, cases: [] };
let session;
async function command(route, body, method = "POST") {
  const response = await fetch(new URL(route, endpoint), {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw new Error(`${route}: ${value?.message ?? response.status}`);
  return value;
}
const call = (route, body, method) => command(`/session/${session}${route}`, body, method);
const js = (script, ...args) => call("/execute/sync", { script, args });
async function element(selector) {
  const value = await call("/element", { using: "css selector", value: selector });
  return value["element-6066-11e4-a52e-4f735466cecf"];
}
async function click(selector) {
  // WebDriver's automatic scrolling can leave a control under the sticky toolbar.
  // Bring it into the working area, then use the actual browser click action.
  await js('document.querySelector(arguments[0]).scrollIntoView({block:"center"})', selector);
  await call(`/element/${await element(selector)}/click`, {});
}
async function fill(selector, text) {
  const id = await element(selector);
  await call(`/element/${id}/clear`, {});
  await call(`/element/${id}/value`, { text });
}
async function until(script, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await js(`return (${script})`)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const ready = () => until('document.querySelector("#status-indicator")?.dataset.status === "ready"', "runtime ready");
const output = (text) => until(`document.querySelector("#terminal").textContent.includes(${JSON.stringify(text)})`, text);
const value = (selector) => js("return document.querySelector(arguments[0]).value", selector);
const text = (selector) => js("return document.querySelector(arguments[0]).textContent", selector);
async function navigate() {
  await call("/url", { url: fixture.url });
  await until('document.querySelector("#workspace")?.dataset.workspaceView', "UI mounted");
  if (await js('return document.body.dataset.appScreen === "experiment"')) {
    await click("#open-workspace-button");
  }
  await js('document.querySelector("#language-select").value="ja";document.querySelector("#language-select").dispatchEvent(new Event("change",{bubbles:true}))');
}
async function run(source) { await fill("#code-editor", source); await click("#run-script-button"); }
async function repl(source) { await fill("#repl-input", source); await click("#send-button"); }
async function keys(actions) { await call("/actions", { actions: [{ type: "key", id: "keyboard", actions }] }); }
const adc = '[data-device-instance="analog-gp26"] input[type="range"]';
const led = '[data-device-instance="built-in-led"] [data-device-component="output"] output';
// W3C pointer actions exercise the actual range control (including Safari).
async function rangeEnd(selector, right) {
  await js('document.querySelector(arguments[0]).scrollIntoView({block:"center"})', selector);
  const rect = await call(`/element/${await element(selector)}/rect`, undefined, "GET");
  const viewport = await js('const r=document.querySelector(arguments[0]).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}', selector);
  assert(rect.width > 20);
  await call("/actions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", duration: 0, origin: "viewport", x: Math.round(viewport.x + (right ? viewport.width - 3 : 3)), y: Math.round(viewport.y + viewport.height / 2) },
    { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
  ] }] });
}
async function check(name, work) {
  try { await work(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, passed: false, error: error.message }); throw error; }
}
try {
  const capabilities = { browserName: browser };
  if (browser === "firefox") capabilities["moz:firefoxOptions"] = { args: ["-headless"], prefs: { "intl.accept_languages": "ja-JP" } };
  const created = await command("/session", { capabilities: { alwaysMatch: capabilities } });
  session = created.sessionId;
  report.capabilities = { browserName: created.capabilities.browserName, browserVersion: created.capabilities.browserVersion, platformName: created.capabilities.platformName };
  console.log(JSON.stringify(report.capabilities));
  await check("startup and isolation", async () => {
    await navigate(); await ready();
    assert.equal(await js("return crossOriginIsolated && typeof SharedArrayBuffer === 'function'"), true);
    await repl('print("native-start", 6 * 7)'); await output("native-start 42");
  });
  await check("short viewport minimum working heights", async () => {
    await call("/window/rect", { width: 1280, height: 680 });
    await until(`(() => {
      const lines = id => { const el=document.querySelector(id), css=getComputedStyle(el); return (el.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom))/parseFloat(css.lineHeight); };
      return lines("#code-editor") >= 10 && lines("#terminal") >= 6;
    })()`, "minimum code and REPL lines");
    assert.equal(await js("return document.documentElement.scrollWidth <= innerWidth"), true);
    report.viewport = await js("return { width: innerWidth, height: innerHeight }");
  });
  await check("view switching preserves code, draft and runtime", async () => {
    await repl("pane_marker = 73"); await ready();
    await fill("#code-editor", 'print("pane-retained")');
    await fill("#repl-input", "pane_marker + 1");
    await click('[data-workspace-view-button="editor"]');
    assert.equal(await js('return getComputedStyle(document.querySelector("#terminal-shell")).display'), "none");
    await click("#run-script-button"); await ready();
    await click('[data-workspace-view-button="repl"]');
    await output("pane-retained");
    assert.equal(await value("#repl-input"), "pane_marker + 1");
    await click("#send-button"); await output("74"); await ready();
    await click('[data-workspace-view-button="normal"]');
    assert.equal(await value("#code-editor"), 'print("pane-retained")');
    await navigate(); await ready();
    assert.equal(await js('return document.querySelector("#workspace").dataset.workspaceView'), "normal");
  });
  await check("sticky Stop remains available and recovers a running Worker", async () => {
    await run('while True: pass');
    await until('document.querySelector("#status-indicator").dataset.status === "executing"', "executing");
    await js('window.scrollTo(0,document.querySelector("#workspace").getBoundingClientRect().top + scrollY + 150)');
    await until('(() => {const r=document.querySelector("#stop-button").getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight;})()', "sticky Stop visible");
    await click("#stop-button");
    await until('document.querySelector("#status-indicator").dataset.status === "stopped"', "stopped");
    await click("#restart-button"); await ready();
  });
  await check("live ADC shared input", async () => {
    await rangeEnd(adc, false); assert.equal(await value(adc), "0");
    await run('from machine import ADC, Pin\npot = ADC(Pin(26))\nprint("adc-wait", pot.read_u16())\nwhile pot.read_u16() < 60000:\n    pass\nprint("adc-live", pot.read_u16())');
    await output("adc-wait 0"); await rangeEnd(adc, true); await output("adc-live 65535"); await ready();
  });
  await check("live GPIO shared input", async () => {
    const selector = '[data-device-instance="button-gp15"] [data-device-component="press"] button';
    await js('document.querySelector(arguments[0]).scrollIntoView({block:"center"})', selector);
    const button = await element(selector);
    await run('from machine import Pin\nbutton = Pin(15, Pin.IN, Pin.PULL_UP)\nprint("gpio-wait")\nwhile button.value():\n    pass\nprint("gpio-live", button.value())');
    await output("gpio-wait");
    await call("/actions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", duration: 0, origin: { "element-6066-11e4-a52e-4f735466cecf": button }, x: 0, y: 0 },
      { type: "pointerDown", button: 0 },
    ] }] });
    try { await output("gpio-live 0"); } finally { await call("/actions", undefined, "DELETE"); }
    await ready();
  });
  await check("soft reset clears globals and LED, preserves source and ADC", async () => {
    const source = 'from machine import Pin\nreset_marker = 123\nPin("LED", Pin.OUT).on()';
    await run(source);
    await until(`document.querySelector(${JSON.stringify(led)}).textContent === "点灯"`, "LED on");
    await ready();
    await js('document.querySelector("#terminal-direct-input").focus()');
    await keys([{ type: "keyDown", value: "\uE009" }, { type: "keyDown", value: "d" }, { type: "keyUp", value: "d" }, { type: "keyUp", value: "\uE009" }]);
    await output("ソフトリセット"); await ready();
    assert.equal(await value("#code-editor"), source); assert.equal(await text(led), "消灯");
    await repl('from machine import ADC, Pin; print("reset-check", "reset_marker" in globals(), ADC(Pin(26)).read_u16())');
    await output("reset-check False 65535"); assert.equal(await value(adc), "65535");
  });
  await check("UART input reaches a running Worker", async () => {
    // Use the declared input control, not a direct call into the device model.
    await fill('[data-device-instance="gt-502mgg-n"] input[aria-label="互換UART受信文字列"]', "native-uart");
    await run('from machine import UART, Pin\nuart = UART(0, 115200, tx=Pin(0), rx=Pin(1))\nprint("uart-wait")\nwhile not uart.any():\n    pass\nprint("uart-live", uart.read())');
    await output("uart-wait");
    const button = await js('return [...document.querySelectorAll(\'[data-device-instance="gt-502mgg-n"] button\')].find(e => e.textContent === "UARTへ送信")');
    await call(`/element/${button["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
    await output("uart-live b'native-uart'"); await ready();
  });
  await check("BME280 UI inputs reach I2C measurements", async () => {
    const card = '[data-device-instance="ae-bme280-0x76"]';
    for (const component of ["temperature", "humidity", "pressure"]) {
      await rangeEnd(`${card} [data-device-component="${component}"] input`, true);
    }
    await click(`${card} [data-device-example]`);
    await click("#run-script-button");
    await output("Temperature: 85.0 C"); await output("Humidity: 100.0 %RH"); await output("Pressure: 1100.0 hPa"); await ready();
  });
  await check("Python and bridge errors remain usable", async () => {
    await run('raise ValueError("native-error-marker")'); await output("ValueError: native-error-marker"); await ready();
    await repl("from machine import Pin; Pin(25, Pin.OUT)"); await output("Unsupported Pico 2 W GPIO pin: 25");
    await repl('print("error-recovered", 42)'); await output("error-recovered 42");
  });
  await check("missing isolation shows disabled shared inputs", async () => {
    fixture.setFault("isolation"); await navigate(); await ready();
    assert.equal(await js("return crossOriginIsolated"), false);
    assert.equal(await js('return document.querySelector("#device-ui-input-status").dataset.state'), "unavailable");
    assert.equal(await js("return document.querySelector(arguments[0]).disabled", adc), true);
    await repl('print("fallback-repl", 42)'); await output("fallback-repl 42");
  });
  await check("WASM failure display and retry", async () => {
    fixture.setFault("wasm"); await navigate();
    await until('document.querySelector("#status-indicator").dataset.status === "error"', "WASM error");
    await output("[runtime error]"); assert.equal(await js('return document.querySelector("#run-script-button").disabled'), true);
    fixture.setFault("none"); await click("#restart-button"); await ready();
  });
  await check("repeated Worker failure display and retry", async () => {
    fixture.setFault("worker"); await navigate();
    await output("短時間に繰り返し失敗したため自動再生成を停止");
    fixture.setFault("none"); await click("#restart-button"); await ready();
    await repl('print("worker-recovered", 42)'); await output("worker-recovered 42");
  });
} catch (error) {
  report.error = error.message;
  if (session) report.failureState = await js('return {status:document.querySelector("#runtime-status")?.textContent, terminal:document.querySelector("#terminal")?.textContent, pressed:document.querySelector(\'[data-device-component="press"] button\')?.dataset.pressed}').catch(() => null);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (session) await call("", undefined, "DELETE").catch(() => {});
  await fixture.close();
  const reportPath = process.env.WEB_LAB_BROWSER_REPORT ?? `test-results/native-${browser}.json`;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
