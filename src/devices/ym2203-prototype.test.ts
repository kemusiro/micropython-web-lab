import { describe, expect, it } from "vitest";
import { DeviceHost } from "../device-api/device-host";
import { createYm2203PrototypeDefinition } from "./ym2203-prototype";
import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE as board } from "../board/raspberry-pi-pico-2-w";
import type { YmCommand } from "../audio/ym2203-protocol";
import { MAX_YM_EVENTS } from "../audio/ym2203-protocol";

function fixture(reject = false) {
  const commands: YmCommand[] = [];
  const host = new DeviceHost({ profileId: board.id, profileVersion: board.version, capabilities: board.capabilities });
  host.create("sound", createYm2203PrototypeDefinition(command => { if (reject) throw new Error("transport full"); commands.push(command); }));
  return { host, commands, port: host.getPort("sound", "i2c", "i2c-target") };
}
describe("I2C sound module", () => {
  it("accepts 24-hour and unsigned high-bit times, and validates loop packets atomically", () => {
    const { port, commands } = fixture();
    const u32 = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
    port.write(Uint8Array.from([5, ...u32(0), 8, 11, ...u32(1000), 8, 0]));
    for (const loop of [0, 99, 999]) expect(() => port.write(Uint8Array.from([6, ...u32(86_400_000), ...u32(loop)]))).toThrow();
    expect(port.read(4)[1]).toBe(2); expect(commands).toEqual([]);
    port.write(Uint8Array.from([6, ...u32(86_400_000), ...u32(1000)]));
    expect(commands.at(-1)).toMatchObject({ action: "play", durationMs: 86_400_000, loopMs: 1000 });
    port.write(Uint8Array.from([5, ...u32(0x80000001), 8, 0]));
    port.write(Uint8Array.from([6, ...u32(0xFFFFFFFF)]));
    expect(commands.at(-1)).toEqual({ version: 1, action: "play", events: [0x80000001, 8, 0], durationMs: 0xFFFFFFFF });
    expect(port.read(4)).toEqual(Uint8Array.of(1, 0, 0, 50));
  });
  it("preserves repeated register writes and commits ordered reservations", () => {
    const { port, commands } = fixture();
    port.writeMemory(0x28, Uint8Array.of(0xF0));
    port.write(Uint8Array.of(0, 0x28, 0, 0x28, 0xF0));
    port.write(Uint8Array.of(1, 0, 0, 0x28, 0xF0, 100, 0, 0x28, 0));
    expect(port.read(4)).toEqual(Uint8Array.of(1, 2, 0, 50));
    port.write(Uint8Array.of(2, 200, 0));
    expect(commands).toEqual([
      { version: 1, action: "write", pairs: [0x28, 0xF0] },
      { version: 1, action: "write", pairs: [0x28, 0, 0x28, 0xF0] },
      { version: 1, action: "play", events: [0, 0x28, 0xF0, 100, 0x28, 0], durationMs: 200 },
    ]);
    expect(port.read(4)[1]).toBe(0);
  });
  it("rejects invalid packets, late events, too-short duration and excess capacity atomically", () => {
    const { port, commands } = fixture();
    for (const packet of [[], [0, 1], [1, 1, 0, 0], [4, 101], [255], [2, 0, 0]]) expect(() => port.write(Uint8Array.from(packet))).toThrow();
    port.write(Uint8Array.of(1, 100, 0, 0x28, 0));
    expect(() => port.write(Uint8Array.of(1, 0, 0, 0x28, 0))).toThrow();
    expect(() => port.write(Uint8Array.of(5, 1, 0, 0x28, 0))).toThrow();
    expect(() => port.write(Uint8Array.of(2, 99, 0))).toThrow();
    expect(port.read(4)[1]).toBe(1);
    expect(commands).toEqual([]);
    expect(() => port.writeMemory(0, Uint8Array.of(1, 2))).toThrow();
    expect(() => port.readMemory(0, 1)).toThrow();
  });
  it("holds the full capacity with exact extended counts and saturates legacy status without wrapping", () => {
    const { port, commands } = fixture();
    const event = [100, 0, 0x28, 0];
    const batch = Uint8Array.from([1, ...Array.from({ length: 63 }, () => event).flat()]);
    let count = 0;
    while (count < MAX_YM_EVENTS) {
      const size = Math.min(63, MAX_YM_EVENTS - count);
      port.write(size === 63 ? batch : Uint8Array.from([1, ...Array.from({ length: size }, () => event).flat()]));
      count += size;
      if (count > 65535) expect(port.read(4)).toEqual(Uint8Array.of(1, 255, 255, 50));
    }
    expect(port.read(6)).toEqual(Uint8Array.of(1, 255, 255, 50, 1, 0));
    expect(() => port.write(Uint8Array.from([1, ...event]))).toThrow(/131071/);
    expect(port.read(6)).toEqual(Uint8Array.of(1, 255, 255, 50, 1, 0));
    port.write(Uint8Array.of(2, 101, 0));
    const play = commands.at(-1)!;
    if (play.action !== "play") throw new Error("Missing reservation");
    expect(play.events).toHaveLength(MAX_YM_EVENTS * 3);
    expect(play.events.slice(-3)).toEqual([100, 0x28, 0]);
    expect(port.read(6)).toEqual(Uint8Array.of(1, 0, 0, 50, 0, 0));
  });
  it("reports 65536 correctly to new clients and preserves queue order on rejected batches", () => {
    const { port } = fixture();
    const batch = Uint8Array.from([5, ...Array.from({ length: 42 }, () => [0, 0, 0, 0, 8, 11]).flat()]);
    for (let i = 0; i < 1560; i++) port.write(batch);
    port.write(Uint8Array.from([5, ...Array.from({ length: 16 }, () => [0, 0, 0, 0, 8, 11]).flat()]));
    expect(port.read(6)).toEqual(Uint8Array.of(1, 0, 0, 50, 1, 0));
    expect(port.read(4)).toEqual(Uint8Array.of(1, 255, 255, 50));
    port.write(Uint8Array.of(5, 100, 0, 0, 0, 8, 0));
    expect(() => port.write(Uint8Array.of(5, 99, 0, 0, 0, 8, 11))).toThrow();
    expect(port.read(6)).toEqual(Uint8Array.of(1, 1, 0, 50, 1, 0));
  });
  it("clears reservations on reset and does not commit when transport rejects", () => {
    const { host, port, commands } = fixture();
    port.write(Uint8Array.of(1, 0, 0, 0x28, 0xF0));
    port.write(Uint8Array.of(4, 80));
    host.reset("sound");
    expect(port.read(4)).toEqual(Uint8Array.of(1, 0, 0, 50));
    expect(commands.slice(-2)).toEqual([{ version: 1, action: "stop" }, { version: 1, action: "gain", percent: 50 }]);
    const rejected = fixture(true);
    rejected.port.write(Uint8Array.of(1, 0, 0, 0x28, 0));
    expect(() => rejected.port.write(Uint8Array.of(2, 100, 0))).toThrow("transport full");
    expect(rejected.port.read(4)[1]).toBe(1);
  });
});
