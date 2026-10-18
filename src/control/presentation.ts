import { CONTROL_ROW_WIDTH, sameIdentity, validateTelemetry, type ArmTelemetry, type ControlIdentity } from "./channel";
import type { ArmControlConditions } from "../physics/arm-control";

export const ARM_EXTRA_SERIES = ["speed", "acceleration", "torque", "gravity"] as const;
export type ArmExtraSeries = typeof ARM_EXTRA_SERIES[number];
export const DEFAULT_ARM_SERIES: readonly ArmExtraSeries[] = ["torque"];
export function snapshotArmSeries(value: unknown): ArmExtraSeries[] {
  if (!Array.isArray(value) || value.length > ARM_EXTRA_SERIES.length ||
      Array.from(value).some(entry => !ARM_EXTRA_SERIES.includes(entry)) || new Set(value).size !== value.length) throw new Error("Invalid arm view series");
  return [...value];
}
export interface ArmSample {
  readonly tick: number; readonly angle: number; readonly speed: number; readonly acceleration: number | null;
  readonly requestedTorque: number; readonly appliedTorque: number; readonly gravity: number;
  readonly saturated: boolean; readonly contact: boolean;
}
/** A bounded presentation copy. It can contain gaps; it never advances the model. */
export class ArmRecording {
  #identity: ControlIdentity | undefined;
  #sequence = 0;
  readonly #samples = new Map<number, ArmSample>();
  accept(value: ArmTelemetry): void {
    const frame = validateTelemetry(value, 1001);
    if (this.#identity && (!sameIdentity(this.#identity, frame.identity) || frame.sequence <= this.#sequence)) throw new Error("Obsolete arm display frame");
    this.#identity = { ...frame.identity }; this.#sequence = frame.sequence;
    for (let tick = frame.firstTick; tick <= frame.lastTick; tick++) {
      const offset = (tick - frame.firstTick) * CONTROL_ROW_WIDTH, row = frame.rows;
      const flags = row[offset + 9]!;
      this.#samples.set(tick, { tick, angle: row[offset]!, speed: row[offset + 1]!, acceleration: flags & 1 ? row[offset + 2]! : null,
        gravity: row[offset + 4]!, requestedTorque: row[offset + 7]!, appliedTorque: row[offset + 8]!, saturated: !!(flags & 2), contact: !!(flags & 12) });
    }
  }
  samples(): ArmSample[] { return [...this.#samples.values()].sort((a, b) => a.tick - b.tick).map(sample => ({ ...sample })); }
}
export function armMetrics(samples: readonly ArmSample[], conditions: ArmControlConditions) {
  const direction = Math.sign(conditions.targetAngleRad - conditions.initialAngleRad);
  return {
    overshoot: !direction || !samples.length ? null : Math.max(0, ...samples.map(sample => direction * (sample.angle - conditions.targetAngleRad))),
    finalError: samples.length ? conditions.targetAngleRad - samples.at(-1)!.angle : null,
    saturatedIntervals: samples.filter(sample => sample.tick > 0 && sample.saturated).length,
    contactIntervals: samples.filter(sample => sample.tick > 0 && sample.contact).length,
  };
}
/** Paths use viewBox coordinates, never user-provided SVG markup. Missing ticks break the line.
 * Torque at row n is held over [n-1,n), so its path is a stair, not a state sample at n. */
export function armPlotPath(samples: readonly ArmSample[], value: (sample: ArmSample) => number | null,
  x: (tick: number) => number, y: (value: number) => number, intervals = false): string {
  let previous: ArmSample | undefined;
  let path = "";
  for (const sample of samples) {
    const v = value(sample);
    if (v === null || (intervals && sample.tick === 0)) { previous = undefined; continue; }
    const contiguous = previous && previous.tick + 1 === sample.tick;
    if (intervals) {
      path += `${contiguous ? "L" : "M"}${x(sample.tick - 1)},${y(v)}L${x(sample.tick)},${y(v)}`;
    } else path += `${contiguous ? "L" : "M"}${x(sample.tick)},${y(v)}`;
    previous = sample;
  }
  return path;
}
