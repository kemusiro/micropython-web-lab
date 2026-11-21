import { fail, hex, integer, matches, NETWORK_LIMITS, NetworkError, topic, unhex, MQTT_WSS_URL } from "./contracts";

export interface MqttMessage { topic: string; data: string; qos: number; retain: boolean }
export interface MqttWill extends MqttMessage {}
export interface MqttConnection {
  id: number; clientId: string; subscriptions: Map<string, number>; queue: MqttMessage[];
  queueBytes: number; closed: boolean; will?: MqttWill; external: boolean; wire?: MqttWire;
}
export function enqueue(connection: MqttConnection, message: MqttMessage): void {
  const size = message.data.length / 2 + new TextEncoder().encode(message.topic).length + 8;
  if (connection.queueBytes + size > NETWORK_LIMITS.mqttQueue || connection.queue.length >= 256) {
    connection.closed = true;
    connection.wire?.close(false);
    throw new NetworkError(105, "MQTT receive queue exceeded; disconnected");
  }
  connection.queue.push({ ...message }); connection.queueBytes += size;
}
export function dequeue(connection: MqttConnection): MqttMessage | null {
  const message = connection.queue.shift();
  if (!message) return null;
  connection.queueBytes -= message.data.length / 2 + new TextEncoder().encode(message.topic).length + 8;
  return message;
}

/** An in-memory functional broker; it has no transport or browser dependencies. */
export class VirtualMqttBroker {
  readonly connections = new Set<MqttConnection>();
  readonly retained = new Map<string, MqttMessage>();
  duplicateQos1 = false;
  publish(message: MqttMessage): void {
    topic(message.topic); unhex(message.data, NETWORK_LIMITS.mqttPayload); integer(message.qos, 0, 1);
    if (message.retain) {
      if (message.data === "") this.retained.delete(message.topic);
      else {
        const size = [...this.retained.values()].filter(entry => entry.topic !== message.topic).reduce((n, entry) => n + entry.data.length / 2, 0);
        if ((!this.retained.has(message.topic) && this.retained.size >= 64) || size + message.data.length / 2 > 65536) fail("Retained message budget exceeded", 105);
        this.retained.set(message.topic, { ...message });
      }
    }
    for (const connection of this.connections) {
      if (connection.closed) continue;
      const levels = [...connection.subscriptions].filter(([filter]) => matches(filter, message.topic)).map(([, qos]) => qos);
      if (!levels.length) continue;
      const delivered = { ...message, retain: false, qos: Math.min(message.qos, Math.max(...levels)) };
      try {
        enqueue(connection, delivered);
        if (this.duplicateQos1 && delivered.qos === 1) enqueue(connection, delivered);
      } catch { this.close(connection, false); }
    }
  }
  subscribe(connection: MqttConnection, filter: string, qos: number): void {
    connection.subscriptions.set(topic(filter, true), integer(qos, 0, 1));
    for (const message of this.retained.values()) if (matches(filter, message.topic)) enqueue(connection, { ...message, qos: Math.min(qos, message.qos), retain: true });
  }
  close(connection: MqttConnection, graceful: boolean): void {
    const wasOpen = !connection.closed || this.connections.has(connection);
    connection.closed = true; this.connections.delete(connection);
    connection.queue.length = 0; connection.queueBytes = 0;
    if (wasOpen && !graceful && connection.will) {
      try { this.publish(connection.will); } catch { /* A full broker must not prevent host cleanup. */ }
    }
  }
  reset(): void { for (const c of [...this.connections]) this.close(c, true); this.retained.clear(); }
}

function u16(value: number): number[] { return [value >>> 8, value & 255]; }
function field(value: string | Uint8Array): number[] {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...u16(bytes.length), ...bytes];
}
export function packet(header: number, body: number[]): Uint8Array {
  let n = body.length;
  const length: number[] = [];
  do { let digit = n % 128; n = Math.floor(n / 128); if (n) digit |= 128; length.push(digit); } while (n);
  return Uint8Array.from([header, ...length, ...body]);
}

