import { expect, test } from "./workspace-test";
import { NETWORK_EXAMPLES } from "../src/network/examples";
const origin = `http://127.0.0.1:${process.env.WEB_LAB_E2E_PORT ?? 4173}`;

const WIFI = `import network,time
w=network.WLAN()
w.active(True)
w.connect('WebLab-Demo','demo-password')
while not w.isconnected():
 time.sleep_ms(10)
`;

test("virtual HTTP, MQTT and NTP run in the real restricted WASM without external requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", request => { if (!request.url().startsWith(origin)) external.push(request.url()); });
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(WIFI + `
import requests,ntptime,machine
with requests.get('http://weather.weblab.test/current') as r:
 print('weather-result',r.status_code,r.json()['temperature'])
from umqtt.simple import MQTTClient
c=MQTTClient('test','mqtt.weblab.test')
c.set_callback(lambda t,m: print('mqtt-result',t,m))
c.connect()
c.subscribe('demo/#',qos=1)
c.publish('demo/value',b'42',qos=1,retain=True)
c.check_msg()
c.disconnect()
ticks=time.ticks_ms()
ntptime.settime()
print('ntp-result',time.gmtime()[0],machine.RTC().datetime()[0])
print('ticks-result',time.ticks_diff(time.ticks_ms(),ticks)<5000)
`);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("weather-result 200 22.5");
  await expect(page.locator("#terminal")).toContainText("mqtt-result b'demo/value' b'42'");
  await expect(page.locator("#terminal")).toContainText("ntp-result 2026 2026");
  await expect(page.locator("#terminal")).toContainText("ticks-result True");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  expect(external).toEqual([]);
});

test("virtual HTTP server accepts a panel request and changes the LED", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(NETWORK_EXAMPLES["Virtual HTTP server"]!);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Use the virtual HTTP client");
  await page.locator("#network-panel > summary").click();
  await page.getByRole("button", { name: "仮想HTTP要求を送信", exact: true }).click();
  await expect(page.locator("#network-panel")).toContainText("LED on");
  await expect(page.locator('[data-device-instance="built-in-led"] output')).toHaveText("点灯");
  await page.locator("#stop-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await page.locator("#restart-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
});

test("NTP settings save in the project, failures preserve RTC, and no external NTP is used", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#network-panel > summary").click();
  await page.getByLabel("仮想NTP Unix秒", { exact: true }).fill("1893456000");
  await page.getByRole("button", { name: "設定を保存して適用", exact: true }).click();
  await expect(page.locator("#network-action-result")).toContainText("ネットワーク設定を保存しました。");
  await page.reload(); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(WIFI + "import ntptime\nntptime.settime()\nprint('saved-ntp',time.gmtime()[0])");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("saved-ntp 2030");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#network-panel").evaluate((panel: HTMLDetailsElement) => { panel.open = true; });
  await page.getByLabel("NTP障害", { exact: true }).selectOption("invalid");
  await page.getByRole("button", { name: "設定を保存して適用", exact: true }).click();
  await expect(page.getByRole("button", { name: "設定を保存して適用", exact: true })).toBeEnabled();
  await page.locator("#code-editor").fill("import ntptime,time\ntry:\n ntptime.settime()\nexcept OSError:\n print('ntp-failed',time.gmtime()[0])");
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("ntp-failed 2030");
});

test("ungranted HTTPS and arbitrary UDP remain blocked and edits revoke permissions", async ({ page }) => {
  const external: string[] = [];
  page.on("request", request => { if (request.url().startsWith("https:")) external.push(request.url()); });
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(WIFI + `
import requests,socket
try:
 requests.get('https://httpbin.org/get')
except OSError as e:
 print('permission-result',e.args[0])
try:
 socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
except NotImplementedError:
 print('udp-blocked')
`);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("permission-result 13");
  await expect(page.locator("#terminal")).toContainText("udp-blocked");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#network-panel > summary").click();
  const grant = page.locator('[data-network-grant="shiftr"]'); await grant.check(); await expect(grant).toBeChecked();
  await page.locator("#code-editor").fill("print('edited')"); await expect(grant).not.toBeChecked();
  expect(external).toEqual([]);
});

