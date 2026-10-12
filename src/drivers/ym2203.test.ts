import { describe, expect, it } from "vitest";
import { loadMicroPython } from "../vendor/micropython-build/micropython.mjs";
import { YM2203_DRIVER_SOURCE, YM2203_DRIVER_PATH, YM2203_SCORE_SOURCE, YM2203_SCORE_PATH, YM2203_TONE_SOURCE, YM2203_TONE_PATH, prepareYm2203Library, backupYm2203Library, YmLibraryConflict } from "../examples/ym2203-library";
import { ProjectFiles, MAX_PROJECT_BYTES } from "../project/filesystem";
import { createYm2203PrototypeDefinition } from "../devices/ym2203-prototype";
import { DeviceHost } from "../device-api/device-host";
import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE as board } from "../board/raspberry-pi-pico-2-w";
import type { YmCommand } from "../audio/ym2203-protocol";
import { YmRenderer, instantiateYmCore } from "../audio/ym2203-renderer";
import { defaultYmPatch, patchPython, patchPreviewPython, patchHeldPython } from "../audio/ym2203-patch";
import { POCKET_SIGNAL_EXAMPLE_SOURCE } from "../examples/pocket-signal";
import previousDriver from "./pre-long-playback/web_lab_ym2203_v1.py?raw";
import previousScore from "./pre-long-playback/web_lab_ym2203_score_v1.py?raw";
import smallQueueDriver from "./pre-large-reservations/web_lab_ym2203_v1.py?raw";
import smallQueueScore from "./pre-large-reservations/web_lab_ym2203_score_v1.py?raw";

const fsSpecifier = "node:fs";
const { readFileSync } = await import(fsSpecifier) as { readFileSync(path: URL): Uint8Array<ArrayBuffer> };
const wasm = new WebAssembly.Module(readFileSync(new URL("../vendor/ymfm-build/ym2203.wasm", import.meta.url)));
async function driver(script: string, score = false, tone = false) {
  const output: string[] = [];
  const mp = await loadMicroPython({ url: new URL("../vendor/micropython-build/micropython.wasm", import.meta.url).href,
    linebuffer: false, stdout: data => output.push(new TextDecoder().decode(data)) });
  if (score || tone) {
    const fs = (mp as unknown as { FS: { writeFile(path: string, source: string): void } }).FS;
    fs.writeFile("/web_lab_ym2203_v1.py", YM2203_DRIVER_SOURCE);
    fs.writeFile("/web_lab_ym2203_score_v1.py", YM2203_SCORE_SOURCE);
    if (tone) fs.writeFile("/web_lab_ym2203_tone_v1.py", YM2203_TONE_SOURCE);
    mp.runPython(`import sys\nsys.path.append('/')\nfrom web_lab_ym2203_${tone ? "tone" : "score"}_v1 import YM2203`);
  } else mp.runPython(YM2203_DRIVER_SOURCE);
  await mp.runPythonAwaitable(`class Bus:
    def __init__(self):
        self.packets = []
        self.queued = 0
        self.version = 1
        self.fail_at = 0
    def readfrom(self, address, count):
        assert address == 0x44 and count == 6
        return bytes((self.version, self.queued & 255, self.queued >> 8 & 255, 50, self.queued >> 16, 0))
    def writeto(self, address, packet):
        assert address == 0x44 and len(packet) <= 256
        self.packets.append(list(packet))
        if self.fail_at == len(self.packets):
            raise OSError("transfer failed")
    def writeto_mem(self, address, register, data):
        self.writeto(address, bytes((0, register)) + data)
bus = Bus()
sound = YM2203(bus)
`);
  await mp.runPythonAwaitable(script);
  output.length = 0;
  mp.runPython("import json\nprint(json.dumps(bus.packets))");
  const packets = JSON.parse(output.join("")) as number[][];
  const commands: YmCommand[] = [];
  const host = new DeviceHost({ profileId: board.id, profileVersion: board.version, capabilities: board.capabilities });
  host.create("sound", createYm2203PrototypeDefinition(command => commands.push(command)));
  const port = host.getPort("sound", "i2c", "i2c-target");
  for (const packet of packets) port.write(Uint8Array.from(packet));
  return { mp, packets, commands };
}

function pcm(commands: YmCommand[]) {
  const renderer = new YmRenderer(instantiateYmCore(wasm), 48000);
  for (const command of commands) renderer.command(command);
  const block = new Float32Array(128);
  for (let i = 0; i < 80; i++) renderer.render(block);
  return { block: [...block], fm: renderer.fmRms, ssg: renderer.ssgRms };
}

