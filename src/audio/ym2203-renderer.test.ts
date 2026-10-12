import { describe, expect, it } from "vitest";
import { instantiateYmCore, YmRenderer, type YmExports } from "./ym2203-renderer";
import { isYmCommand, MAX_YM_EVENTS, MAX_YM_DURATION_MS } from "./ym2203-protocol";
import { isWorkerToMainMessage, RUNTIME_PROTOCOL_VERSION } from "../runtime/protocol";

// Tests run in Node; keep Node ambient types out of the browser TypeScript project.
const fsSpecifier = "node:fs";
const { readFileSync } = await import(fsSpecifier) as { readFileSync(path: URL): Uint8Array<ArrayBuffer> };
const wasm = readFileSync(new URL("../vendor/ymfm-build/ym2203.wasm", import.meta.url));
const module = new WebAssembly.Module(wasm);
function core() { return instantiateYmCore(module); }
function fmPairs(algorithm = 4) {
  const pairs: number[] = [];
  for (const slot of [0, 4, 8, 12]) pairs.push(0x30 + slot, 1, 0x40 + slot, slot < 8 ? 40 : 20, 0x50 + slot, 31, 0x60 + slot, 10, 0x70 + slot, 2, 0x80 + slot, 0x47);
  return [...pairs, 0xB0, algorithm, 0xA4, 0x24, 0xA0, 0x0E, 0x28, 0xF0]; // ~440 Hz
}
function tone(renderer: YmRenderer, pairs: number[]) {
  renderer.command({ version: 1, action: "write", pairs });
  const output = new Float32Array(128);
  let energy = 0;
  for (let i = 0; i < 80; i++) { renderer.render(output); for (const sample of output) { expect(Number.isFinite(sample)).toBe(true); expect(Math.abs(sample)).toBeLessThanOrEqual(1); energy += sample ** 2; } }
  return Math.sqrt(energy / (80 * 128));
}
describe("pinned YM2203 WASM audio", () => {
  it.each([44100, 48000])("avoids excessive attenuation of a single FM or SSG voice at %i Hz", rate => {
    for (const pairs of [fmPairs(), [0, 0x1C, 1, 1, 7, 0x3E, 8, 11]]) {
      expect(tone(new YmRenderer(core(), rate), pairs)).toBeGreaterThan(0.02);
    }
  });
  it("scales quiet voices linearly with I2C volume and silences at zero", () => {
    const rms = [0, 25, 50, 100].map(percent => {
      const renderer = new YmRenderer(core(), 48000);
      renderer.command({ version: 1, action: "gain", percent });
      return tone(renderer, fmPairs());
    });
    expect(rms[0]).toBe(0);
    expect(rms[2]! / rms[1]!).toBeCloseTo(2, 5);
    expect(rms[3]! / rms[1]!).toBeCloseTo(4, 5);
  });
  it.each([44100, 48000])("limits maximum six-channel peaks at %i Hz", rate => {
    const pairs: number[] = [7, 0x38];
    for (let channel = 0; channel < 3; channel++) {
      for (const slot of [0, 4, 8, 12]) pairs.push(0x30 + slot + channel, 1, 0x40 + slot + channel, 0, 0x50 + slot + channel, 31, 0x60 + slot + channel, 0, 0x70 + slot + channel, 0, 0x80 + slot + channel, 0x07);
      pairs.push(0xB0 + channel, 7, 0xA4 + channel, 0x24, 0xA0 + channel, 14 + channel * 50, 0x28, 0xF0 | channel,
        channel * 2, 0x1C + channel * 50, channel * 2 + 1, 1, 8 + channel, 15);
    }
    const renderer = new YmRenderer(core(), rate);
    renderer.command({ version: 1, action: "gain", percent: 100 });
    renderer.command({ version: 1, action: "write", pairs });
    const block = new Float32Array(128);
    let peak = 0;
    for (let i = 0; i < 750; i++) {
      renderer.render(block);
      for (const sample of block) {
        expect(Number.isFinite(sample)).toBe(true);
        expect(Math.abs(sample)).toBeLessThanOrEqual(0.950001);
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    expect(peak).toBeGreaterThan(0.94);
    renderer.stop(); renderer.render(block);
    expect(block.every(sample => sample === 0)).toBe(true);
  });
  it("releases limiting gradually, but clears its history on stop", () => {
    const actual = core();
    const fm = new Float32Array(actual.memory.buffer, actual.fm_buffer(), 128);
    const ssg = new Float32Array(actual.memory.buffer, actual.fm_buffer() + 512, 128);
    let level = 1;
    // A deterministic signal isolates output-stage history from chip reset phase.
    const signal = { ...actual, fm_render(count: number) {
      for (let i = 0; i < count; i++) { fm[i] = i % 2 ? level : -level; ssg[i] = 0; }
    } } as YmExports;
    const renderer = new YmRenderer(signal, 48000);
    renderer.command({ version: 1, action: "gain", percent: 100 });
    renderer.command({ version: 1, action: "write", pairs: [7, 0x3F] });
    const block = new Float32Array(128);
    renderer.render(block);
    level = 0.01;
    renderer.render(block);
    expect(renderer.rms).toBeLessThan(0.015);
    for (let i = 0; i < 100; i++) renderer.render(block);
    expect(renderer.rms).toBeGreaterThan(0.039);
    level = 1; renderer.render(block);
    renderer.stop();
    level = 0.01;
    renderer.command({ version: 1, action: "write", pairs: [7, 0x3F] });
    renderer.render(block);
    expect(renderer.rms).toBeGreaterThan(0.039);
  });
  it.each([44100, 48000])("produces FM, SSG and mixed sound at %i Hz", rate => {
    const renderer = new YmRenderer(core(), rate);
    expect(tone(renderer, fmPairs())).toBeGreaterThan(0.001);
    expect(renderer.fmRms).toBeGreaterThan(0.001);
    expect(renderer.ssgRms).toBeLessThan(1e-5);
    renderer.stop();
    expect(tone(renderer, [0, 0x1C, 1, 1, 7, 0x3E, 8, 12])).toBeGreaterThan(0.001);
    expect(renderer.fmRms).toBeLessThan(1e-5);
    expect(renderer.ssgRms).toBeGreaterThan(0.001);
    expect(tone(renderer, fmPairs())).toBeGreaterThan(0.001);
    expect(renderer.fmRms).toBeGreaterThan(0.001);
    expect(renderer.ssgRms).toBeGreaterThan(0.001);
    renderer.stop();
    const silence = new Float32Array(128).fill(1);
    renderer.render(silence);
    expect(silence.every(sample => sample === 0)).toBe(true);
  });
  it("changes actual generated PCM when the FM algorithm changes", () => {
    const first = new YmRenderer(core(), 48000), second = new YmRenderer(core(), 48000);
    tone(first, fmPairs(4)); tone(second, fmPairs(7));
    const a = new Float32Array(128), b = new Float32Array(128);
    first.render(a); second.render(b);
    const difference = a.reduce((sum, value, i) => sum + (value - b[i]!) ** 2, 0);
    expect(Math.sqrt(difference / a.length)).toBeGreaterThan(0.0001);
  });
  it("keeps an immediate note past the old deadline and stops at the uint32 deadline", () => {
    const renderer = new YmRenderer(core(), 48000);
    renderer.command({ version: 1, action: "write", pairs: fmPairs() });
    const block = new Float32Array(128);
    for (let i = 0; i <= 3000; i++) renderer.render(block);
    expect(renderer.active).toBe(true);
    renderer.frame = Math.ceil(MAX_YM_DURATION_MS * 48);
    renderer.render(block);
    expect(renderer.active).toBe(false);
    expect(block.every(value => value === 0)).toBe(true);
  });
  it("requires no WASI imports and uses fixed 2 MiB memory", () => {
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    expect(core().memory.buffer.byteLength).toBe(2 * 1024 * 1024);
  });
});
it("applies same-time writes in order at exact sample boundaries, then cancels on stop", () => {
  const actual = core(), writes: [number, number, number][] = [];
  let renderer: YmRenderer;
  const wrapped = { ...actual, fm_write(reg: number, value: number) { writes.push([renderer.frame, reg, value]); actual.fm_write(reg, value); } } as YmExports;
  renderer = new YmRenderer(wrapped, 48000);
  renderer.command({ version: 1, action: "play", events: [1, 0x28, 0, 1, 0x28, 0xF0, 3, 0x28, 0], durationMs: 4 });
  renderer.render(new Float32Array(256));
  expect(writes).toEqual([[48, 0x28, 0], [48, 0x28, 0xF0], [144, 0x28, 0]]);
  expect(renderer.active).toBe(false);
  renderer.command({ version: 1, action: "play", events: [100, 0x28, 0xF0], durationMs: 200 });
  renderer.stop(); renderer.render(new Float32Array(8192));
  expect(writes).toHaveLength(3);
});
it("rejects invalid audio messages at both protocol boundaries", () => {
  const valid = { version: 1, action: "play", events: [0, 0x28, 0xF0], durationMs: 100 };
  expect(isYmCommand(valid)).toBe(true);
  expect(isWorkerToMainMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "prototype-audio", command: valid })).toBe(true);
  for (const bad of [{ ...valid, version: 2 }, { ...valid, events: [MAX_YM_DURATION_MS + 1, 0, 0] }, { ...valid, durationMs: 0 }, { ...valid, durationMs: MAX_YM_DURATION_MS + 1 }, { ...valid, loopMs: 99 }, { ...valid, loopMs: 101 }, { ...valid, events: [1, 0, 0, 0, 0, 0] }, { ...valid, events: new Array((MAX_YM_EVENTS + 1) * 3).fill(0) }, { version: 1, action: "write", pairs: [0, 256] }, { version: 1, action: "gain", percent: NaN }]) {
    expect(isYmCommand(bad)).toBe(false);
    expect(isWorkerToMainMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "prototype-audio", command: bad })).toBe(false);
  }
});

