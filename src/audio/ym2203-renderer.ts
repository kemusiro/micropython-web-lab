import { isYmCommand, MAX_YM_DURATION_MS, type YmCommand } from "./ym2203-protocol";

// The core's /32768 PCM scaling leaves typical patches well below full scale.
// Calibrate the virtual output stage rather than changing chip total levels.
const OUTPUT_GAIN = 4;
const OUTPUT_CEILING = 0.95;

export interface YmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  fm_init(rate: number): void;
  fm_write(reg: number, value: number): void;
  fm_buffer(): number;
  fm_render(count: number): void;
}

/** No DOM, clocks, timers or asynchronous work. Rendering owns the sample clock. */
export class YmRenderer {
  readonly #fm: Float32Array;
  readonly #ssg: Float32Array;
  readonly #dc: number;
  readonly #limiterRelease: number;
  #events: number[] = [];
  #cursor = 0;
  #start = 0;
  #end = 0;
  #active = false;
  #mode: "idle" | "immediate" | "scheduled" = "idle";
  #state: "idle" | "playing" | "completed" | "stopped" = "idle";
  #durationMs = 0;
  #total = 0;
  #loopMs = 0;
  #cycle = 0;
  #gain = 0.5;
  #previousFm = 0;
  #previousSsg = 0;
  #filteredFm = 0;
  #filteredSsg = 0;
  #peakEnvelope = 0;
  frame = 0;
  appliedEvents = 0;
  fmRms = 0;
  ssgRms = 0;
  rms = 0;
  peak = 0;
  constructor(readonly core: YmExports, readonly rate: number) {
    core.fm_init(rate);
    this.#fm = new Float32Array(core.memory.buffer, core.fm_buffer(), 128);
    this.#ssg = new Float32Array(core.memory.buffer, core.fm_buffer() + 128 * 4, 128);
    this.#dc = Math.exp(-2 * Math.PI * 5 / rate);
    this.#limiterRelease = Math.exp(-1 / (0.05 * rate));
  }
  get active(): boolean { return this.#active; }
  get pendingEvents(): number { return this.#active ? this.#total - this.appliedEvents : 0; }
  get playback() {
    return { state: this.#state, mode: this.#mode, durationMs: this.#durationMs, total: this.#total,
      elapsedMs: this.#mode === "idle" ? 0 : Math.min(this.#durationMs, (this.frame - this.#start) * 1000 / this.rate) };
  }
  command(command: YmCommand): void {
    if (!isYmCommand(command)) throw new TypeError("Invalid audio command.");
    switch (command.action) {
      case "stop": this.stop(); break;
      case "gain": this.#gain = command.percent / 100; break;
      case "write":
        for (let i = 0; i < command.pairs.length; i += 2) this.core.fm_write(command.pairs[i]!, command.pairs[i + 1]!);
        if (!this.#active) { this.#mode = "immediate"; this.#start = this.frame; this.appliedEvents = this.#total = 0; }
        this.#active = true;
        this.#state = "playing";
        // Immediate notes also have a hard playback deadline, independent of Python.
        // A patch/volume register write during a reservation must not extend it.
        if (this.#mode === "immediate") {
          this.#end = this.frame + Math.ceil(MAX_YM_DURATION_MS * this.rate / 1000);
          this.#start = this.frame; this.#durationMs = MAX_YM_DURATION_MS;
        }
        break;
      case "play":
        this.#events = command.events;
        this.#cursor = 0;
        this.#cycle = 0; this.#loopMs = command.loopMs ?? 0;
        this.#start = this.frame;
        this.#end = this.frame + Math.ceil(command.durationMs * this.rate / 1000);
        this.appliedEvents = 0;
        this.#active = true;
        this.#mode = "scheduled"; this.#state = "playing";
        this.#durationMs = command.durationMs; this.#total = command.events.length / 3;
        if (this.#loopMs) {
          this.#total = 0;
          const cycles = Math.ceil(command.durationMs / this.#loopMs);
          for (let i = 0; i < command.events.length; i += 3) this.#total += Math.min(cycles, 1 + Math.floor((command.durationMs - command.events[i]!) / this.#loopMs));
        }
        break;
    }
  }
  stop(state: "stopped" | "completed" = "stopped"): void {
    this.#active = false;
    this.#events = [];
    this.#cursor = 0;
    this.#loopMs = this.#cycle = 0;
    this.#state = state;
    if (state === "stopped") { this.#mode = "idle"; this.#durationMs = 0; this.appliedEvents = this.#total = 0; }
    this.core.fm_init(this.rate);
    this.#previousFm = this.#previousSsg = this.#filteredFm = this.#filteredSsg = 0;
    this.#peakEnvelope = 0;
    this.fmRms = this.ssgRms = this.rms = this.peak = 0;
  }
  render(output: Float32Array): void {
    let offset = 0, fmEnergy = 0, ssgEnergy = 0, energy = 0, peak = 0;
    while (offset < output.length) {
      while (this.#active) {
        if (this.#cursor >= this.#events.length) {
          if (this.nextCycleFrame() > this.frame) break;
          this.#cycle++; this.#cursor = 0;
        }
        if (this.eventFrame() > this.frame) break;
        this.core.fm_write(this.#events[this.#cursor + 1]!, this.#events[this.#cursor + 2]!);
        this.#cursor += 3;
        this.appliedEvents++;
      }
      if (this.#active && this.frame >= this.#end) this.stop("completed");
      if (!this.#active) { output.fill(0, offset); this.frame += output.length - offset; break; }
      let count = Math.min(128, output.length - offset, this.#end - this.frame);
      const next = this.#cursor < this.#events.length ? this.eventFrame() : this.nextCycleFrame();
      count = Math.min(count, next - this.frame);
      this.core.fm_render(count);
      for (let i = 0; i < count; i++) {
        const fm = this.#fm[i]!, ssg = this.#ssg[i]!;
        this.#filteredFm = fm - this.#previousFm + this.#dc * this.#filteredFm;
        this.#filteredSsg = ssg - this.#previousSsg + this.#dc * this.#filteredSsg;
        this.#previousFm = fm; this.#previousSsg = ssg;
        const mixed = (this.#filteredFm + this.#filteredSsg) * this.#gain * OUTPUT_GAIN;
        // Instant attack, 50 ms release. Reduce gain across the waveform instead
        // of hard-clipping loud six-channel peaks. Quiet patches stay linear.
        this.#peakEnvelope = Math.max(Math.abs(mixed), this.#peakEnvelope * this.#limiterRelease);
        const value = mixed * Math.min(1, OUTPUT_CEILING / Math.max(OUTPUT_CEILING, this.#peakEnvelope));
        output[offset + i] = value;
        fmEnergy += this.#filteredFm ** 2;
        ssgEnergy += this.#filteredSsg ** 2;
        energy += value ** 2;
        peak = Math.max(peak, Math.abs(value));
      }
      offset += count; this.frame += count;
    }
    this.fmRms = Math.sqrt(fmEnergy / output.length);
    this.ssgRms = Math.sqrt(ssgEnergy / output.length);
    this.rms = Math.sqrt(energy / output.length);
    this.peak = peak;
  }
  private eventFrame(): number { return this.#start + Math.round((this.#cycle * this.#loopMs + this.#events[this.#cursor]!) * this.rate / 1000); }
  private nextCycleFrame(): number {
    const ms = (this.#cycle + 1) * this.#loopMs;
    return this.#loopMs && ms < this.#durationMs ? this.#start + Math.round(ms * this.rate / 1000) : Infinity;
  }
}

export function instantiateYmCore(module: WebAssembly.Module): YmExports {
  const instance = new WebAssembly.Instance(module, {});
  const core = instance.exports as YmExports;
  core._initialize();
  return core;
}