describe("MicroPython YM2203 driver", () => {
  it("reads the extended queue count and reserves beyond the old 1024 limit", async () => {
    const result = await driver("bus.queued = 65536\nassert sound.status()['queued'] == 65536\nbus.queued = 0\nassert sound.reserve([60] * 300, step_ms=10, gate_ms=8, tail_ms=0) == 3000");
    const play = result.commands.at(-1)!;
    if (play.action !== "play") throw new Error("Missing reservation");
    expect(play.events).toHaveLength(1200 * 3);
    const limited = await driver("_MAX_EVENTS = 4\ntry:\n sound.reserve((60, 62))\n raise AssertionError('capacity exceeded')\nexcept ValueError:\n pass");
    expect(limited.packets).toEqual([]);
  });

  it("reserves unsigned long notes and a 24-hour repeat without expanding the note list", async () => {
    const held = await driver("assert sound.reserve((69,), source='ssg', step_ms=86400000, gate_ms=86399000, tail_ms=0) == 86400000");
    expect(held.packets.some(packet => packet[0] === 5)).toBe(true);
    expect(held.commands.at(-1)).toMatchObject({ action: "play", durationMs: 86400000, events: [0, 0, expect.any(Number), 0, 1, expect.any(Number), 0, 8, 11, 86399000, 8, 0] });
    const looping = await driver("assert sound.reserve((60,64,67), source='ssg', step_ms=200, gate_ms=150, tail_ms=0, repeat_ms=86400000) == 86400000");
    expect(looping.commands.at(-1)).toMatchObject({ action: "play", durationMs: 86400000, loopMs: 600 });
    const repeated = looping.commands.at(-1)!;
    if (repeated.action !== "play") throw new Error("Missing loop");
    expect(repeated.events.length).toBe(36);
    const maximum = await driver("assert sound.reserve((None,), step_ms=0xFFFFFFFF, gate_ms=1, tail_ms=0) == 0xFFFFFFFF");
    expect(maximum.commands.at(-1)).toMatchObject({ action: "play", durationMs: 0xFFFFFFFF });
    const invalid = await driver(`for params in ({'repeat_ms': True}, {'repeat_ms': 10}, {'step_ms': 99, 'gate_ms': 1, 'tail_ms': 0, 'repeat_ms': 1000}, {'repeat_ms': 0x100000000}):
    try:
        sound.reserve((60,), **params)
        raise AssertionError('invalid repeat accepted')
    except ValueError:
        pass`);
    expect(invalid.packets).toEqual([]);
  });
  it("reproduces the CC0 Pocket Signal excerpt's VGM registers, timing and PCM", async () => {
    const source = POCKET_SIGNAL_EXAMPLE_SOURCE.replace("from machine import I2C, Pin\n", "")
      .replace("sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))", "sound = YM2203(bus)");
    const { commands, packets } = await driver(source, false, true);
    const play = commands.find(command => command.action === "play")!;
    expect(play.durationMs).toBe(12020);
    expect(play.events.length / 3).toBe(960);
    expect(packets.every(packet => packet.length <= 256)).toBe(true);

    // Independent reference: the author's actual CC0 VGM, pinned and hashed in docs.
    // Only its two command types (YM2203 write / 16-bit wait) are interpreted here.
    const data = readFileSync(new URL("../../fixtures/ym2203/pocket-signal.vgm", import.meta.url));
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    expect(new TextDecoder().decode(data.subarray(0, 4))).toBe("Vgm ");
    expect(view.getUint32(0x44, true)).toBe(4_000_000);
    let offset = 0x34 + view.getUint32(0x34, true), samples = 0;
    const initial: number[] = [], expected: number[] = [];
    let initialized = false;
    while (samples < 508_032) { // All 64 * 7938 samples = 11520 ms.
      const command = data[offset++]!;
      if (command === 0x55) {
        const register = data[offset++]!, value = data[offset++]!;
        if (register === 0x28) initialized = true;
        if (initialized) expected.push(samples * 1000 / 44_100, register, value);
        else initial.push(register, value);
      } else if (command === 0x61) { samples += view.getUint16(offset, true); offset += 2; }
      else throw new Error(`Unexpected fixture command: ${command}`);
    }
    expect(play.events).toEqual(expected);
    const written = new Map<number, number>();
    for (const command of commands) if (command.action === "write") {
      for (let i = 0; i < command.pairs.length; i += 2) written.set(command.pairs[i]!, command.pairs[i + 1]!);
    }
    for (let i = 0; i < initial.length; i += 2) expect(written.get(initial[i]!)).toBe(initial[i + 1]);

    const actual = new YmRenderer(instantiateYmCore(wasm), 48000);
    const reference = new YmRenderer(instantiateYmCore(wasm), 48000);
    for (const command of commands) actual.command(command);
    reference.command({ version: 1, action: "gain", percent: 20 });
    reference.command({ version: 1, action: "write", pairs: initial });
    reference.command({ version: 1, action: "play", events: expected, durationMs: 12020 });
    const a = new Float32Array(128), b = new Float32Array(128);
    let fmPeak = 0;
    for (let frame = 0; frame < 12100 * 48; frame += 128) {
      actual.render(a); reference.render(b);
      expect(a).toEqual(b);
      expect(actual.ssgRms).toBe(0);
      fmPeak = Math.max(fmPeak, actual.fmRms);
    }
    expect(fmPeak).toBeGreaterThan(0.01);
    expect(actual.active).toBe(false);
  });

  it("reserves the same nine MIDI notes for FM and SSG with correct pitch and timing", async () => {
    const { commands } = await driver(`notes = (60, 62, 64, 65, 67, 65, 64, 62, 60)
sound.reset()
sound.fm_tone()
assert sound.reserve(notes) == 3000
sound.reset()
assert sound.reserve(notes, source="ssg") == 3000`);
    const plays = commands.filter(command => command.action === "play");
    expect(plays).toHaveLength(2);
    const frequencies = [261.626, 293.665, 329.628, 349.228, 391.995, 349.228, 329.628, 293.665, 261.626];
    for (const [index, play] of plays.entries()) {
      expect(play.durationMs).toBe(3000);
      expect(play.events).toHaveLength(108);
      for (const [note, hz] of frequencies.entries()) {
        const events = play.events.slice(note * 12, note * 12 + 12);
        expect([events[0], events[3], events[6], events[9]]).toEqual([note * 300, note * 300, note * 300, note * 300 + 250]);
        if (index === 0) {
          expect([events[1], events[4], events[7], events[10]]).toEqual([0xA4, 0xA0, 0x28, 0x28]);
          const high = events[2]!, fnum = ((high & 7) << 8) | events[5]!;
          const actual = (4_000_000 / 72) * fnum * (1 << (high >> 3)) / (1 << 21);
          expect(Math.abs(actual - hz) / hz).toBeLessThan(0.002);
          expect([events[8], events[11]]).toEqual([0xF0, 0]);
        } else {
          expect([events[1], events[4], events[7], events[10]]).toEqual([0, 1, 8, 8]);
          const period = events[2]! | events[5]! << 8;
          expect(Math.abs(125_000 / period - hz) / hz).toBeLessThan(0.002);
          expect([events[8], events[11]]).toEqual([11, 0]);
        }
      }
    }
  });

  it("renders distinct FM presets on all channels and SSG without FM leakage", async () => {
    const tones: number[][] = [];
    for (const [channel, preset] of ["soft", "bright", "bell"].entries()) {
      const result = await driver(`sound.reset()\nsound.fm_tone("${preset}", channel=${channel})\nsound.fm_note(69, channel=${channel})`);
      const output = pcm(result.commands);
      expect(output.fm).toBeGreaterThan(0.001);
      expect(output.ssg).toBeLessThan(1e-5);
      tones.push(output.block);
    }
    for (let i = 1; i < tones.length; i++) {
      const energy = tones[i]!.reduce((sum, value, n) => sum + (value - tones[0]![n]!) ** 2, 0);
      expect(Math.sqrt(energy / 128)).toBeGreaterThan(0.0001);
    }
    const result = await driver("sound.reset()\nsound.ssg_note(69, channel=2)");
    const output = pcm(result.commands);
    expect(output.fm).toBeLessThan(1e-5);
    expect(output.ssg).toBeGreaterThan(0.001);
  });

  it("batches long reservations and preserves rests and equal-time event order", async () => {
    const long = await driver("assert sound.reserve([60] * 66, step_ms=30, gate_ms=20, tail_ms=0) == 1980");
    expect(long.packets.filter(packet => packet[0] === 1)).toHaveLength(5);
    expect(long.packets.every(packet => packet.length <= 253)).toBe(true);
    expect(long.commands.at(-1)).toMatchObject({ action: "play", durationMs: 1980 });
    const rests = await driver("sound.reserve((None, 60, None), step_ms=100, gate_ms=100, tail_ms=0)");
    expect(rests.commands.at(-1)).toMatchObject({ action: "play", events: [0, 0x28, 0, 100, 0xA4, expect.any(Number), 100, 0xA0, expect.any(Number), 100, 0x28, 0xF0, 200, 0x28, 0, 200, 0x28, 0] });
  });

  it("retriggers the reserved channel after an immediate note and accepts the eight-second boundary", async () => {
    const result = await driver("sound.fm_tone(channel=1)\nsound.fm_note(69, channel=1)\nassert sound.reserve([60] * 8, channel=1, step_ms=1000, gate_ms=1000, tail_ms=0) == 8000");
    expect(result.commands.at(-2)).toEqual({ version: 1, action: "write", pairs: [0x28, 1] });
    expect(result.commands.at(-1)).toMatchObject({ action: "play", durationMs: 8000 });
    const play = result.commands.at(-1)!;
    if (play.action !== "play") throw new Error("Missing reservation");
    expect(play.events.slice(0, 9)).toEqual([0, 0xA5, expect.any(Number), 0, 0xA1, expect.any(Number), 0, 0x28, 0xF1]);
    expect(play.events.slice(-3)).toEqual([8000, 0x28, 1]);
  });

  it("rejects invalid values, oversized scores and occupied queues before writing", async () => {
    const invalid = ["sound.volume(True)", "sound.volume(101)", "sound.fm_tone('unknown')", "sound.fm_note(127)", "sound.fm_note(60, 3)", "sound.ssg_note(0)", "sound.ssg_note(60, volume=16)", "sound.reserve(())", "sound.reserve((60,), source='mixed')", "sound.reserve((60,), gate_ms=301)", "sound.reserve((60,), step_ms=0xFFFFFFFF, tail_ms=1)"];
    const script = invalid.map(call => `try:\n    ${call}\n    raise AssertionError('accepted invalid value')\nexcept ValueError:\n    pass`).join("\n");
    const result = await driver(script + "\nbus.queued = 1\ntry:\n    sound.reserve((60,))\n    raise AssertionError('accepted occupied queue')\nexcept ValueError:\n    pass");
    expect(result.packets).toEqual([]);
    await expect(result.mp.runPythonAwaitable("bus.version = 2\nsound.status()")).rejects.toThrow(/protocol/);
  });

  it("clears earlier batches when an I2C transfer fails", async () => {
    const result = await driver("bus.fail_at = 3\ntry:\n    sound.reserve([60] * 66, step_ms=30, gate_ms=20, tail_ms=0)\n    raise AssertionError('transfer failure ignored')\nexcept OSError:\n    pass");
    expect(result.packets.map(packet => packet[0])).toEqual([0, 1, 1, 3]);
    expect(result.commands.at(-1)).toMatchObject({ action: "stop" });
  });
});