it.each([44100, 48000, 96000])("handles a 24-hour reservation and large absolute frame clocks at %i Hz", rate => {
  const actual = core(), writes: number[] = [];
  let renderer: YmRenderer;
  const wrapped = { ...actual, fm_write(reg: number, value: number) { writes.push(renderer.frame); actual.fm_write(reg, value); } } as YmExports;
  renderer = new YmRenderer(wrapped, rate);
  const start = 2 ** 32 + 128, day = 86_400_000;
  renderer.frame = start;
  renderer.command({ version: 1, action: "play", durationMs: day, events: [0, 8, 11, day - 1, 8, 0] });
  renderer.render(new Float32Array(128));
  renderer.frame = start + Math.ceil(day * rate / 1000) - 192;
  renderer.render(new Float32Array(256));
  expect(writes).toEqual([start, start + Math.round((day - 1) * rate / 1000)]);
  expect(renderer.playback).toMatchObject({ state: "completed", elapsedMs: day, durationMs: day, total: 2 });
  expect(renderer.pendingEvents).toBe(0);
});

it.each([44100, 48000])("loops with the same PCM and event order as an expanded score at %i Hz", rate => {
  const looping = new YmRenderer(core(), rate), expanded = new YmRenderer(core(), rate);
  const events = [0, 8, 11, 50, 8, 0, 101, 8, 7], all: number[] = [];
  for (let cycle = 0; cycle < 3; cycle++) for (let i = 0; i < events.length; i += 3) all.push(cycle * 101 + events[i]!, events[i + 1]!, events[i + 2]!);
  for (const renderer of [looping, expanded]) renderer.command({ version: 1, action: "write", pairs: [0, 28, 1, 1, 7, 62] });
  looping.command({ version: 1, action: "play", events, durationMs: 303, loopMs: 101 });
  expanded.command({ version: 1, action: "play", events: all, durationMs: 303 });
  const a = new Float32Array(128), b = new Float32Array(128);
  while (looping.active) { looping.render(a); expanded.render(b); expect(a).toEqual(b); }
  expect(looping.appliedEvents).toBe(9);
  expect(looping.playback).toEqual(expanded.playback);
  expect(looping.pendingEvents).toBe(0);
});

