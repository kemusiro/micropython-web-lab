import { describe, expect, it } from "vitest";
import { loadMicroPython } from "../vendor/micropython-build/micropython.mjs";
import { YM2203_DRIVER_SOURCE, YM2203_MML_SOURCE, YM2203_BIN_SOURCE, prepareYm2203Library, backupYm2203Library, YM2203_BIN_PATH, YM2203_MML_PATH } from "../examples/ym2203-library";
import { YM2203_MML_EXAMPLE_SOURCE, YM2203_BIN_EXAMPLE_SOURCE, ym2203DemoBin, YM2203_DEMO_BIN_PATH } from "../examples/ym2203-samples";
import { ProjectFiles } from "../project/filesystem";
import { DeviceHost } from "../device-api/device-host";
import { createYm2203PrototypeDefinition } from "../devices/ym2203-prototype";
import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE as board } from "../board/raspberry-pi-pico-2-w";
import type { YmCommand } from "../audio/ym2203-protocol";

async function run(script: string, data = ym2203DemoBin(), kind: "bin" | "mml" = "bin", keep = true) {
  const output: string[] = [];
  const mp = await loadMicroPython({ url: new URL("../vendor/micropython-build/micropython.wasm", import.meta.url).href,
    linebuffer: false, stdout: bytes => output.push(new TextDecoder().decode(bytes)) });
  const fs = (mp as unknown as { FS: { writeFile(path: string, data: string | Uint8Array): void; mkdir(path: string): void } }).FS;
  fs.writeFile("/web_lab_ym2203_v1.py", YM2203_DRIVER_SOURCE);
  fs.writeFile("/web_lab_ym2203_mml_v1.py", YM2203_MML_SOURCE);
  fs.writeFile("/web_lab_ym2203_bin_v1.py", YM2203_BIN_SOURCE);
  fs.mkdir("/samples"); fs.writeFile("/samples/ym2203-demo.bin", data);
  mp.runPython("import sys\nsys.path.append('/')\nfrom web_lab_ym2203_" + (kind === "mml" ? "mml_v1" : "v1") + " import YM2203\nfrom web_lab_ym2203_bin_v1 import YM2203BinPlayer");
  await mp.runPythonAwaitable([
    "class Bus:",
    "    def __init__(self):",
    "        self.history = []",
    "        self.queued = 0",
    "        self.calls = 0",
    "        self.fail_at = 0",
    "        self.resets = 0",
    "        self.max_packet = 0",
    "        self.play = []",
    "    def readfrom(self, address, count):",
    "        assert address == 0x44 and count == 6",
    "        q = self.queued",
    "        return bytes((1, q & 255, q >> 8 & 255, 20, q >> 16 & 255, q >> 24))",
    "    def writeto(self, address, packet):",
    "        assert address == 0x44",
    "        self.calls += 1",
    "        self.max_packet = max(self.max_packet, len(packet))",
    "        if KEEP: self.history.append(list(packet))",
    "        if self.calls == self.fail_at: raise OSError('transfer failed')",
    "        if packet[0] == 3: self.queued = 0; self.resets += 1",
    "        elif packet[0] == 5: self.queued += (len(packet) - 1) // 6",
    "        elif packet[0] == 1: self.queued += (len(packet) - 1) // 4",
    "        elif packet[0] in (2, 6): self.play = list(packet); self.queued = 0",
    "    def writeto_mem(self, address, reg, data):",
    "        self.writeto(address, bytes((0, reg)) + data)",
    "bus = Bus()",
    "sound = YM2203(bus)",
    "player = YM2203BinPlayer(sound)",
  ].join("\n").replace("KEEP", keep ? "True" : "False"));
  await mp.runPythonAwaitable(script);
  output.length = 0;
  mp.runPython("import json\nprint(json.dumps({'packets': bus.history, 'calls': bus.calls, 'max_packet': bus.max_packet, 'play': bus.play, 'resets': bus.resets, 'queued': bus.queued}))");
  const result = JSON.parse(output.join("")) as { packets: number[][]; calls: number; max_packet: number; play: number[]; resets: number; queued: number };
  const commands: YmCommand[] = [];
  const host = new DeviceHost({ profileId: board.id, profileVersion: board.version, capabilities: board.capabilities });
  host.create("sound", createYm2203PrototypeDefinition(command => commands.push(command)));
  for (const packet of result.packets) host.getPort("sound", "i2c", "i2c-target").write(Uint8Array.from(packet));
  return { ...result, commands };
}
function sample(source: string) {
  return source.replace("from machine import I2C, Pin\n", "")
    .replace("sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))", "sound = YM2203(bus)");
}