describe("multi-channel score reservations", () => {
  it("accepts a score above the old limit and still rejects its configured event limit before writing", async () => {
    const result = await driver("sound.reserve_score(({'source':'ssg','channel':0,'notes':[60]*300,'step_ms':10,'gate_ms':8},), tail_ms=0)", true);
    const play = result.commands.at(-1)!;
    if (play.action !== "play") throw new Error("Missing score");
    expect(play.events.length / 3).toBe(1201);
    const limited = await driver("import web_lab_ym2203_score_v1 as score\nscore._MAX_EVENTS = 4\ntry:\n sound.reserve_score(({'source':'ssg','channel':0,'notes':(60,)},))\n raise AssertionError('accepted oversized score')\nexcept ValueError:\n pass", true);
    expect(limited.packets).toEqual([]);
  });

  it("supports a 24-hour sparse score and a repeated multi-channel pattern", async () => {
    const sparse = await driver("assert sound.reserve_score(({'source':'fm','channel':0,'notes':(60,), 'start_ms':86399000, 'step_ms':1000},), tail_ms=0) == 86400000", true);
    expect(sparse.commands.at(-1)).toMatchObject({ action: "play", durationMs: 86400000 });
    const repeat = await driver("assert sound.reserve_score(({'source':'fm','channel':0,'notes':(60,64)}, {'source':'ssg','channel':0,'notes':(48,55)}), repeat_ms=86400000) == 86400000", true);
    expect(repeat.commands.at(-1)).toMatchObject({ action: "play", durationMs: 86400000, loopMs: 900 });
    expect(repeat.packets.every(packet => packet.length <= 256)).toBe(true);
    const failed = await driver("bus.fail_at = 2\ntry:\n sound.reserve_score(({'source':'fm','channel':0,'notes':(60,)},), repeat_ms=86400000)\nexcept OSError:\n pass", true);
    expect(failed.commands.at(-1)).toMatchObject({ action: "stop" });
  });
  it("merges all six channels and each one contributes to actual mixed PCM", async () => {
    const source = (omit = -1) => `sound.reset()
for channel in range(3):
    sound.fm_tone(channel=channel)
tracks = []
for index in range(6):
    if index != ${omit}:
        tracks.append({"source": "fm" if index < 3 else "ssg", "channel": index % 3,
                       "notes": ((60, 64, 67, 48, 55, 60)[index],)})
assert sound.reserve_score(tracks) == 600`;
    const all = await driver(source(), true);
    const plays = all.commands.filter(command => command.action === "play");
    expect(plays).toHaveLength(1);
    expect(plays[0]!.events).toHaveLength(30 * 3);
    const combined = pcm(all.commands);
    expect(combined.fm).toBeGreaterThan(0.001);
    expect(combined.ssg).toBeGreaterThan(0.001);
    for (let omit = 0; omit < 6; omit++) {
      const reduced = pcm((await driver(source(omit), true)).commands);
      const difference = reduced.block.reduce((sum, value, i) => sum + (value - combined.block[i]!) ** 2, 0);
      expect(Math.sqrt(difference / 128)).toBeGreaterThan(0.00001);
    }
  });

  it("orders offs before ons while keeping FM high/low pitch pairs together, including delayed tracks and rests", async () => {
    const { commands } = await driver(`sound.reserve_score((
    {"source": "fm", "channel": 1, "notes": (60, 62), "step_ms": 100, "gate_ms": 100},
    {"source": "fm", "channel": 0, "notes": (69,), "start_ms": 100, "step_ms": 200},
    {"source": "ssg", "channel": 2, "notes": (None, 48), "step_ms": 150, "gate_ms": 100},
), tail_ms=0)`, true);
    const play = commands.at(-1)!;
    if (play.action !== "play") throw new Error("Missing score");
    expect(play.durationMs).toBe(300);
    const events = Array.from({ length: play.events.length / 3 }, (_, index) => play.events.slice(index * 3, index * 3 + 3));
    expect(events.map(event => event[0])).toEqual([...events.map(event => event[0])].sort((a, b) => a! - b!));
    const at100 = events.filter(event => event[0] === 100);
    expect(at100.map(event => event[1])).toEqual([0x28, 0xA5, 0xA1, 0x28, 0xA4, 0xA0, 0x28]);
    expect(at100.map(event => event[2]).filter((_, i) => i === 0 || i === 3 || i === 6)).toEqual([1, 0xF1, 0xF0]);
    expect(events.filter(event => event[0] === 0).slice(0, 4)).toEqual([[0, 0x28, 1], [0, 0x28, 0], [0, 10, 0], [0, 10, 0]]);
    expect(events.filter(event => event[1] === 4).map(event => event[0])).toEqual([150]);
  });

  it("rejects malformed tracks, duplicates, invalid timing, capacity and occupied queues without I2C writes", async () => {
    const valid = '{"source":"fm", "channel":0, "notes":(60,)}';
    const calls = [
      'sound.reserve_score(())', 'sound.reserve_score((1,))', 'sound.reserve_score(({},))',
      `sound.reserve_score((${valid}, ${valid}))`,
      'sound.reserve_score(({"source":"ssg", "channel":3, "notes":(60,)},))',
      'sound.reserve_score(({"source":"fm", "channel":0, "notes":(127,)},))',
      'sound.reserve_score(({"source":"ssg", "channel":0, "notes":(0,)},))',
      'sound.reserve_score(({"source":"fm", "channel":0, "notes":()},))',
      'sound.reserve_score(({"source":"fm", "channel":0, "notes":(60,), "gate_ms":301},))',
      'sound.reserve_score(({"source":"fm", "channel":0, "notes":(60,), "start_ms":0xFFFFFFFF},))',
      'sound.reserve_score(({"source":"fm", "channel":0, "notes":(60,), "start_ms":True},))',
      'sound.reserve_score(({"source":"fm", "channel":0, "notes":(60,), "typo":1},))',
      `sound.reserve_score((${valid},), tail_ms=-1)`,
    ];
    const script = calls.map(call => `try:\n    ${call}\n    raise AssertionError('invalid score accepted')\nexcept ValueError:\n    pass`).join("\n");
    const result = await driver(script + `\nbus.queued = 1\ntry:\n    sound.reserve_score((${valid},))\n    raise AssertionError('occupied queue accepted')\nexcept ValueError:\n    pass`, true);
    expect(result.packets).toEqual([]);
  });

  it("splits one sorted score into bounded transfers and resets a partial queue on failure", async () => {
    const score = 'sound.reserve_score(({"source":"fm", "channel":0, "notes":[60]*66, "step_ms":30, "gate_ms":20},), tail_ms=0)';
    const result = await driver(`assert ${score} == 1980`, true);
    expect(result.packets.filter(packet => packet[0] === 1)).toHaveLength(5);
    expect(result.packets.every(packet => packet.length <= 253)).toBe(true);
    expect(result.commands.filter(command => command.action === "play")).toHaveLength(1);
    const failure = await driver(`bus.fail_at = 2\ntry:\n    ${score}\n    raise AssertionError('transfer failure ignored')\nexcept OSError:\n    pass`, true);
    expect(failure.packets.map(packet => packet[0])).toEqual([1, 1, 3]);
    expect(failure.commands.at(-1)).toMatchObject({ action: "stop" });
  });
});