it("counts a full 24-hour loop without expanding its queue and cancels repeated events on stop", () => {
  const renderer = new YmRenderer(core(), 48000), day = 86_400_000, period = day / 4;
  renderer.command({ version: 1, action: "play", events: [0, 8, 11, period, 8, 0], durationMs: day, loopMs: period });
  expect(renderer.pendingEvents).toBe(8);
  renderer.frame = day * 48 - 128; // Accelerate the sample clock; do not wait 24 wall-clock hours.
  renderer.render(new Float32Array(256));
  expect(renderer.appliedEvents).toBe(8);
  expect(renderer.playback.state).toBe("completed");
  renderer.command({ version: 1, action: "play", events: [0, 8, 11], durationMs: day, loopMs: 100 });
  expect(renderer.playback.total).toBe(864000);
  renderer.stop(); renderer.frame += day * 48;
  const block = new Float32Array(128); renderer.render(block);
  expect(block.every(sample => sample === 0)).toBe(true);
  expect(renderer.appliedEvents).toBe(0);
});

it.each([44100, 48000])("replaces outstanding events and uses the new deadline at %i Hz", rate => {
  const actual = core(), writes: [number, number, number][] = [];
  let renderer: YmRenderer;
  const wrapped = { ...actual, fm_write(reg: number, value: number) { writes.push([renderer.frame, reg, value]); actual.fm_write(reg, value); } } as YmExports;
  renderer = new YmRenderer(wrapped, rate);
  renderer.command({ version: 1, action: "play", events: [0, 8, 11, 20, 8, 0, 45, 8, 7], durationMs: 50 });
  renderer.render(new Float32Array(Math.round(rate * 0.01)));
  const start = renderer.frame;
  renderer.command({ version: 1, action: "play", events: [0, 8, 12, 10, 8, 0], durationMs: 15 });
  renderer.render(new Float32Array(Math.round(rate * 0.06)));
  expect(writes).toEqual([[0, 8, 11], [start, 8, 12], [start + Math.round(rate * 0.01), 8, 0]]);
  expect(renderer.playback).toEqual({ state: "completed", mode: "scheduled", durationMs: 15, total: 2, elapsedMs: 15 });
  expect(renderer.appliedEvents).toBe(2);
  expect(renderer.pendingEvents).toBe(0);
});
it("does not extend a scheduled deadline when immediate register settings change", () => {
  const renderer = new YmRenderer(core(), 48000);
  renderer.command({ version: 1, action: "play", events: [0, 8, 12, 30, 8, 0], durationMs: 40 });
  renderer.render(new Float32Array(960));
  renderer.command({ version: 1, action: "write", pairs: [6, 12] });
  renderer.render(new Float32Array(961));
  expect(renderer.active).toBe(false);
  expect(renderer.playback).toMatchObject({ state: "completed", durationMs: 40, total: 2, elapsedMs: 40 });
  expect(renderer.appliedEvents).toBe(2);
  renderer.stop();
  expect(renderer.playback).toEqual({ state: "stopped", mode: "idle", durationMs: 0, total: 0, elapsedMs: 0 });
  expect(renderer.appliedEvents).toBe(0);
});
it("repeats reservations without carrying events or audio/filter history across completion", () => {
  const renderer = new YmRenderer(core(), 48000);
  const blocks: Float32Array[] = [];
  for (let i = 0; i < 8; i++) {
    renderer.command({ version: 1, action: "write", pairs: [0, 0x1C, 1, 1, 7, 0x3E, 8, 0] });
    renderer.command({ version: 1, action: "play", events: [0, 8, 11, 15, 8, 0], durationMs: 20 });
    const block = new Float32Array(1100); renderer.render(block); blocks.push(block);
    expect(renderer.playback.state).toBe("completed");
    expect(renderer.appliedEvents).toBe(2);
    expect(block.slice(960).every(value => value === 0)).toBe(true);
  }
  for (const block of blocks) expect(block).toEqual(blocks[0]);
});
