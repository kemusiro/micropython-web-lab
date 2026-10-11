// Informational native-core timing, not a real-time/browser acceptance threshold.
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const binary = await readFile(new URL("../src/vendor/ymfm-build/ym2203.wasm", import.meta.url));
const module = await WebAssembly.compile(binary);
const core = new WebAssembly.Instance(module, {}).exports;
core._initialize(); core.fm_init(48000);
for (let channel = 0; channel < 3; channel++) {
  for (const slot of [0, 4, 8, 12]) {
    for (const [reg, value] of [[0x30, 1], [0x40, 24], [0x50, 31], [0x60, 8], [0x70, 0], [0x80, 0x47]]) core.fm_write(reg + slot + channel, value);
  }
  core.fm_write(0xB0 + channel, 4); core.fm_write(0xA4 + channel, 0x24); core.fm_write(0xA0 + channel, 14 + channel * 50);
  core.fm_write(0x28, 0xF0 | channel);
  core.fm_write(channel * 2, 128 + channel * 50); core.fm_write(channel * 2 + 1, 1); core.fm_write(8 + channel, 12);
}
core.fm_write(7, 0x38);
for (let i = 0; i < 300; i++) core.fm_render(128);
const times = [];
for (let i = 0; i < 3000; i++) { const start = performance.now(); core.fm_render(128); times.push(performance.now() - start); }
const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
times.sort((a, b) => a - b);
console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, node: process.version,
  wasmBytes: binary.length, memoryBytes: core.memory.buffer.byteLength, sampleRate: 48000,
  voices: "3 FM + 3 SSG", blocks: times.length, framesPerBlock: 128,
  blockBudgetMs: 128 / 48000 * 1000, meanRenderMs: mean, p95RenderMs: times[Math.floor(times.length * .95)],
  maxRenderMs: times.at(-1), scope: "WASM core only in Node; excludes AudioWorklet/JS mixing, browser/OS and device latency" }, null, 2));