/** MQTT 3.1.1 binary transport. No arbitrary URL or credentials enter this class. */
export class MqttWire {
  #socket: WebSocket;
  #buffer = new Uint8Array();
  #pending = new Map<number, { expected: number; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #nextId = 1;
  #keepalive: ReturnType<typeof setInterval> | undefined;
  #pingAt = 0;
  #connectResolve: (() => void) | undefined;
  #connectReject: ((error: Error) => void) | undefined;
  #connectTimer: ReturnType<typeof setTimeout> | undefined;
  #connected = false;
  constructor(readonly connection: MqttConnection, readonly prefix: string,
    readonly changed: () => void, factory: (url: string, protocols: string[]) => WebSocket = (url, protocols) => new WebSocket(url, protocols)) {
    this.#socket = factory(MQTT_WSS_URL, ["mqtt"]);
    this.#socket.binaryType = "arraybuffer";
  }
  connect(keepalive: number, deadlineMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#connectResolve = resolve; this.#connectReject = reject;
      this.#connectTimer = setTimeout(() => this.#die(new NetworkError(110, "MQTT connection timed out")), deadlineMs);
      this.#socket.onopen = () => {
        try {
          if (this.#socket.protocol !== "mqtt") fail("MQTT subprotocol was not negotiated");
          const will = this.connection.will;
          let flags = 0xc2;
          if (will) flags |= 4 | (will.qos << 3) | (will.retain ? 32 : 0);
          const body = [...field("MQTT"), 4, flags, ...u16(keepalive), ...field(this.connection.clientId)];
          if (will) body.push(...field(will.topic), ...field(unhex(will.data, 4096)));
          body.push(...field("public"), ...field("public"));
          this.#send(packet(0x10, body));
          this.#keepalive = setInterval(() => {
            if (!this.#connected) return;
            if (this.#pingAt && performance.now() - this.#pingAt > keepalive * 1000) { this.#die(new NetworkError(110, "MQTT keepalive timed out")); return; }
            if (!this.#pingAt) { this.#pingAt = performance.now(); this.#send(packet(0xc0, [])); }
          }, keepalive * 500);
        } catch { this.#die(new NetworkError(5, "MQTT handshake failed")); }
      };
      this.#socket.onmessage = event => {
        try {
          if (!(event.data instanceof ArrayBuffer)) fail("MQTT requires binary frames");
          this.feed(new Uint8Array(event.data));
        } catch { this.#die(new NetworkError(71, "Invalid or oversized MQTT response")); }
      };
      this.#socket.onerror = () => this.#die(new NetworkError(5, "MQTT transport failed"));
      this.#socket.onclose = () => this.#die(new NetworkError(104, "MQTT connection closed"));
    });
  }
  feed(bytes: Uint8Array): void {
    if (bytes.length + this.#buffer.length > 65536) fail("MQTT packet buffer exceeded", 105);
    const combined = new Uint8Array(this.#buffer.length + bytes.length);
    combined.set(this.#buffer); combined.set(bytes, this.#buffer.length); this.#buffer = combined;
    while (this.#buffer.length >= 2) {
      let size = 0, multiplier = 1, i = 1, complete = false;
      for (; i < this.#buffer.length && i <= 4; i++) {
        const digit = this.#buffer[i]!; size += (digit & 127) * multiplier; multiplier *= 128;
        if (!(digit & 128)) { i++; complete = true; break; }
      }
      if (!complete) { if (i > 4) fail("Malformed MQTT length"); return; }
      if (size > 8192) fail("MQTT packet exceeds budget", 105);
      if (this.#buffer.length < i + size) return;
      const header = this.#buffer[0]!;
      const body = this.#buffer.slice(i, i + size);
      this.#buffer = this.#buffer.slice(i + size);
      this.#receive(header, body);
    }
  }
  #receive(header: number, body: Uint8Array): void {
    const type = header >>> 4;
    if (type === 2) {
      if (header !== 0x20 || body.length !== 2 || body[0] !== 0 || body[1] !== 0 || this.#connected) fail("MQTT CONNECT rejected");
      this.#connected = true; clearTimeout(this.#connectTimer); this.#connectResolve?.(); this.#connectResolve = undefined; return;
    }
    if (!this.#connected) fail("MQTT response before CONNACK");
    if (type === 3) {
      const qos = (header >>> 1) & 3;
      if (qos > 1 || body.length < 2) fail("Unsupported MQTT PUBLISH");
      const nameLength = (body[0]! << 8) | body[1]!;
      const offset = 2 + nameLength;
      if (!nameLength || offset + (qos ? 2 : 0) > body.length) fail("Truncated MQTT PUBLISH");
      const name = new TextDecoder("utf-8", { fatal: true }).decode(body.slice(2, offset));
      topic(name, false, true);
      if (!name.startsWith(this.prefix)) fail("MQTT topic outside granted scope", 13);
      const payload = body.slice(offset + (qos ? 2 : 0));
      if (payload.length > 4096) fail("MQTT payload exceeded", 105);
      if (qos && !(body[offset]! | body[offset + 1]!)) fail("Invalid MQTT packet identifier");
      enqueue(this.connection, { topic: name, data: hex(payload), qos, retain: Boolean(header & 1) });
      if (qos) this.#send(packet(0x40, [body[offset]!, body[offset + 1]!]));
      this.changed(); return;
    }
    if (type === 13) { if (header !== 0xd0 || body.length) fail("Invalid PINGRESP"); this.#pingAt = 0; return; }
    if (type === 4 || type === 9) {
      if (header !== (type << 4) || body.length !== (type === 4 ? 2 : 3)) fail("Invalid MQTT acknowledgement");
      const id = (body[0]! << 8) | body[1]!;
      const pending = this.#pending.get(id);
      if (!pending || pending.expected !== type || (type === 9 && body[2] !== 0 && body[2] !== 1)) fail("Unexpected MQTT acknowledgement");
      this.#pending.delete(id); clearTimeout(pending.timer); pending.resolve(); return;
    }
    fail("Unexpected MQTT packet");
  }
  #send(bytes: Uint8Array): void {
    if (this.#socket.readyState !== 1 || this.#socket.bufferedAmount + bytes.length > 65536) fail("MQTT transport unavailable or full", 105);
    this.#socket.send(bytes as Uint8Array<ArrayBuffer>);
  }
  #ack(type: number, send: (id: number) => void, deadlineMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = this.#nextId; this.#nextId = id === 65535 ? 1 : id + 1;
      const timer = setTimeout(() => this.#die(new NetworkError(110, "MQTT acknowledgement timed out")), deadlineMs);
      this.#pending.set(id, { expected: type, resolve, reject, timer });
      try { send(id); } catch { this.#die(new NetworkError(5, "MQTT send failed")); }
    });
  }
  publish(message: MqttMessage, deadlineMs: number): Promise<void> {
    const make = (id?: number) => packet(0x30 | (message.qos << 1) | (message.retain ? 1 : 0),
      [...field(message.topic), ...(id === undefined ? [] : u16(id)), ...unhex(message.data, 4096)]);
    if (message.qos) return this.#ack(4, id => this.#send(make(id)), deadlineMs);
    this.#send(make()); return Promise.resolve();
  }
  subscribe(filter: string, qos: number, deadlineMs: number): Promise<void> {
    return this.#ack(9, id => this.#send(packet(0x82, [...u16(id), ...field(filter), qos])), deadlineMs);
  }
  ping(): void { this.#pingAt = performance.now(); this.#send(packet(0xc0, [])); }
  close(graceful: boolean): void {
    try {
      if (graceful && this.#connected && this.#socket.readyState === 1) this.#send(packet(0xe0, []));
    } finally { this.#die(new NetworkError(104, "MQTT connection closed")); }
  }
  #die(error: Error): void {
    this.connection.closed = true; this.#connected = false;
    clearTimeout(this.#connectTimer); clearInterval(this.#keepalive);
    this.#connectReject?.(error); this.#connectReject = undefined;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
    this.#socket.onopen = this.#socket.onmessage = this.#socket.onclose = this.#socket.onerror = null;
    this.#socket.close(); this.changed();
  }
}
