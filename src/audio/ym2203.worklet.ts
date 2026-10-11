import { instantiateYmCore, YmRenderer } from "./ym2203-renderer";
import { isYmWorkletCommand } from "./ym2203-delivery";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor(); }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class Ym2203Processor extends AudioWorkletProcessor {
  readonly renderer: YmRenderer;
  #reportFrames = 0;
  #epoch = 0;
  #sequence = 0;
  constructor(options: { processorOptions: { module: WebAssembly.Module } }) {
    super();
    this.renderer = new YmRenderer(instantiateYmCore(options.processorOptions.module), sampleRate);
    this.port.onmessage = ({ data }) => {
      if (!isYmWorkletCommand(data) || data.epoch < this.#epoch || (data.epoch === this.#epoch && data.sequence !== this.#sequence + 1)
        || (data.epoch > this.#epoch && (data.sequence !== 1 || data.command.action !== "stop"))) {
        this.renderer.stop(); this.port.postMessage({ type: "fault", message: "Invalid audio command or order" }); return;
      }
      try {
        this.renderer.command(data.command);
        this.#epoch = data.epoch; this.#sequence = data.sequence;
        this.port.postMessage({ version: 1, type: "accepted", epoch: this.#epoch, sequence: this.#sequence });
      } catch {
        this.renderer.stop(); this.port.postMessage({ type: "fault", message: "Audio command failed" });
      }
    };
    this.port.postMessage({ type: "ready", sampleRate });
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channel = outputs[0]?.[0];
    if (!channel) return true;
    this.renderer.render(channel);
    this.#reportFrames += channel.length;
    if (this.#reportFrames >= sampleRate / 10) {
      this.#reportFrames = 0;
      this.port.postMessage({ version: 1, type: "meter", epoch: this.#epoch, sequence: this.#sequence,
        ...this.renderer.playback, active: this.renderer.active, frame: this.renderer.frame,
        pending: this.renderer.pendingEvents, applied: this.renderer.appliedEvents,
        fmRms: this.renderer.fmRms, ssgRms: this.renderer.ssgRms,
        rms: this.renderer.rms, peak: this.renderer.peak });
    }
    return true;
  }
}
registerProcessor("ym2203-prototype", Ym2203Processor as unknown as typeof AudioWorkletProcessor);
