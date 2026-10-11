import { isYmCommand, MAX_YM_PLAYBACK_EVENTS, MAX_YM_DURATION_MS, type YmCommand } from "./ym2203-protocol";

/** Host/worklet transport only; independent of I2C framing and runtime messages. */
export interface YmWorkletCommand {
  version: 1; type: "command"; epoch: number; sequence: number; command: YmCommand;
}
export interface YmDeliveryState {
  epoch: number; sent: number; accepted: number; rendered: number;
}
export interface YmReceipt {
  version: 1; type: "accepted"; epoch: number; sequence: number;
}
export interface AudioMeter {
  version: 1; type: "meter"; epoch: number; sequence: number;
  active: boolean; frame: number; pending: number; applied: number;
  state: "idle" | "playing" | "completed" | "stopped";
  mode: "idle" | "immediate" | "scheduled";
  elapsedMs: number; durationMs: number; total: number;
  fmRms: number; ssgRms: number; rms: number; peak: number;
}
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function isYmWorkletCommand(value: unknown): value is YmWorkletCommand {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && v.type === "command" && counter(v.epoch) && counter(v.sequence) && v.sequence > 0 && isYmCommand(v.command);
}
export function isYmReceipt(value: unknown): value is YmReceipt {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && v.type === "accepted" && counter(v.epoch) && counter(v.sequence) && v.sequence > 0;
}
export function isAudioMeter(value: unknown): value is AudioMeter {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && v.type === "meter" && counter(v.epoch) && counter(v.sequence)
    && counter(v.frame) && counter(v.pending) && counter(v.applied) && counter(v.total)
    && (v.total as number) <= MAX_YM_PLAYBACK_EVENTS && (v.pending as number) + (v.applied as number) <= (v.total as number)
    && ["idle", "playing", "completed", "stopped"].includes(v.state as string)
    && ["idle", "immediate", "scheduled"].includes(v.mode as string)
    && typeof v.active === "boolean" && v.active === (v.state === "playing")
    && ["elapsedMs", "durationMs", "fmRms", "ssgRms", "rms", "peak"].every(key => typeof v[key] === "number" && Number.isFinite(v[key]) && (v[key] as number) >= 0)
    && (v.elapsedMs as number) <= (v.durationMs as number) && (v.durationMs as number) <= MAX_YM_DURATION_MS;
}

/** Counters are cumulative per stop epoch; a meter is never an implicit blanket ACK. */
export class YmDeliveryTracker {
  #epoch = 0;
  #sent = 0;
  #accepted = 0;
  #rendered = 0;
  #frame = -1;
  get state(): YmDeliveryState { return { epoch: this.#epoch, sent: this.#sent, accepted: this.#accepted, rendered: this.#rendered }; }
  get pendingAcceptance(): number { return this.#sent - this.#accepted; }
  reset(): void { this.#epoch++; this.#sent = this.#accepted = this.#rendered = 0; this.#frame = -1; }
  submit(command: YmCommand): YmWorkletCommand {
    return { version: 1, type: "command", epoch: this.#epoch, sequence: ++this.#sent, command };
  }
  accept(receipt: YmReceipt): boolean {
    if (receipt.epoch !== this.#epoch || receipt.sequence <= this.#accepted || receipt.sequence > this.#sent) return false;
    this.#accepted = receipt.sequence; return true;
  }
  render(meter: AudioMeter): boolean {
    if (meter.epoch !== this.#epoch || meter.sequence < this.#rendered || meter.sequence > this.#accepted || meter.frame < this.#frame) return false;
    this.#rendered = meter.sequence; this.#frame = meter.frame;
    // Even a valid old meter cannot overwrite a newer command's pending display.
    return meter.sequence === this.#sent;
  }
}
