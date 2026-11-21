import { DEFAULT_NETWORK_SETTINGS, fail, hex, integer, matches, MQTT_SERVER, NETWORK_LIMITS, NETWORK_REQUEST_BYTES,
  NetworkError, record, text, timeout, topic, unhex, validateSettings, VIRTUAL_MQTT_SERVER,
  type NetworkSettings, type NetworkHistory } from "./contracts";
import { dequeue, MqttWire, VirtualMqttBroker, type MqttConnection, type MqttMessage, type MqttWill } from "./mqtt";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VIRTUAL_HOSTS = new Map([["weather.weblab.test", "192.0.2.10"], ["echo.weblab.test", "192.0.2.11"], ["fault.weblab.test", "192.0.2.12"], [VIRTUAL_MQTT_SERVER, "192.0.2.13"], ["pico.weblab.test", "192.0.2.2"]]);
type SocketState = { id: number; queue: Uint8Array; peer?: SocketState; eof: boolean; closed: boolean;
  port?: number; listening: boolean; pending: number[]; fixture?: string; request: Uint8Array; processing: boolean };
export interface HttpResult { status: number; headers: Record<string, string>; data: string }
export interface NetworkHostOptions {
  now?: () => number; wallNow?: () => number;
  fetch?: typeof fetch; webSocket?: (url: string, protocols: string[]) => WebSocket;
}

/** Trusted host: permission, clocks and budgets remain outside the disposable Python Worker. */
export class NetworkHost {
  settings = { ...DEFAULT_NETWORK_SETTINGS };
  readonly broker = new VirtualMqttBroker();
  readonly history: NetworkHistory[] = [];
  readonly topicPrefix: string;
  readonly mqtt = new Map<number, MqttConnection>();
  readonly #sockets = new Map<number, SocketState>();
  readonly #controllers = new Set<AbortController>();
  readonly #listeners = new Set<() => void>();
  readonly #now: () => number;
  readonly #wallNow: () => number;
  readonly #fetch: typeof fetch;
  readonly #webSocket: NetworkHostOptions["webSocket"];
  #grants = new Set<string>();
  #generation = 0;
  #nextId = 1;
  #historySequence = 0;
  #httpAttempts: number[] = [];
  #mqttAttempts: number[] = [];
  #mqttSends: number[] = [];
  #active = false;
  #connected = false;
  #connectingAt: number | null = null;
  #credentialsMatch = false;
  #rtcBase = 1767225600;
  #rtcStarted = 0;
  #httpInFlight = 0;

