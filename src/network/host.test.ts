import { describe, expect, it, vi } from "vitest";
import { NetworkHost } from "./host";
import { DEFAULT_NETWORK_SETTINGS, hex, matches, validateSettings } from "./contracts";
import { readNetworkSettings } from "./project-settings";

async function call(host: NetworkHost, op: string, args: Record<string, unknown> = {}) {
  return JSON.parse(await host.dispatch(JSON.stringify({ version: 1, op, args })));
}
async function connected(options = {}) {
  const host = new NetworkHost(options);
  host.configure({ ...DEFAULT_NETWORK_SETTINGS, connectDelayMs: 0 });
  await call(host, "wifi.active", { value: true });
  await call(host, "wifi.connect", { ssid: "WebLab-Demo", key: "demo-password" });
  return host;
}
const mqttConfig = (clientId = "test") => ({ clientId, server: "mqtt.weblab.test", port: 0, user: null, password: null, keepalive: 60, ssl: false, clean: true, timeout: 1, will: null });

describe("trusted network host", () => {
  it("validates settings, protocol and malformed inputs", async () => {
    expect(() => validateSettings({ ...DEFAULT_NETWORK_SETTINGS, extra: true })).toThrow();
    expect(() => readNetworkSettings({ version: 1, entries: [{ kind: "file", path: ".weblab-network.json", data: new TextEncoder().encode('{"version":99}') }] })).toThrow();
    const host = new NetworkHost();
    expect(JSON.parse(await host.dispatch('{"version":2,"op":"clock.get","args":{}}')).ok).toBe(false);
    expect(JSON.parse(await host.dispatch("{" )).ok).toBe(false);
    expect((await call(host, "fetch", { url: "https://evil.invalid" })).ok).toBe(false);
  });
  it("reproduces RP2 connection retries and has deterministic virtual time", async () => {
    let now = 0;
    const host = new NetworkHost({ now: () => now });
    await call(host, "wifi.active", { value: true });
    await call(host, "wifi.connect", { ssid: "WebLab-Demo", key: "wrong" }); now = 1000;
    expect((await call(host, "wifi.status")).value).toBe(1);
    await call(host, "wifi.connect", { ssid: "WebLab-Demo", key: "demo-password" }); now = 1200;
    expect((await call(host, "wifi.connected")).value).toBe(true);
    host.configure({ ...host.settings, apPresent: false });
    expect((await call(host, "wifi.connected")).value).toBe(false);
  });
  it("virtual HTTP and NTP never call fetch or WebSocket", async () => {
    const fetcher = vi.fn(), webSocket = vi.fn();
    const host = await connected({ fetch: fetcher, webSocket });
    const response = await call(host, "http", { method: "GET", url: "http://weather.weblab.test/current", timeout: 1 });
    expect(response.value.status).toBe(200);
    expect((await call(host, "ntp", { host: "pool.ntp.org", timeout: 1 })).value).toBe(1767225600);
    expect((await call(host, "ntp", { host: "attacker.invalid", timeout: 1 })).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled(); expect(webSocket).not.toHaveBeenCalled();
  });
  it("clock changes never affect the monotonic clock", async () => {
    let now = 0;
    const host = new NetworkHost({ now: () => now, wallNow: () => 2000000000000 });
    await call(host, "clock.set", { unix: 1893456000 }); now = 2000;
    expect((await call(host, "clock.get")).value).toBe(1893456002); expect(now).toBe(2000);
  });
  it("rejects unauthorized, local, redirect and header escape attempts before fetching", async () => {
    const fetcher = vi.fn(); const host = await connected({ fetch: fetcher });
    for (const url of ["https://httpbin.org/get", "http://127.0.0.1/", "https://localhost/", "https://httpbin.org.evil.invalid/get", "https://httpbin.org/redirect/1", "https://user:secret@httpbin.org/get", "https://httpbin.org/get?secret=x", "https://httpbin.org:8443/get"]) {
      expect((await call(host, "http", { method: "GET", url })).ok).toBe(false);
    }
    host.grant("httpbin", true);
    expect((await call(host, "http", { method: "GET", url: "https://httpbin.org/get", headers: { Cookie: "secret" } })).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses exact HTTPS transport policy, bounds bodies, and keeps rates across resets", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options: unknown) => new Response('{"ok":true}', { headers: { "content-type": "application/json", "set-cookie": "secret" } }));
    const host = await connected({ fetch: fetcher }); host.grant("httpbin", true);
    const args = { method: "POST", url: "https://httpbin.org/post", data: hex(new TextEncoder().encode("demo")) };
    const result = await call(host, "http", args);
    expect(result.ok).toBe(true); expect(result.value.headers["set-cookie"]).toBeUndefined();
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: "omit", redirect: "error", mode: "cors", referrerPolicy: "no-referrer" });
    for (let i = 1; i < 30; i++) await call(host, "http", args);
    host.resetSession();
    await call(host, "wifi.active", { value: true }); await call(host, "wifi.connect", { ssid: "WebLab-Demo", key: "demo-password" }); host.grant("httpbin", true);
    expect((await call(host, "http", args)).code).toBe(105); expect(fetcher).toHaveBeenCalledTimes(30);
    expect(JSON.stringify(host.history)).not.toContain("secret"); expect(JSON.stringify(host.history)).not.toContain("demo");
  });
  it("rejects oversized and endless HTTPS response streams", async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(32768)); }, cancel })));
    const host = await connected({ fetch: fetcher }); host.grant("httpbin", true);
    expect((await call(host, "http", { method: "GET", url: "https://httpbin.org/get" })).code).toBe(105);
    expect(cancel).toHaveBeenCalled();
  });
  it("has virtual socket stream, EOF, capacity and timeout semantics", async () => {
    const host = await connected();
    const listener = (await call(host, "socket.open")).value;
    await call(host, "socket.bind", { id: listener, host: "0.0.0.0", port: 8080 }); await call(host, "socket.listen", { id: listener });
    const client = (await call(host, "socket.open")).value;
    await call(host, "socket.connect", { id: client, host: "192.0.2.2", port: 8080 });
    const [server] = (await call(host, "socket.accept", { id: listener, timeout: 1 })).value;
    await call(host, "socket.send", { id: client, data: "616263" });
    expect((await call(host, "socket.recv", { id: server, size: 2, timeout: 1 })).value).toBe("6162");
    expect((await call(host, "socket.recv", { id: server, size: 2, timeout: 1 })).value).toBe("63");
    expect((await call(host, "socket.recv", { id: server, size: 2, timeout: 0 })).code).toBe(11);
    await call(host, "socket.close", { id: client });
    expect((await call(host, "socket.recv", { id: server, size: 2, timeout: 1 })).value).toBe("");
  });
  it("virtual HTTP client and Python server peer can progress independently", async () => {
    const host = await connected();
    const listener = (await call(host, "socket.open")).value;
    await call(host, "socket.bind", { id: listener, host: "0.0.0.0", port: 8080 }); await call(host, "socket.listen", { id: listener });
    const response = host.virtualHttpRequest(8080, "GET", "/on", "");
    const [server] = (await call(host, "socket.accept", { id: listener, timeout: 1 })).value;
    expect((await call(host, "socket.recv", { id: server, size: 512, timeout: 1 })).value).toContain("2f6f6e");
    await call(host, "socket.send", { id: server, data: hex(new TextEncoder().encode("HTTP/1.0 200 OK\r\n\r\nLED on")) });
    await call(host, "socket.close", { id: server }); expect(await response).toContain("LED on");
  });
  it("virtual MQTT supports wildcard, retain, duplicate QoS1 and abnormal Will", async () => {
    const host = await connected();
    const listener = (await call(host, "mqtt.connect", mqttConfig("subscriber"))).value;
    await call(host, "mqtt.subscribe", { id: listener, topic: "demo/#", qos: 1 });
    host.configure({ ...host.settings, duplicateQos1: true });
    const pub = (await call(host, "mqtt.connect", { ...mqttConfig("publisher"), will: { topic: "demo/status", data: "6f6666", qos: 1, retain: false } })).value;
    await call(host, "mqtt.publish", { id: pub, topic: "demo/t", data: "3232", qos: 1, retain: true });
    expect((await call(host, "mqtt.receive", { id: listener, wait: false })).value).toMatchObject({ topic: "demo/t", qos: 1, retain: false });
    expect((await call(host, "mqtt.receive", { id: listener, wait: false })).value.topic).toBe("demo/t");
    expect(host.broker.retained.size).toBe(1);
    host.resetSession(); expect(host.broker.retained.size).toBe(1);
    host.resetExperiment(); expect(host.broker.retained.size).toBe(0);
  });
  it("blocks arbitrary MQTT destinations and out-of-scope Will before opening WebSocket", async () => {
    const webSocket = vi.fn(); const host = await connected({ webSocket }); host.grant("shiftr", true);
    const config = { ...mqttConfig(), server: "public.cloud.shiftr.io", port: 8883, ssl: true, user: "public", password: "public" };
    expect((await call(host, "mqtt.connect", { ...config, server: "127.0.0.1" })).ok).toBe(false);
    expect((await call(host, "mqtt.connect", { ...config, will: { topic: "others/control", data: "", qos: 0, retain: false } })).code).toBe(13);
    expect(webSocket).not.toHaveBeenCalled();
  });
  it("cancels waits when the host session is revoked", async () => {
    const host = await connected(); const c = (await call(host, "mqtt.connect", mqttConfig())).value;
    const waiting = call(host, "mqtt.receive", { id: c, wait: true }); host.revoke();
    expect((await waiting).code).toBe(125);
  });
  it("matches MQTT wildcard boundaries", () => {
    expect(matches("a/#", "a")).toBe(true); expect(matches("a/+", "a/")).toBe(true);
    expect(matches("a/+", "a")).toBe(false); expect(matches("a/+", "a/b/c")).toBe(false);
  });
});