test("MQTT wait and infinite Python loops can be stopped and recreated", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(NETWORK_EXAMPLES["Virtual MQTT"]!);
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("Use the virtual MQTT panel");
  await page.locator("#stop-button").click(); await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await page.locator("#restart-button").click(); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill("while True:\n pass"); await page.locator("#run-script-button").click();
  await page.locator("#stop-button").click(); await expect(page.locator("#runtime-status")).toHaveText("停止中");
  await page.locator("#restart-button").click(); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
});

test("network adapters also work from the REPL", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#repl-input").fill("import network; print('network-repl',network.WLAN().active())");
  await page.locator("#send-button").click();
  await expect(page.locator("#terminal")).toContainText("network-repl False");
});

test("registered HTTPS goes through permission and returns the response to Python", async ({ page }) => {
  let posted = false;
  await page.route("https://httpbin.org/post", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" } }); return; }
    posted = true; expect(route.request().postDataJSON()).toEqual({ temperature: 22.5 });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"accepted":true}' });
  });
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(WIFI + "import requests\nwith requests.post('https://httpbin.org/post',json={'temperature':22.5}) as r:\n print('https-result',r.status_code,r.json()['accepted'])");
  await page.locator("#network-panel > summary").click(); await page.locator('[data-network-grant="httpbin"]').check();
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("https-result 200 True"); expect(posted).toBe(true);
});

test("registered WSS MQTT completes QoS1 subscribe and publish through the actual host and Python adapter", async ({ page }) => {
  // A controlled wire peer keeps automated tests independent of the public service.
  await page.addInitScript(() => {
    class BrokerPeer {
      readyState = 1; bufferedAmount = 0; binaryType = ""; protocol = "mqtt";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string, protocols: string[]) {
        if (url !== "wss://public.cloud.shiftr.io/" || protocols[0] !== "mqtt") throw new Error("Unregistered wire destination");
        queueMicrotask(() => this.onopen?.());
      }
      emit(bytes: number[]) { queueMicrotask(() => this.onmessage?.({ data: Uint8Array.from(bytes).buffer })); }
      send(bytes: Uint8Array) {
        const type = bytes[0]! >>> 4;
        let start = 1; while (bytes[start++]! & 128) { /* Remaining Length */ }
        if (type === 1) this.emit([0x20, 2, 0, 0]);
        else if (type === 8) this.emit([0x90, 3, bytes[start]!, bytes[start + 1]!, 1]);
        else if (type === 3) {
          const length = (bytes[start]! << 8) | bytes[start + 1]!;
          const identifier = start + 2 + length;
          this.emit([0x40, 2, bytes[identifier]!, bytes[identifier + 1]!]);
          this.emit([...bytes]);
        } else if (type === 12) this.emit([0xd0, 0]);
      }
      close() { this.readyState = 3; }
    }
    Object.defineProperty(window, "WebSocket", { value: BrokerPeer });
  });
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(WIFI + `
from umqtt.simple import MQTTClient
from weblab_network import topic_prefix
c=MQTTClient('wire-test','public.cloud.shiftr.io',port=8883,ssl=True,user='public',password='public')
c.set_callback(lambda t,m: print('wss-result',m))
c.connect()
c.subscribe(topic_prefix()+'#',qos=1)
c.publish(topic_prefix()+'test',b'42',qos=1)
c.wait_msg()
c.disconnect()
`);
  await page.locator("#network-panel > summary").click(); await page.locator('[data-network-grant="shiftr"]').check();
  await page.locator("#run-script-button").click();
  await expect(page.locator("#terminal")).toContainText("wss-result b'42'");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
});

test("debug execution can use networking", async ({ page }) => {
  await page.goto("/"); await expect(page.locator("#runtime-status")).toHaveText("実行可能");
  await page.locator("#code-editor").fill(WIFI + "import ntptime\nntptime.settime()\nprint('debug-network',time.gmtime()[0])");
  await page.locator("#debug-script-button").click();
  await expect(page.locator("#runtime-status")).toHaveText("デバッガ停止中");
  await page.locator("#debugger-command-input").fill("continue");
  await page.locator("#debugger-command-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator("#terminal")).toContainText("debug-network 2026");
  await expect(page.locator("#runtime-status")).toHaveText("実行可能");
});