  constructor(options: NetworkHostOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#wallNow = options.wallNow ?? (() => Date.now());
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    this.#webSocket = options.webSocket;
    this.topicPrefix = `weblab/${hex(crypto.getRandomValues(new Uint8Array(8)))}/`;
    this.#rtcStarted = this.#now();
  }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #changed(): void { for (const listener of this.#listeners) listener(); }
  get granted(): readonly string[] { return [...this.#grants]; }
  get connected(): boolean { this.#updateWifi(); return this.#connected; }
  get active(): boolean { return this.#active; }
  get virtualSockets(): number { return this.#sockets.size; }
  grant(service: string, enabled: boolean): void {
    if (!["httpbin", "open-meteo", "shiftr"].includes(service)) fail("Unknown registered service");
    if (enabled) this.#grants.add(service);
    else { this.#grants.delete(service); this.#cancelConnections(); }
    this.#changed();
  }
  revoke(): void { this.#grants.clear(); this.#cancelConnections(); this.#changed(); }
  resetSession(): void {
    this.revoke(); this.#active = false; this.#connected = false; this.#connectingAt = null;
    this.#rtcBase = this.settings.ntpUnixSeconds; this.#rtcStarted = this.#now(); this.#changed();
  }
  resetExperiment(): void { this.resetSession(); this.broker.reset(); this.history.length = 0; this.#changed(); }
  configure(settings: NetworkSettings): void {
    const old = this.settings;
    this.settings = validateSettings(settings); this.broker.duplicateQos1 = this.settings.duplicateQos1;
    if ((!this.settings.apPresent && this.#connected) || old.ssid !== this.settings.ssid || old.key !== this.settings.key) this.disconnectWifi();
    this.#changed();
  }
  disconnectWifi(): void { this.#connected = false; this.#connectingAt = null; this.#cancelConnections(); this.#changed(); }
  #cancelConnections(): void {
    this.#generation++;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    for (const connection of this.mqtt.values()) this.#closeMqtt(connection, false);
    this.mqtt.clear();
    for (const socket of this.#sockets.values()) this.#closeSocket(socket);
    this.#sockets.clear();
  }
  #updateWifi(): void {
    if (this.#active && this.settings.apPresent && this.#credentialsMatch && this.#connectingAt !== null && this.#now() >= this.#connectingAt) {
      this.#connected = true; this.#connectingAt = null;
    }
  }
  #requireWifi(): void { if (!this.connected) fail("Virtual WiFi is not connected", 100); }
  #requireGrant(service: string): void { if (!this.#grants.has(service)) fail("External service is not permitted", 13); }
  #budget(list: number[], count: number, windowMs: number): void {
    const now = this.#now(); while (list.length && list[0]! <= now - windowMs) list.shift();
    if (list.length >= count) fail("Network rate limit exceeded", 105); list.push(now);
  }
  #log(service: string, operation: string, result: string, bytes = 0, started = this.#now()): void {
    this.history.push({ sequence: ++this.#historySequence, service, operation, result, bytes, durationMs: Math.max(0, Math.round(this.#now() - started)) });
    if (this.history.length > NETWORK_LIMITS.history) this.history.shift(); this.#changed();
  }
  async #wait<T>(predicate: () => T | undefined, deadlineMs: number | null): Promise<T> {
    const generation = this.#generation, started = this.#now();
    for (;;) {
      if (generation !== this.#generation) fail("Network operation cancelled", 125);
      const value = predicate(); if (value !== undefined) return value;
      if (deadlineMs !== null && this.#now() - started >= deadlineMs) fail(deadlineMs === 0 ? "Network operation would block" : "Network operation timed out", deadlineMs === 0 ? 11 : 110);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  async #delay(ms: number, limit: number): Promise<void> {
    const end = this.#now() + ms;
    await this.#wait(() => this.#now() >= end ? true : undefined, limit);
  }

  async dispatch(encoded: string): Promise<string> {
    try {
      if (encoder.encode(encoded).length > NETWORK_REQUEST_BYTES) fail("Network request exceeds budget", 105);
      const request = record(JSON.parse(encoded));
      if (Object.keys(request).sort().join() !== "args,op,version" || request.version !== 1) fail("Invalid network protocol");
      const op = text(request.op, 40), a = record(request.args);
      const value = await this.#operate(op, a);
      return JSON.stringify({ ok: true, value: value === undefined ? null : value });
    } catch (error) {
      const code = error instanceof NetworkError ? error.code : 5;
      // Never include an untrusted URL, payload or browser error in the protocol/log.
      const message = error instanceof NetworkError ? error.message : "Network operation failed";
      return JSON.stringify({ ok: false, code, message });
    }
  }
  async #operate(op: string, a: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case "experiment.info": return this.topicPrefix;
      case "wifi.active":
        if (a.value !== undefined) {
          if (typeof a.value !== "boolean") fail("Expected boolean");
          this.#active = a.value; if (!a.value) this.disconnectWifi(); this.#changed();
        }
        return this.#active;
      case "wifi.connect":
        if (!this.#active) fail("WiFi is inactive", 100);
        this.disconnectWifi();
        this.#credentialsMatch = text(a.ssid, 32) === this.settings.ssid && text(a.key, 64) === this.settings.key;
        this.#connectingAt = this.#now() + this.settings.connectDelayMs; this.#changed(); return null;
      case "wifi.disconnect": this.disconnectWifi(); return null;
      case "wifi.status": return this.connected ? 3 : this.#connectingAt !== null ? 1 : 0;
      case "wifi.connected": return this.connected;
      case "wifi.scan":
        if (!this.#active) fail("WiFi is inactive", 100);
        return this.settings.apPresent ? [[this.settings.ssid, "020000000001", 6, this.settings.rssi, 3, 0]] : [];
      case "wifi.config":
        if (a.key === "mac") return "020000000002";
        if (a.key === "ssid") return this.connected ? this.settings.ssid : "";
        if (a.key === "rssi") { this.#requireWifi(); return this.settings.rssi; }
        fail("Unsupported WiFi configuration");
      case "wifi.ip": return [this.connected ? "192.0.2.2" : "0.0.0.0", "255.255.255.0", "192.0.2.1", "192.0.2.1"];
      case "http": return this.http(a);
      case "ntp": {
        this.#requireWifi();
        const host = text(a.host, 128);
        if (!["pool.ntp.org", "ntp.weblab.test"].includes(host)) fail("Unknown virtual NTP host", 2);
        const ms = timeout(a.timeout, 1), started = this.#now();
        await this.#delay(this.settings.ntpFault === "timeout" ? ms + 1000 : this.settings.ntpDelayMs, ms);
        if (this.settings.ntpFault === "invalid") fail("Invalid virtual NTP response", 71);
        this.#log("virtual-ntp", "time", "ok", 48, started);
        return Math.floor(this.settings.ntpSource === "pc" ? this.#wallNow() / 1000 : this.settings.ntpUnixSeconds);
      }
      case "clock.get": return this.#rtcBase + (this.#now() - this.#rtcStarted) / 1000;
      case "clock.set": this.#rtcBase = integer(a.unix, 0, 7258118400); this.#rtcStarted = this.#now(); return null;
      case "dns": {
        this.#requireWifi(); const name = text(a.host, 128);
        const ip = VIRTUAL_HOSTS.get(name) ?? ([...VIRTUAL_HOSTS.values(), "0.0.0.0", "127.0.0.1"].includes(name) ? name : undefined);
        if (!ip) fail("Unknown virtual host", 2); return ip;
      }
      case "socket.open": return this.#newSocket().id;
      case "socket.bind": {
        this.#requireWifi(); const socket = this.#socket(a.id); const port = integer(a.port, 1, 65535);
        if (!["0.0.0.0", "192.0.2.2", "127.0.0.1", ""].includes(text(a.host))) fail("Virtual bind address only");
        if (socket.port !== undefined || [...this.#sockets.values()].some(s => s.port === port && !s.closed)) fail("Address in use", 98);
        socket.port = port; return null;
      }
      case "socket.listen": { const socket = this.#socket(a.id); if (socket.port === undefined) fail("Bind first"); socket.listening = true; return null; }
      case "socket.connect": {
        this.#requireWifi(); const socket = this.#socket(a.id), port = integer(a.port, 1, 65535), host = text(a.host, 128);
        if (socket.peer || socket.fixture || socket.listening) fail("Socket already connected");
        const name = [...VIRTUAL_HOSTS].find(([name, ip]) => name === host || ip === host)?.[0];
        if (["weather.weblab.test", "echo.weblab.test", "fault.weblab.test"].includes(name ?? "") && port === 80) { socket.fixture = name; return null; }
        if (!["pico.weblab.test", "192.0.2.2", "127.0.0.1"].includes(host)) fail("Virtual connections only", 13);
        const listener = [...this.#sockets.values()].find(s => s.listening && s.port === port && !s.closed);
        if (!listener || listener.pending.length >= 2) fail("Connection refused", 111);
        const peer = this.#newSocket(); socket.peer = peer; peer.peer = socket; listener.pending.push(peer.id); this.#changed(); return null;
      }
      case "socket.accept": {
        const socket = this.#socket(a.id); if (!socket.listening) fail("Socket is not listening");
        return this.#wait(() => { this.#socket(a.id); const id = socket.pending.shift(); return id === undefined ? undefined : [id, ["192.0.2.3", 49152]]; }, a.timeout === null ? null : a.timeout === 0 ? 0 : timeout(a.timeout));
      }
      case "socket.send": {
        this.#requireWifi(); const socket = this.#socket(a.id), bytes = unhex(a.data, 8192);
        if (socket.fixture) {
          if (socket.processing) fail("One request per virtual HTTP connection");
          socket.request = this.#append(socket.request, bytes, 16384 + 8192);
          const requestText = decoder.decode(socket.request), boundary = requestText.indexOf("\r\n\r\n");
          if (boundary >= 0) {
            const header = requestText.slice(0, boundary);
            const length = Number(/\r\ncontent-length:\s*(\d+)/i.exec(header)?.[1] ?? 0);
            if (socket.request.length >= encoder.encode(requestText.slice(0, boundary + 4)).length + length) {
              socket.processing = true;
              const [method, path] = header.split("\r\n")[0]!.split(" ");
              const result = await this.http({ method, url: `http://${socket.fixture}${path}`, data: hex(encoder.encode(requestText.slice(boundary + 4))), headers: {}, timeout: a.timeout });
              const body = unhex(result.data, 65536);
              const bytes = encoder.encode(`HTTP/1.0 ${result.status} Response\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`);
              socket.queue = this.#append(bytes, body, 8192); socket.eof = true;
            }
          }
        } else {
          if (!socket.peer || socket.peer.closed) fail("Peer closed", 32);
          if (!bytes.length) return 0;
          return this.#wait(() => {
            this.#socket(a.id);
            if (socket.peer!.closed) fail("Peer closed", 32);
            const count = Math.min(bytes.length, 8192 - socket.peer!.queue.length);
            if (!count) return undefined;
            socket.peer!.queue = this.#append(socket.peer!.queue, bytes.slice(0, count), 8192);
            this.#changed(); return count;
          }, a.timeout === null ? null : a.timeout === 0 ? 0 : timeout(a.timeout));
        }
        this.#changed(); return bytes.length;
      }
      case "socket.recv": {
        this.#requireWifi(); const socket = this.#socket(a.id), size = integer(a.size, 0, 8192);
        if (!size) return "";
        return this.#wait(() => {
          this.#socket(a.id);
          if (socket.queue.length) { const bytes = socket.queue.slice(0, size); socket.queue = socket.queue.slice(bytes.length); return hex(bytes); }
          if (socket.eof || socket.peer?.closed) return "";
          return undefined;
        }, a.timeout === null ? null : a.timeout === 0 ? 0 : timeout(a.timeout));
      }
      case "socket.close": { const s = this.#sockets.get(integer(a.id, 1, Number.MAX_SAFE_INTEGER)); if (s) { this.#closeSocket(s); this.#sockets.delete(s.id); } this.#changed(); return null; }
      case "mqtt.connect": return this.#connectMqtt(a);
      case "mqtt.publish": {
        const c = this.#mqtt(a.id), message = this.#message(a, c.external); this.#requireWifi();
        if (c.external) { this.#requireGrant("shiftr"); this.#budget(this.#mqttSends, 10, 1000); await c.wire!.publish(message, timeout(a.timeout)); }
        else this.broker.publish(message);
        this.#log(c.external ? "shiftr" : "virtual-mqtt", "publish", "ok", message.data.length / 2); return null;
      }
      case "mqtt.subscribe": {
        const c = this.#mqtt(a.id); this.#requireWifi();
        const filter = topic(a.topic, true, c.external), qos = integer(a.qos, 0, 1);
        if (!c.subscriptions.has(filter) && c.subscriptions.size >= 8) fail("MQTT subscription limit", 105);
        if (c.external) { this.#requireGrant("shiftr"); this.#scope(filter); this.#budget(this.#mqttSends, 10, 1000); await c.wire!.subscribe(filter, qos, timeout(a.timeout)); c.subscriptions.set(filter, qos); }
        else this.broker.subscribe(c, filter, qos);
        this.#changed(); return null;
      }
      case "mqtt.receive": {
        const c = this.#mqtt(a.id); this.#requireWifi();
        if (typeof a.wait !== "boolean") fail("Invalid receive mode");
        if (!a.wait) return dequeue(c);
        return this.#wait(() => { if (c.closed) fail("MQTT disconnected", 104); return dequeue(c) ?? undefined; }, null);
      }
      case "mqtt.ping": { const c = this.#mqtt(a.id); this.#requireWifi(); if (c.external) { this.#requireGrant("shiftr"); this.#budget(this.#mqttSends, 10, 1000); } c.wire?.ping(); return null; }
      case "mqtt.close": { const c = this.mqtt.get(integer(a.id, 1, Number.MAX_SAFE_INTEGER)); if (c) this.#closeMqtt(c, true); return null; }
      default: fail("Unsupported network operation");
    }
  }

  #append(a: Uint8Array, b: Uint8Array, limit: number): Uint8Array {
    if (a.length + b.length > limit) fail("Network queue exceeded", 105);
    const result = new Uint8Array(a.length + b.length); result.set(a); result.set(b, a.length); return result;
  }
  #newSocket(): SocketState {
    if (this.#sockets.size >= 4) fail("Virtual socket limit", 24);
    const s: SocketState = { id: this.#nextId++, queue: new Uint8Array(), request: new Uint8Array(), eof: false, closed: false, listening: false, pending: [], processing: false };
    this.#sockets.set(s.id, s); return s;
  }
  #socket(id: unknown): SocketState { const s = this.#sockets.get(integer(id, 1, Number.MAX_SAFE_INTEGER)); if (!s || s.closed) fail("Socket is closed", 9); return s; }
  #closeSocket(socket: SocketState): void {
    socket.closed = true; socket.queue = new Uint8Array(); if (socket.peer) socket.peer.eof = true;
    for (const id of socket.pending) { const pending = this.#sockets.get(id); if (pending) { this.#closeSocket(pending); this.#sockets.delete(id); } }
    socket.pending.length = 0;
  }
  async http(a: Record<string, unknown>): Promise<HttpResult> {
    this.#requireWifi(); const started = this.#now();
    const method = text(a.method, 8); if (method !== "GET" && method !== "POST") fail("GET and POST only");
    const urlText = text(a.url), limit = timeout(a.timeout), body = unhex(a.data ?? "", 16384);
    if (method === "GET" && body.length) fail("GET cannot have a body");
    let url: URL; try { url = new URL(urlText); } catch { fail("Invalid absolute URL"); }
    if (url.username || url.password || url.hash) fail("URL credentials and fragments are not permitted", 13);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(record(a.headers ?? {}))) {
      const normalized = key.toLowerCase();
      if (!["accept", "content-type"].includes(normalized)) fail("Header is not permitted", 13);
      headers[normalized] = text(value, 256);
    }
    if (["weather.weblab.test", "echo.weblab.test", "fault.weblab.test"].includes(url.hostname) && url.protocol === "http:" && !url.port) {
      if (url.hostname === "fault.weblab.test" && url.pathname === "/timeout") await this.#delay(limit + 1000, limit);
      await this.#delay(this.settings.httpDelayMs, limit);
      let data: unknown, status = 200;
      if (url.hostname === "weather.weblab.test" && url.pathname === "/current" && method === "GET") data = { temperature: 22.5, humidity: 55, source: "virtual" };
      else if (url.hostname === "echo.weblab.test" && ["/post", "/get"].includes(url.pathname)) data = { method, data: decoder.decode(body), source: "virtual" };
      else if (url.hostname === "fault.weblab.test" && ["/status/404", "/status/500"].includes(url.pathname)) { status = Number(url.pathname.slice(-3)); data = { error: status }; }
      else if (url.hostname === "fault.weblab.test" && url.pathname === "/invalid-json") { this.#log("virtual-http", method, "200", 8, started); return { status: 200, headers: { "content-type": "application/json" }, data: hex(encoder.encode("not json")) }; }
      else { status = 404; data = { error: "Not found" }; }
      const bytes = encoder.encode(JSON.stringify(data)); this.#log("virtual-http", method, String(status), bytes.length, started);
      return { status, headers: { "content-type": "application/json" }, data: hex(bytes) };
    }
    if (url.protocol !== "https:" || url.port) fail("Only registered HTTPS services are allowed", 13);
    let service: string;
    if (url.hostname === "httpbin.org" && ((method === "GET" && ["/get", "/status/404", "/status/500"].includes(url.pathname)) || (method === "POST" && url.pathname === "/post")) && !url.search) service = "httpbin";
    else if (url.hostname === "api.open-meteo.com" && url.pathname === "/v1/forecast" && method === "GET") {
      const allowed = ["latitude", "longitude", "current", "forecast_days", "timezone"];
      for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) fail("Query parameter not permitted", 13);
      const lat = Number(url.searchParams.get("latitude")), lon = Number(url.searchParams.get("longitude"));
      if (!url.searchParams.has("latitude") || !url.searchParams.has("longitude") || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180 ||
        (url.searchParams.get("current") ?? "temperature_2m").split(",").some(v => !["temperature_2m", "relative_humidity_2m"].includes(v)) ||
        ![null, "1"].includes(url.searchParams.get("forecast_days")) || ![null, "UTC"].includes(url.searchParams.get("timezone"))) fail("Weather query not permitted", 13);
      service = "open-meteo";
    } else fail("Service or path is not registered", 13);
    this.#requireGrant(service); this.#budget(this.#httpAttempts, 30, 60000);
    if (this.#httpInFlight >= 2) fail("HTTP concurrency limit", 105);
    const controller = new AbortController(), generation = this.#generation;
    this.#controllers.add(controller); this.#httpInFlight++;
    const timer = setTimeout(() => controller.abort(), limit);
    try {
      const response = await this.#fetch(url.href, { method, headers, ...(method === "POST" ? { body: body as Uint8Array<ArrayBuffer> } : {}), mode: "cors", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal });
      const reader = response.body?.getReader(); let result: Uint8Array = new Uint8Array();
      if (reader) {
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; result = this.#append(result, chunk.value, 65536); } }
        catch (error) { await reader.cancel().catch(() => {}); throw error; }
      }
      if (generation !== this.#generation || controller.signal.aborted) fail("HTTP cancelled or timed out", 110);
      const responseHeaders: Record<string, string> = {};
      for (const name of ["content-type", "content-length", "cache-control"]) { const value = response.headers.get(name); if (value !== null && value.length <= 1024) responseHeaders[name] = value; }
      this.#log(service, method, String(response.status), result.length, started);
      return { status: response.status, headers: responseHeaders, data: hex(result) };
    } catch (error) {
      this.#log(service, method, "failed", 0, started);
      if (error instanceof NetworkError) throw error;
      fail(controller.signal.aborted ? "HTTP cancelled or timed out" : "HTTPS failed (network, TLS or CORS)", controller.signal.aborted ? 110 : 5);
    } finally { clearTimeout(timer); this.#controllers.delete(controller); this.#httpInFlight--; }
  }

  #scope(name: string): void { if (!name.startsWith(this.topicPrefix)) fail("MQTT topic is outside this experiment", 13); }
  #message(a: Record<string, unknown>, external: boolean): MqttMessage {
    const name = topic(a.topic, false, external); if (external) this.#scope(name);
    if (typeof a.retain !== "boolean") fail("Invalid retain flag");
    return { topic: name, data: hex(unhex(a.data, 4096)), qos: integer(a.qos, 0, 1), retain: a.retain };
  }
  #mqtt(id: unknown): MqttConnection {
    const c = this.mqtt.get(integer(id, 1, Number.MAX_SAFE_INTEGER)); if (!c || c.closed) fail("MQTT connection closed", 104); return c;
  }
  async #connectMqtt(a: Record<string, unknown>): Promise<number> {
    for (const c of this.mqtt.values()) if (c.closed) this.#closeMqtt(c, false);
    this.#requireWifi(); const host = text(a.server, 128), external = host === MQTT_SERVER;
    if (!external && host !== VIRTUAL_MQTT_SERVER) fail("MQTT broker is not registered", 13);
    if (a.clean !== true) fail("Only clean_session=True is supported");
    const clientId = text(a.clientId, 64); if (!clientId) fail("Client ID is required");
    const keepalive = integer(a.keepalive, 1, 300), deadline = timeout(a.timeout);
    if ([...this.mqtt.values()].filter(c => !c.closed).length >= 2) fail("MQTT connection limit", 24);
    if (external) {
      this.#requireGrant("shiftr"); this.#budget(this.#mqttAttempts, 6, 60000);
      if (a.ssl !== true || ![0, 8883].includes(Number(a.port)) || a.user !== "public" || a.password !== "public") fail("Use registered shiftr TLS/public credentials", 13);
    } else if (![0, 1883].includes(Number(a.port)) || a.ssl !== false || a.user !== null || a.password !== null) fail("Virtual broker uses no TLS or authentication");
    let will: MqttWill | undefined;
    if (a.will !== null) will = this.#message(record(a.will), external);
    const old = [...this.mqtt.values()].find(c => c.clientId === clientId && c.external === external && !c.closed);
    if (old) this.#closeMqtt(old, false);
    const c: MqttConnection = { id: this.#nextId++, clientId, subscriptions: new Map(), queue: [], queueBytes: 0, closed: false, external, will };
    this.mqtt.set(c.id, c);
    try {
      if (external) { c.wire = new MqttWire(c, this.topicPrefix, () => {
        if (c.closed) { c.queue.length = 0; c.queueBytes = 0; this.mqtt.delete(c.id); }
        this.#changed();
      }, this.#webSocket); await c.wire.connect(keepalive, deadline); }
      else this.broker.connections.add(c);
      this.#log(external ? "shiftr" : "virtual-mqtt", "connect", "ok"); return c.id;
    } catch (error) { this.#closeMqtt(c, false); throw error; }
  }
  #closeMqtt(c: MqttConnection, graceful: boolean): void {
    if (c.external) c.wire?.close(graceful); else this.broker.close(c, graceful);
    c.closed = true; c.queue.length = 0; c.queueBytes = 0; this.mqtt.delete(c.id); this.#changed();
  }
  publishVirtual(name: string, value: string, qos = 0, retain = false): void {
    const bytes = encoder.encode(value); if (bytes.length > 4096) fail("MQTT payload limit", 105);
    this.broker.publish({ topic: topic(name), data: hex(bytes), qos, retain }); this.#log("virtual-mqtt", "panel-publish", "ok", bytes.length);
  }
  /** UI acts as a virtual TCP peer, never a browser navigation or HTML renderer. */
  async virtualHttpRequest(port: number, method: string, path: string, body: string): Promise<string> {
    this.#requireWifi(); integer(port, 1, 65535); text(path, 512); text(method, 8);
    if (!["GET", "POST"].includes(method) || !path.startsWith("/")) fail("Invalid virtual HTTP request");
    const client = this.#newSocket();
    try {
      await this.#operate("socket.connect", { id: client.id, host: "192.0.2.2", port });
      const bytes = encoder.encode(`${method} ${path} HTTP/1.0\r\nHost: pico.weblab.test\r\nContent-Length: ${encoder.encode(body).length}\r\n\r\n${body}`);
      await this.#operate("socket.send", { id: client.id, data: hex(bytes) });
      let response = "";
      const started = this.#now();
      for (;;) {
        if (this.#now() - started >= 10000) fail("Virtual HTTP response timed out", 110);
        const part = await this.#operate("socket.recv", { id: client.id, size: 8192, timeout: Math.max(0.001, (10000 - (this.#now() - started)) / 1000) });
        if (part === "") return response;
        response += decoder.decode(unhex(part, 8192)); if (encoder.encode(response).length > 65536) fail("HTTP response limit", 105);
      }
    } finally { this.#closeSocket(client); this.#sockets.delete(client.id); }
  }
}