describe("sample driver installation", () => {
  it("upgrades the exact pre-capacity libraries but protects their edited drafts", () => {
    const files = new ProjectFiles();
    files.write(YM2203_DRIVER_PATH, new TextEncoder().encode(smallQueueDriver));
    files.write(YM2203_SCORE_PATH, new TextEncoder().encode(smallQueueScore));
    const tabs = [{ id: "base", title: "base", path: YM2203_DRIVER_PATH, source: smallQueueDriver }];
    const next = new ProjectFiles(prepareYm2203Library(files, tabs, true));
    expect(new TextDecoder().decode((next.get(YM2203_DRIVER_PATH) as { data: Uint8Array }).data)).toBe(YM2203_DRIVER_SOURCE);
    expect(new TextDecoder().decode((next.get(YM2203_SCORE_PATH) as { data: Uint8Array }).data)).toBe(YM2203_SCORE_SOURCE);
    expect(() => prepareYm2203Library(files, [{ ...tabs[0]!, source: smallQueueDriver + "# edited" }], true)).toThrow(/conflicts/);
  });

  it("reports conflicting paths and explicitly preserves stored versions and unsaved edits when updating", () => {
    const files = new ProjectFiles();
    const encode = (text: string) => new TextEncoder().encode(text);
    const decode = (project: ProjectFiles, path: string) => {
      const entry = project.get(path);
      if (entry?.kind !== "file") throw new Error("Missing backup");
      return new TextDecoder().decode(entry.data);
    };
    files.write(YM2203_DRIVER_PATH, encode("# older unknown base"));
    files.write(YM2203_SCORE_PATH, encode(YM2203_SCORE_SOURCE));
    files.write("web_lab_ym2203_tone_v1/__init__.py", encode("# root package"));
    files.write("lib/web_lab_ym2203_tone_v1/data.bin", Uint8Array.of(0, 255));
    files.write("main.py", encode("print('keep')"));
    files.mkdir("ym2203-backups/1");
    const tabs = [
      { id: "base", title: "base", path: YM2203_DRIVER_PATH, source: "# unsaved edited base" },
      { id: "score", title: "score", path: YM2203_SCORE_PATH, source: YM2203_SCORE_SOURCE },
      { id: "missing", title: "missing", path: "web_lab_ym2203_v1.py", source: "# unsaved shadow" },
      { id: "main", title: "main", path: "main.py", source: "print('draft')" },
    ];
    const before = files.snapshot();
    try { prepareYm2203Library(files, tabs, false, true); throw new Error("Expected conflict"); }
    catch (error) {
      expect(error).toBeInstanceOf(YmLibraryConflict);
      expect((error as YmLibraryConflict).paths).toEqual(expect.arrayContaining([YM2203_DRIVER_PATH, "web_lab_ym2203_v1.py", "web_lab_ym2203_tone_v1", "lib/web_lab_ym2203_tone_v1"]));
    }
    const result = backupYm2203Library(files, tabs, false, true), after = new ProjectFiles(result.snapshot);
    expect(result.backupPath).toBe("ym2203-backups/2");
    expect(decode(after, `${result.backupPath}/files/${YM2203_DRIVER_PATH}`)).toBe("# older unknown base");
    expect(decode(after, result.tabs[0]!.path!)).toBe("# unsaved edited base");
    expect(decode(after, result.tabs[1]!.path!)).toBe(YM2203_SCORE_SOURCE);
    expect(decode(after, result.tabs[2]!.path!)).toBe("# unsaved shadow");
    expect(decode(after, `${result.backupPath}/files/web_lab_ym2203_tone_v1/__init__.py`)).toBe("# root package");
    expect(after.get(`${result.backupPath}/files/lib/web_lab_ym2203_tone_v1/data.bin`)).toMatchObject({ data: Uint8Array.of(0, 255) });
    expect(decode(after, YM2203_DRIVER_PATH)).toBe(YM2203_DRIVER_SOURCE);
    expect(decode(after, YM2203_TONE_PATH)).toBe(YM2203_TONE_SOURCE);
    expect(result.tabs[3]).toEqual(tabs[3]);
    expect(after.get("main.py")).toEqual(files.get("main.py"));
    expect(files.snapshot()).toEqual(before);
    expect(tabs[0]!.path).toBe(YM2203_DRIVER_PATH);
  });

  it("leaves originals and drafts untouched when a backup/update exceeds storage limits", () => {
    const files = new ProjectFiles();
    files.write(YM2203_DRIVER_PATH, new TextEncoder().encode("# custom"));
    files.write("full.bin", new Uint8Array(MAX_PROJECT_BYTES - 8));
    const tabs = [{ id: "base", title: "base", path: YM2203_DRIVER_PATH, source: "# unsaved" }];
    const before = files.get(YM2203_DRIVER_PATH), full = files.get("full.bin");
    expect(() => backupYm2203Library(files, tabs)).toThrow(/4 MiB/);
    expect(files.get(YM2203_DRIVER_PATH)).toBe(before);
    expect(files.get("full.bin")).toBe(full);
    expect(files.get("ym2203-backups")).toBeUndefined();
    expect(tabs[0]!.path).toBe(YM2203_DRIVER_PATH);
  });

  it("upgrades only exact old bundled sources, preserves unrelated files and rejects unsaved edits atomically", () => {
    const files = new ProjectFiles();
    files.write(YM2203_DRIVER_PATH, new TextEncoder().encode(previousDriver));
    files.write(YM2203_SCORE_PATH, new TextEncoder().encode(previousScore));
    files.write("main.py", new TextEncoder().encode("# my source"));
    const before = files.snapshot();
    const upgraded = new ProjectFiles(prepareYm2203Library(files, [{ id: "old", title: "driver", path: YM2203_DRIVER_PATH, source: previousDriver }], false, true));
    expect(files.snapshot()).toEqual(before);
    expect(new TextDecoder().decode((upgraded.get(YM2203_DRIVER_PATH) as { data: Uint8Array }).data)).toBe(YM2203_DRIVER_SOURCE);
    expect(new TextDecoder().decode((upgraded.get(YM2203_SCORE_PATH) as { data: Uint8Array }).data)).toBe(YM2203_SCORE_SOURCE);
    expect(upgraded.get("main.py")).toEqual(files.get("main.py"));
    expect(() => prepareYm2203Library(files, [{ id: "old", title: "driver", path: YM2203_DRIVER_PATH, source: previousDriver + "# edited" }], false, true)).toThrow(/conflicts/);
    files.write(YM2203_SCORE_PATH, new TextEncoder().encode(previousScore + "# edited"));
    const edited = files.snapshot();
    expect(() => prepareYm2203Library(files, [], false, true)).toThrow(/conflicts/);
    expect(files.snapshot()).toEqual(edited);
  });

  it("adds the tone extension and its dependencies without replacing previous libraries", () => {
    const files = new ProjectFiles(prepareYm2203Library(new ProjectFiles(), [], true));
    const installed = new ProjectFiles(prepareYm2203Library(files, [], false, true));
    for (const path of [YM2203_DRIVER_PATH, YM2203_SCORE_PATH]) expect(installed.get(path)).toEqual(files.get(path));
    expect(new TextDecoder().decode((installed.get(YM2203_TONE_PATH) as { data: Uint8Array }).data)).toBe(YM2203_TONE_SOURCE);
    for (const path of [YM2203_TONE_PATH, "web_lab_ym2203_tone_v1.py", "lib/web_lab_ym2203_tone_v1/__init__.py"]) {
      const conflicting = new ProjectFiles(); conflicting.write(path, new TextEncoder().encode("# user patch driver"));
      const before = conflicting.snapshot();
      expect(() => prepareYm2203Library(conflicting, [], false, true)).toThrow(/conflicts/);
      expect(conflicting.snapshot()).toEqual(before);
    }
    expect(() => prepareYm2203Library(installed, [{ id: "tone", title: "tone.py", path: YM2203_TONE_PATH, source: "# edited" }], false, true)).toThrow(/conflicts/);
    const limited = new ProjectFiles();
    limited.write("full.bin", new Uint8Array(MAX_PROJECT_BYTES - new TextEncoder().encode(YM2203_DRIVER_SOURCE + YM2203_SCORE_SOURCE).length));
    expect(() => prepareYm2203Library(limited, [], false, true)).toThrow(/4 MiB/);
    expect(limited.get(YM2203_DRIVER_PATH)).toBeUndefined();
    expect(limited.get(YM2203_SCORE_PATH)).toBeUndefined();
  });
  it("adds the optional score library without changing the existing base, and rejects score conflicts atomically", () => {
    const files = new ProjectFiles(prepareYm2203Library(new ProjectFiles(), []));
    const installed = new ProjectFiles(prepareYm2203Library(files, [], true));
    expect(installed.get(YM2203_DRIVER_PATH)).toEqual(files.get(YM2203_DRIVER_PATH));
    expect(installed.get(YM2203_SCORE_PATH)?.kind).toBe("file");
    const conflicting = new ProjectFiles();
    conflicting.write(YM2203_SCORE_PATH, new TextEncoder().encode("# user score"));
    const before = conflicting.snapshot();
    expect(() => prepareYm2203Library(conflicting, [], true)).toThrow(/conflicts/);
    expect(conflicting.snapshot()).toEqual(before);
    expect(conflicting.get(YM2203_DRIVER_PATH)).toBeUndefined();
    const limited = new ProjectFiles();
    limited.write("full.bin", new Uint8Array(MAX_PROJECT_BYTES - new TextEncoder().encode(YM2203_DRIVER_SOURCE).length));
    expect(() => prepareYm2203Library(limited, [], true)).toThrow(/4 MiB/);
    expect(limited.get(YM2203_DRIVER_PATH)).toBeUndefined();
    expect(limited.get(YM2203_SCORE_PATH)).toBeUndefined();
  });
  it("adds an editable library to a copy and preserves existing files", () => {
    const files = new ProjectFiles(); files.write("main.py", new TextEncoder().encode("print('saved')"));
    const before = files.snapshot();
    const installed = prepareYm2203Library(files, []);
    expect(files.snapshot()).toEqual(before);
    const after = new ProjectFiles(installed);
    expect(new TextDecoder().decode((after.get(YM2203_DRIVER_PATH) as { data: Uint8Array }).data)).toBe(YM2203_DRIVER_SOURCE);
    expect(prepareYm2203Library(after, [])).toEqual(installed);
  });
  it("rejects custom files, unsaved library edits, module shadowing and quota failures atomically", () => {
    for (const path of [YM2203_DRIVER_PATH, "web_lab_ym2203_v1.py", "lib/web_lab_ym2203_v1/__init__.py"]) {
      const files = new ProjectFiles(); files.write(path, new TextEncoder().encode("# user data"));
      const before = files.snapshot();
      expect(() => prepareYm2203Library(files, [])).toThrow(/conflicts/);
      expect(files.snapshot()).toEqual(before);
    }
    const files = new ProjectFiles(prepareYm2203Library(new ProjectFiles(), []));
    expect(() => prepareYm2203Library(files, [{ id: "driver", title: "driver.py", path: YM2203_DRIVER_PATH, source: "# edited" }])).toThrow(/conflicts/);
    const full = new ProjectFiles(); full.write("full.bin", new Uint8Array(MAX_PROJECT_BYTES));
    expect(() => prepareYm2203Library(full, [])).toThrow(/4 MiB/);
    expect(full.get(YM2203_DRIVER_PATH)).toBeUndefined();
  });
});