describe("streaming YM2203 BIN player", () => {
  it("plays the bundled self-contained FM + SSG data without expanding it in Python", async () => {
    const result = await run(sample(YM2203_BIN_EXAMPLE_SOURCE));
    expect(result.max_packet).toBeLessThanOrEqual(253);
    const play = result.commands.find(command => command.action === "play")!;
    expect(play).toMatchObject({ action: "play", durationMs: 3000 });
    expect(play.events.length / 3).toBe(98);
    expect(play.events.slice(0, 3)).toEqual([0, 0x30, 1]);
    expect(play.events.slice(-6)).toEqual([2650, 0x28, 0, 2650, 8, 0]);
  });
  it("keeps upload memory bounded at 131071 records and supports a 24-hour loop", async () => {
    const data = new Uint8Array(16 + 131071 * 6); data.set([87, 89, 77, 49]);
    const view = new DataView(data.buffer);
    view.setUint32(4, 131071, true); view.setUint32(8, 1000, true); view.setUint32(12, 4_000_000, true);
    for (let i = 0; i < 131071; i++) data[20 + i * 6] = 8;
    const result = await run("assert player.play('samples/ym2203-demo.bin', repeat_ms=86400000) == 86400000", data, "bin", false);
    expect(result.calls).toBe(Math.ceil(131071 / 42) + 3);
    expect(result.max_packet).toBe(253);
    expect(result.play).toEqual([6, 0, 92, 38, 5, 232, 3, 0, 0]);
    expect(result.queued).toBe(0);
  });
  it("rejects malformed headers, lengths, clocks, ordering and repeat settings before writes", async () => {
    const broken: Uint8Array[] = [];
    for (const [at, value] of [[0, 0], [4, 0], [12, 1]]) { const data = ym2203DemoBin(); data[at!] = value!; broken.push(data); }
    broken.push(ym2203DemoBin().slice(0, -1));
    const outOfRange = ym2203DemoBin(); new DataView(outOfRange.buffer).setUint32(outOfRange.length - 6, 3001, true); broken.push(outOfRange);
    const unordered = ym2203DemoBin(); new DataView(unordered.buffer).setUint32(16, 1, true); broken.push(unordered);
    for (const data of broken) {
      const result = await run("try:\n player.play('samples/ym2203-demo.bin')\n raise AssertionError('invalid file accepted')\nexcept ValueError:\n pass", data);
      expect(result.calls).toBe(0);
    }
    const repeat = await run("for value in (True, 2999, 0x100000000):\n try:\n  player.play('samples/ym2203-demo.bin', repeat_ms=value)\n  raise AssertionError('invalid repeat accepted')\n except ValueError:\n  pass");
    expect(repeat.calls).toBe(0);
  });
  it("supports explicit old raw data and clears partial uploads on transfer failure", async () => {
    const raw = await run("assert player.play_raw('samples/ym2203-demo.bin', 98, 3000) == 3000", ym2203DemoBin().slice(16));
    expect(raw.commands.at(-1)).toMatchObject({ action: "play", durationMs: 3000 });
    const failure = await run("bus.fail_at = 4\ntry:\n player.play('samples/ym2203-demo.bin')\n raise AssertionError('failure ignored')\nexcept OSError:\n pass\nassert bus.queued == 0");
    expect(failure.resets).toBe(2); expect(failure.play).toEqual([]);
  });
});

describe("simple MML player", () => {
  it("reserves independent FM and SSG tracks and the bundled example", async () => {
    const result = await run(sample(YM2203_MML_EXAMPLE_SOURCE), undefined, "mml");
    expect(result.commands.at(-1)).toMatchObject({ action: "play", durationMs: 5300 });
    const play = result.commands.find(command => command.action === "play")!;
    expect(play.events.some((value, index) => index % 3 === 1 && value === 0x28)).toBe(true);
    expect(play.events.some((value, index) => index % 3 === 1 && value === 8)).toBe(true);
  });
  it("supports accidentals, octave shifts, dotted notes, rests and exact gate boundaries", async () => {
    const result = await run("assert sound.reserve_mml(({'mml':'t120 o4 l4 q8 c#8. r8 >c< b-4'},), tail_ms=0) == 1625", undefined, "mml");
    const play = result.commands.find(command => command.action === "play")!;
    expect(play.durationMs).toBe(1625);
    expect(play.events.filter((_, i) => i % 3 === 0)).toContain(375);
    const equal = await run("sound.reserve_mml(({'mml':'q8 c d'},), tail_ms=0)", undefined, "mml");
    const events = equal.commands.find(command => command.action === "play")!.events;
    const index = events.findIndex((_, i) => i % 3 === 0 && events[i] === 500);
    expect(events.slice(index, index + 3)).toEqual([500, 0x28, 0]);
  });
  it("rejects unsupported syntax, duplicate channels, pitch ranges and oversized scores without writes", async () => {
    const result = await run([
      "for mml in ('c&d', '[cd]2', 't0 c', 'o10 c', 'l0 c', 'q9 c', 'c..', 'r'*1025, 'o0c'):",
      " try:",
      "  sound.reserve_mml(({'source':'ssg', 'mml':mml},))",
      "  raise AssertionError('bad MML accepted')",
      " except ValueError:",
      "  pass",
      "try:",
      " sound.reserve_mml(({'mml':'c'}, {'mml':'d'}))",
      " raise AssertionError('duplicate channel accepted')",
      "except ValueError:",
      " pass",
    ].join("\n"), undefined, "mml");
    expect(result.calls).toBe(0);
  });
});

describe("player installation preserves project files", () => {
  it("installs only requested players and backs up conflicting BIN data and libraries", () => {
    const files = new ProjectFiles();
    const mml = new ProjectFiles(prepareYm2203Library(files, [], false, false, "mml"));
    expect(mml.get(YM2203_MML_PATH)?.kind).toBe("file"); expect(mml.get(YM2203_BIN_PATH)).toBeUndefined();
    files.write(YM2203_DEMO_BIN_PATH, Uint8Array.of(1, 2, 3));
    files.write(YM2203_BIN_PATH, new TextEncoder().encode("# customized player"));
    expect(() => prepareYm2203Library(files, [], false, false, "bin")).toThrow(/conflicts/);
    const restored = new ProjectFiles(backupYm2203Library(files, [], false, false, "bin").snapshot);
    expect(restored.get("ym2203-backups/1/files/" + YM2203_DEMO_BIN_PATH)).toMatchObject({ data: Uint8Array.of(1, 2, 3) });
    expect(restored.get(YM2203_DEMO_BIN_PATH)).toMatchObject({ data: ym2203DemoBin() });
    expect(files.get(YM2203_DEMO_BIN_PATH)).toMatchObject({ data: Uint8Array.of(1, 2, 3) });
  });
});
