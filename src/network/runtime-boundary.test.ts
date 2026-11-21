import { expect, it, vi } from "vitest";
import { RuntimeClient, type RuntimeWorker } from "../runtime/client";
import { isMainToWorkerMessage, isWorkerToMainMessage, RUNTIME_PROTOCOL_VERSION as version, type MainToWorkerMessage } from "../runtime/protocol";
import { NETWORK_CHANNEL_BYTES, NETWORK_REQUEST_BYTES } from "./contracts";

function worker(): RuntimeWorker & { sent: MainToWorkerMessage[] } {
  const sent: MainToWorkerMessage[] = [];
  return { sent, postMessage: message => sent.push(message), terminate: vi.fn(), onmessage: null, onmessageerror: null, onerror: null };
}
it("rejects invalid network messages and channel layouts", () => {
  const valid = { version, type: "network-request", requestId: 1, data: "{}" };
  expect(isWorkerToMainMessage(valid)).toBe(true);
  for (const invalid of [{ ...valid, version: version - 1 }, { ...valid, requestId: 0 }, { ...valid, data: "a".repeat(NETWORK_REQUEST_BYTES + 1) }, { ...valid, data: {} }]) expect(isWorkerToMainMessage(invalid)).toBe(false);
  expect(isMainToWorkerMessage({ version, type: "start", networkChannel: new SharedArrayBuffer(NETWORK_CHANNEL_BYTES) })).toBe(true);
  expect(isMainToWorkerMessage({ version, type: "start", networkChannel: new SharedArrayBuffer(4) })).toBe(false);
  expect(isMainToWorkerMessage({ version, type: "start", networkChannel: new ArrayBuffer(NETWORK_CHANNEL_BYTES) })).toBe(false);
});
it("never writes a delayed response into a replacement Worker channel", async () => {
  const first = worker(), second = worker();
  const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const client = new RuntimeClient({ onMessage: vi.fn(), onStatus: vi.fn() }, factory);
  let finish!: (value: string) => void;
  vi.spyOn(client.network, "dispatch").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  client.start();
  const initial = first.sent[0]; if (initial?.type !== "start") throw new Error("Missing start");
  client.network.grant("shiftr", true);
  const pending = first.onmessage?.({ data: { version, type: "network-request", requestId: 1, data: "{}" } } as MessageEvent);
  client.restart(); expect(client.network.granted).toEqual([]);
  const replacement = second.sent[0]; if (replacement?.type !== "start") throw new Error("Missing replacement");
  finish('{"ok":true,"value":1}'); await pending;
  expect(initial.networkChannel).not.toBe(replacement.networkChannel);
  expect(Atomics.load(new Int32Array(initial.networkChannel!), 0)).toBe(0);
  expect(Atomics.load(new Int32Array(replacement.networkChannel!), 0)).toBe(0);
  client.stop();
});
it("publishes bounded responses only for the next request number", async () => {
  const current = worker(), errors = vi.fn();
  const client = new RuntimeClient({ onMessage: errors, onStatus: vi.fn() }, () => current);
  client.start(); const start = current.sent[0]; if (start?.type !== "start") throw new Error("Missing start");
  await current.onmessage?.({ data: { version, type: "network-request", requestId: 1, data: '{"version":1,"op":"clock.get","args":{}}' } } as MessageEvent);
  const header = new Int32Array(start.networkChannel!, 0, 2);
  expect(header[0]).toBe(1);
  const response = JSON.parse(new TextDecoder().decode(new Uint8Array(start.networkChannel!, 8, header[1]!).slice()));
  expect(response.ok).toBe(true);
  await current.onmessage?.({ data: { version, type: "network-request", requestId: 1, data: "{}" } } as MessageEvent);
  expect(client.status).toBe("error"); expect(errors).toHaveBeenCalled(); client.stop();
});