describe("FM patches and SSG noise/envelope API", () => {
  it("executes held-key code on every FM/SSG channel and renews without changing PCM phase", async () => {
    const substituteBus = (source: string) => source.replace("from machine import I2C, Pin", "").replace("I2C(0, scl=Pin(9), sda=Pin(8))", "bus");
    for (const source of ["fm", "ssg"] as const) for (let channel = 0; channel < 3; channel++) {
      const patch = defaultYmPatch(); patch.source = source; patch.channel = channel;
      patch.noise = true; patch.envelope = channel !== 0; patch.shape = 10 + channel;
      const held = await driver(substituteBus(patchHeldPython(patch)));
      const short = await driver(substituteBus(patchPreviewPython(patch)));
      expect(held.commands.some(command => command.action === "play")).toBe(false);
      expect(pcm(held.commands)).toEqual(pcm(short.commands));
      const renewed = await driver(substituteBus(patchHeldPython(patch, true)));
      expect(renewed.commands).toHaveLength(1);
      expect(renewed.commands[0]!.action).toBe("write");
      const first = new YmRenderer(instantiateYmCore(wasm), 48000), second = new YmRenderer(instantiateYmCore(wasm), 48000);
      for (const command of held.commands) { first.command(command); second.command(command); }
      const a = new Float32Array(128), b = new Float32Array(128);
      for (let i = 0; i < 80; i++) { first.render(a); second.render(b); }
      first.command(renewed.commands[0]!);
      for (let i = 0; i < 80; i++) { first.render(a); second.render(b); expect(a).toEqual(b); }
    }
  });
  it("matches editor audition registers and PCM to exported Python through the real driver", async () => {
    const substituteBus = (source: string) => source.replace("from machine import I2C, Pin", "").replace("I2C(0, scl=Pin(9), sda=Pin(8))", "bus");
    for (const source of ["fm", "ssg"] as const) for (let channel = 0; channel < 3; channel++) {
      const patch = defaultYmPatch(); patch.source = source; patch.channel = channel;
      patch.algorithm = channel + 3; patch.feedback = channel + 4;
      patch.operators[1]!.multiple = channel + 2; patch.operators[2]!.attack = 20;
      patch.envelope = channel !== 0; patch.noise = true; patch.tone = channel !== 2;
      patch.shape = 10 + channel; patch.envelopePeriod = 500;
      const preview = await driver(substituteBus(patchPreviewPython(patch)), false, true);
      const exported = patchPython(patch).replace("sleep_ms(1000)\nsound.reset()", "");
      const python = await driver(substituteBus(exported), false, true);
      const registers = (commands: YmCommand[]) => {
        const values = new Map<number, number>();
        for (const c of commands) {
          if (c.action === "write") for (let i = 0; i < c.pairs.length; i += 2) values.set(c.pairs[i]!, c.pairs[i + 1]!);
          if (c.action === "play") for (let i = 0; i < c.events.length && c.events[i] === 0; i += 3) values.set(c.events[i + 1]!, c.events[i + 2]!);
        }
        return [...values.entries()].sort((a, b) => a[0] - b[0]);
      };
      expect(registers(preview.commands)).toEqual(registers(python.commands));
      expect(pcm(preview.commands).block).toEqual(pcm(python.commands).block);
      expect(preview.commands.at(-1)).toMatchObject({ action: "play", durationMs: 1500 });
      if (source === "fm") expect(preview.commands.at(-1)).toEqual(python.commands.at(-1));
    }
  });
  it("maps OP1..OP4 and all operator bitfields correctly on every FM channel", async () => {
    const { commands, packets } = await driver(`operators = []
for index in range(4):
    operators.append({"detune": index + 4, "multiple": index + 1,
        "total_level": 100 + index, "key_scale": index, "attack": 31 - index,
        "decay": 20 + index, "sustain_rate": 10 + index,
        "sustain_level": 12 + index, "release": 15 - index, "ssg_eg": 8 + index})
for channel in range(3):
    sound.fm_patch(operators, algorithm=7, feedback=6, channel=channel)`, false, true);
    expect(packets.map(packet => packet.length)).toEqual([61, 61, 61]);
    for (const [channel, command] of commands.entries()) {
      const expected = [0x28, channel];
      for (const [i, slot] of [0, 8, 4, 12].entries()) {
        const offset = channel + slot;
        expected.push(0x30 + offset, (i + 4) * 16 + i + 1, 0x40 + offset, 100 + i,
          0x50 + offset, i * 64 + 31 - i, 0x60 + offset, 20 + i,
          0x70 + offset, 10 + i, 0x80 + offset, (12 + i) * 16 + 15 - i, 0x90 + offset, 8 + i);
      }
      expected.push(0xB0 + channel, 55);
      expect(command).toEqual({ version: 1, action: "write", pairs: expected });
    }
  });

  it("changes actual FM PCM with algorithm, feedback and operator settings, and preserves score support", async () => {
    const outputs: number[][] = [];
    for (const options of ["algorithm=4, feedback=0", "algorithm=7, feedback=0", "algorithm=4, feedback=7", "algorithm=4, feedback=0, channel=1"]) {
      const channel = options.includes("channel=1") ? 1 : 0;
      const result = await driver(`ops = [{"total_level": 24} for _ in range(4)]
${channel === 1 ? 'ops[1]["multiple"] = 3' : ''}
sound.fm_patch(ops, ${options})
sound.fm_note(69, channel=${channel})`, false, true);
      const output = pcm(result.commands);
      expect(output.fm).toBeGreaterThan(0.001);
      expect(output.ssg).toBeLessThan(1e-5);
      outputs.push(output.block);
    }
    for (const output of outputs.slice(1)) {
      expect(Math.sqrt(output.reduce((sum, value, i) => sum + (value - outputs[0]![i]!) ** 2, 0) / 128)).toBeGreaterThan(0.001);
    }
    const score = await driver('sound.fm_patch([{}] * 4)\nassert sound.reserve_score(({"source":"fm", "channel":0, "notes":(60,)},)) == 600', false, true);
    expect(score.commands.at(-1)).toMatchObject({ action: "play", durationMs: 600 });
    const preset = await driver('sound.fm_patch([{"ssg_eg": 10}] * 4, channel=2)\nsound.fm_tone("soft", channel=2)', false, true);
    expect(preset.commands.at(-1)).toEqual({ version: 1, action: "write", pairs: [0x92, 0, 0x9A, 0, 0x96, 0, 0x9E, 0] });
  });

  it("packs the shared noise/envelope and changes only the selected mixer bits", async () => {
    const result = await driver(`sound.write_register(7, 255)
sound.ssg_noise(31)
sound.ssg_envelope(65535, 15)
sound.ssg_mixer(channel=0, tone=False, noise=True)
sound.ssg_mixer(channel=2, tone=True, noise=True)
sound.ssg_sound(69, channel=1, volume=5, tone=True, noise=False, envelope=True)
sound.ssg_sound(channel=0, tone=False, noise=True, volume=9)
sound.ssg_off(2)`, false, true);
    expect(result.commands.slice(0, 5)).toEqual([
      { version: 1, action: "write", pairs: [7, 255] },
      { version: 1, action: "write", pairs: [6, 31] },
      { version: 1, action: "write", pairs: [11, 255, 12, 255, 13, 15] },
      { version: 1, action: "write", pairs: [7, 247] },
      { version: 1, action: "write", pairs: [7, 211] },
    ]);
    expect(result.commands[5]).toEqual({ version: 1, action: "write", pairs: [9, 0, 2, 28, 3, 1, 7, 209, 9, 16] });
    expect(result.commands[6]).toEqual({ version: 1, action: "write", pairs: [8, 0, 7, 209, 8, 9] });
    expect(result.commands[7]).toEqual({ version: 1, action: "write", pairs: [10, 0] });
  });

  it("produces noise-only, tone-plus-noise and envelope-controlled SSG PCM", async () => {
    const outputs: number[][] = [];
    for (const script of [
      'sound.ssg_noise(8)\nsound.ssg_sound(tone=False, noise=True)',
      'sound.ssg_noise(23)\nsound.ssg_sound(tone=False, noise=True)',
      'sound.ssg_noise(8)\nsound.ssg_sound(69, noise=True)',
      'sound.ssg_envelope(500, 10)\nsound.ssg_sound(69, envelope=True)',
      'sound.ssg_envelope(5000, 12)\nsound.ssg_sound(69, envelope=True)',
    ]) {
      const output = pcm((await driver(script, false, true)).commands);
      expect(output.fm).toBeLessThan(1e-5);
      expect(output.ssg).toBeGreaterThan(0.001);
      outputs.push(output.block);
    }
    for (const output of outputs.slice(1)) {
      expect(Math.sqrt(output.reduce((sum, value, i) => sum + (value - outputs[0]![i]!) ** 2, 0) / 128)).toBeGreaterThan(0.001);
    }
  });

  it("validates every patch and SSG setting before writing, including a late invalid operator", async () => {
    const calls = ['sound.fm_patch(None)', 'sound.fm_patch([{}] * 3)', 'sound.fm_patch([{}] * 5)',
      'sound.fm_patch([{}, {}, {}, {"unknown": 1}])', 'sound.fm_patch([{}] * 4, algorithm=8)',
      'sound.fm_patch([{}] * 4, feedback=-1)', 'sound.fm_patch([{}] * 4, channel=True)',
      'sound.ssg_noise(0)', 'sound.ssg_noise(32)', 'sound.ssg_envelope(0, 10)',
      'sound.ssg_envelope(65536, 10)', 'sound.ssg_envelope(100, 16)', 'sound.ssg_mixer(channel=3)',
      'sound.ssg_mixer(tone=1)', 'sound.ssg_sound()', 'sound.ssg_sound(0)',
      'sound.ssg_sound(69, volume=16)', 'sound.ssg_sound(69, envelope=1)',
      'sound.ssg_sound(69, noise="yes")', 'sound.ssg_sound(channel=3, tone=False, noise=True)'];
    for (const [field, high] of [["detune", 7], ["multiple", 15], ["total_level", 127], ["key_scale", 3], ["attack", 31], ["decay", 31], ["sustain_rate", 31], ["sustain_level", 15], ["release", 15], ["ssg_eg", 15]] as const) {
      for (const value of [-1, high + 1, "True", "1.5"]) calls.push(`sound.fm_patch([{}, {}, {}, {"${field}": ${value}}])`);
    }
    const script = calls.map(call => `try:\n    ${call}\n    raise AssertionError('invalid value accepted')\nexcept ValueError:\n    pass`).join("\n");
    expect((await driver(script, false, true)).packets).toEqual([]);
  });
});
