import { describe, expect, it, vi } from "vitest";
import { dequeue, enqueue, MqttWire, packet, VirtualMqttBroker, type MqttConnection } from "./mqtt";
import { NETWORK_LIMITS } from "./contracts";

function connection(): MqttConnection { return { id: 1, clientId: "test", queue: [], queueBytes: 0, subscriptions: new Map(), external: true, closed: false }; }
class FakeSocket {
  readyState = 1; bufferedAmount = 0; protocol = "mqtt"; binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Uint8Array[] = [];
  send(bytes: Uint8Array): void { this.sent.push(bytes); }
  close(): void { this.readyState = 3; }
  receive(bytes: Uint8Array): void { this.onmessage?.({ data: bytes.slice().buffer }); }
}
async function transport() {
  const socket = new FakeSocket(), client = connection();
  const factory = vi.fn(() => socket as unknown as WebSocket);
  const wire = new MqttWire(client, "weblab/test/", () => {}, factory);
  const opening = wire.connect(60, 1000); socket.onopen?.();
  socket.receive(Uint8Array.of(0x20, 2)); socket.receive(Uint8Array.of(0, 0));
  await opening;
  return { socket, client, wire, factory };
}

describe("MQTT binary transport", () => {
  it("uses only the registered WSS URL and MQTT binary subprotocol", async () => {
    const { socket, wire, factory } = await transport();
    expect(factory).toHaveBeenCalledWith("wss://public.cloud.shiftr.io/", ["mqtt"]);
    expect(socket.binaryType).toBe("arraybuffer"); expect(socket.sent[0]![0]).toBe(0x10);
    wire.close(true); expect(socket.sent.at(-1)![0]).toBe(0xe0);
  });
  it("accepts split and coalesced packets and acknowledges QoS1 delivery", async () => {
    const { socket, wire, client } = await transport();
    const subscribing = wire.subscribe("weblab/test/#", 1, 1000);
    socket.receive(Uint8Array.of(0x90, 3, 0, 1, 1)); await subscribing;
    const publishing = wire.publish({ topic: "weblab/test/t", data: "34", qos: 1, retain: false }, 1000);
    socket.receive(Uint8Array.of(0x40, 2, 0, 2)); await publishing;
    const name = new TextEncoder().encode("weblab/test/t");
    const bytes = packet(0x32, [0, name.length, ...name, 0, 19, 52]);
    socket.receive(bytes.slice(0, 5)); expect(client.queue).toHaveLength(0);
    const tail = Uint8Array.from([...bytes.slice(5), 0xd0, 0]); socket.receive(tail);
    expect(dequeue(client)).toMatchObject({ topic: "weblab/test/t", data: "34", qos: 1 });
    expect(socket.sent.at(-1)).toEqual(Uint8Array.of(0x40, 2, 0, 19)); wire.close(false);
  });
  it("closes on invalid UTF8, malformed lengths, out-of-scope messages and text frames", async () => {
    for (const invalid of [Uint8Array.of(0x30, 0xff, 0xff, 0xff, 0xff), packet(0x30, [0, 1, 0xff]), packet(0x30, [0, 1, 120, 1])]) {
      const { socket, client } = await transport(); socket.receive(invalid); expect(client.closed).toBe(true);
    }
    const { socket, client } = await transport(); socket.onmessage?.({ data: "not binary" }); expect(client.closed).toBe(true);
  });
  it("expires acknowledgement waits and cancels timers", async () => {
    vi.useFakeTimers();
    try {
      const { wire, socket, client } = await transport();
      const waiting = wire.subscribe("weblab/test/#", 1, 100);
      const rejection = expect(waiting).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(101); await rejection;
      expect(client.closed).toBe(true); expect(socket.readyState).toBe(3); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("bounds receive queues even for tiny messages", () => {
    const c = connection();
    for (let i = 0; i < 256; i++) enqueue(c, { topic: "a", data: "", qos: 0, retain: false });
    expect(() => enqueue(c, { topic: "a", data: "", qos: 0, retain: false })).toThrow();
    expect(c.closed).toBe(true); expect(c.queueBytes).toBeLessThan(NETWORK_LIMITS.mqttQueue);
  });
  it("virtual retained replay and Last Will have distinct lifecycle semantics", () => {
    const broker = new VirtualMqttBroker(), sub = connection(), pub = connection();
    sub.external = pub.external = false;
    pub.will = { topic: "demo/status", data: "6f6666", qos: 1, retain: true };
    broker.connections.add(sub); broker.connections.add(pub); broker.subscribe(sub, "demo/#", 1);
    broker.close(pub, false); expect(dequeue(sub)?.data).toBe("6f6666");
    const late = connection(); late.external = false;
    broker.subscribe(late, "demo/#", 1); expect(dequeue(late)).toMatchObject({ retain: true, qos: 1 });
    broker.publish({ topic: "demo/status", data: "", qos: 0, retain: true }); expect(broker.retained.size).toBe(0);
    broker.reset();
  });
});
