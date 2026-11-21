import { snapshotArmControlConditions, type ArmControlConditions } from "../physics/arm-control";
import { ARM_MODEL, ARM_MAX_TICKS, type ArmObservation, type ArmInterval } from "../physics/one-axis-arm";

export const CONTROL_VERSION = 1 as const;
export const CONTROL_STEP_TIMEOUT_MS = 1_000;
export const CONTROL_START_TIMEOUT_MS = 10_000;
export const CONTROL_SERIES = ["angleRad", "angularVelocityRadPerS", "accelerationRadPerS2", "unconstrainedAccelerationRadPerS2",
  "gravityTorqueNm", "viscousTorqueNm", "mechanicalEnergyJ", "requestedTorqueNm", "appliedTorqueNm", "flags", "atLowerStop", "atUpperStop"] as const;
export const CONTROL_ROW_WIDTH = CONTROL_SERIES.length;
export const CONTROL_BYTES = 72 + (ARM_MAX_TICKS + 1) * CONTROL_ROW_WIDTH * 8;
export const CONTROL_HEADER = { magic: 0, version: 1, generation: 2, request: 3, complete: 4, cancel: 5, fault: 6, tick: 7, ready: 8 } as const;
const MAGIC = 0x574c4131;
export interface ControlIdentity { readonly setId: string; readonly generation: number; readonly runId: string }
export interface ArmRuntimeProfile {
  readonly kind: "arm"; readonly version: typeof CONTROL_VERSION;
  readonly identity: ControlIdentity; readonly conditions: ArmControlConditions; readonly buffer: SharedArrayBuffer;
}
export function snapshotIdentity(value: unknown): ControlIdentity {
  const v = value as ControlIdentity;
  if (!v || ![v.setId, v.runId].every(text => typeof text === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(text)) ||
      !Number.isSafeInteger(v.generation) || v.generation < 1 || v.generation > 0x7fffffff) throw new Error("Invalid control identity");
  return { setId: v.setId, generation: v.generation, runId: v.runId };
}
export function sameIdentity(a: ControlIdentity, b: ControlIdentity): boolean {
  return a.setId === b.setId && a.generation === b.generation && a.runId === b.runId;
}
export function snapshotArmProfile(value: unknown): ArmRuntimeProfile {
  const v = value as ArmRuntimeProfile;
  if (!v || v.kind !== "arm" || v.version !== CONTROL_VERSION) throw new Error("Unsupported model runtime profile");
  const identity = snapshotIdentity(v.identity), conditions = snapshotArmControlConditions(v.conditions);
  SharedArmChannel.attach(v.buffer, identity.generation);
  return { kind: "arm", version: CONTROL_VERSION, identity, conditions, buffer: v.buffer };
}

/** Single writer for commands (Python Worker), single writer for observations (Simulation Worker).
 * Complete rows are immutable. Atomics publish each prefix only after its Float64 writes. */
export class SharedArmChannel {
  readonly controls: Int32Array;
  readonly #command: Float64Array;
  readonly #rows: Float64Array;
  private constructor(readonly buffer: SharedArrayBuffer, readonly generation: number) {
    this.controls = new Int32Array(buffer, 0, 16);
    this.#command = new Float64Array(buffer, 64, 1);
    this.#rows = new Float64Array(buffer, 72);
  }
  static create(generation: number): SharedArmChannel {
    snapshotIdentity({ setId: "channel", runId: "channel", generation });
    if (typeof SharedArrayBuffer === "undefined") throw new Error("SharedArrayBuffer is required for arm control");
    const channel = new SharedArmChannel(new SharedArrayBuffer(CONTROL_BYTES), generation);
    Atomics.store(channel.controls, CONTROL_HEADER.magic, MAGIC);
    Atomics.store(channel.controls, CONTROL_HEADER.version, CONTROL_VERSION);
    Atomics.store(channel.controls, CONTROL_HEADER.generation, generation);
    return channel;
  }
  static attach(buffer: SharedArrayBuffer, generation: number): SharedArmChannel {
    if (typeof SharedArrayBuffer === "undefined" || !(buffer instanceof SharedArrayBuffer) || buffer.byteLength !== CONTROL_BYTES) throw new Error("Invalid arm shared memory size");
    const channel = new SharedArmChannel(buffer, generation); channel.validate(); return channel;
  }
  validate(): void {
    const h = CONTROL_HEADER;
    if (Atomics.load(this.controls, h.magic) !== MAGIC || Atomics.load(this.controls, h.version) !== CONTROL_VERSION ||
        Atomics.load(this.controls, h.generation) !== this.generation) throw new Error("Arm channel version or generation mismatch");
  }
  assertLive(): void {
    this.validate();
    if (Atomics.load(this.controls, CONTROL_HEADER.cancel)) throw new Error("Arm execution cancelled");
    if (Atomics.load(this.controls, CONTROL_HEADER.fault)) throw new Error("Arm simulation failed");
  }
  cancel(): void {
    Atomics.store(this.controls, CONTROL_HEADER.cancel, 1); this.wake();
  }
  fail(): void { Atomics.store(this.controls, CONTROL_HEADER.fault, 1); this.wake(); }
  private wake(): void {
    for (const slot of [CONTROL_HEADER.request, CONTROL_HEADER.complete, CONTROL_HEADER.cancel]) Atomics.notify(this.controls, slot);
  }
  get tick(): number { return Atomics.load(this.controls, CONTROL_HEADER.tick); }
  get requested(): number { return Atomics.load(this.controls, CONTROL_HEADER.request); }
  get completed(): number { return Atomics.load(this.controls, CONTROL_HEADER.complete); }
  get torque(): number { return this.#command[0]!; }
  /** Dedicated Runtime Worker only. Never call Atomics.wait on the main thread. */
  step(torque: number, maxTicks: number): void {
    this.assertLive();
    if (!Number.isFinite(torque) || typeof torque !== "number") throw new Error("Torque must be finite");
    const previous = this.completed;
    if (!Number.isInteger(maxTicks) || maxTicks < 1 || maxTicks > ARM_MAX_TICKS || previous < 0 || this.requested !== previous || previous !== this.tick || previous >= maxTicks || !Atomics.load(this.controls, CONTROL_HEADER.ready)) throw new Error("Invalid arm step sequence or length");
    this.#command[0] = torque;
    Atomics.store(this.controls, CONTROL_HEADER.request, previous + 1);
    Atomics.notify(this.controls, CONTROL_HEADER.request);
    const deadline = performance.now() + CONTROL_STEP_TIMEOUT_MS;
    while (true) {
      this.assertLive();
      const remaining = deadline - performance.now();
      if (remaining <= 0) { this.fail(); throw new Error("Arm step communication timed out"); }
      const complete = this.completed;
      if (complete === previous + 1) {
        if (this.tick !== complete) throw new Error("Arm observation tick mismatch");
        return;
      }
      if (complete !== previous) throw new Error("Out-of-order arm completion");
      Atomics.wait(this.controls, CONTROL_HEADER.complete, previous, remaining);
    }
  }
  publish(observation: ArmObservation, interval?: ArmInterval): void {
    this.assertLive();
    const tick = observation.tick;
    if ((tick === 0 && Atomics.load(this.controls, CONTROL_HEADER.ready)) || !Number.isSafeInteger(tick) || tick < 0 || tick > ARM_MAX_TICKS || (tick > 0 && (tick !== this.completed + 1 || this.requested !== tick))) throw new Error("Invalid simulation publication order");
    const flags = (observation.accelerationRadPerS2 !== null ? 1 : 0) | (interval?.saturated ? 2 : 0) |
      (interval?.contactedLowerStop ? 4 : 0) | (interval?.contactedUpperStop ? 8 : 0) | (interval?.velocityProjected ? 16 : 0);
    const row = [observation.angleRad, observation.angularVelocityRadPerS, observation.accelerationRadPerS2 ?? 0,
      observation.unconstrainedAccelerationRadPerS2, observation.gravityTorqueNm, observation.viscousTorqueNm, observation.mechanicalEnergyJ,
      interval?.requestedTorqueNm ?? 0, interval?.appliedTorqueNm ?? 0, flags, Number(observation.atLowerStop), Number(observation.atUpperStop)];
    if (!row.every(Number.isFinite)) throw new Error("Nonfinite arm observation");
    this.#rows.set(row, tick * CONTROL_ROW_WIDTH);
    Atomics.store(this.controls, CONTROL_HEADER.tick, tick);
    Atomics.store(this.controls, CONTROL_HEADER.complete, tick);
    if (tick === 0) Atomics.store(this.controls, CONTROL_HEADER.ready, 1);
    Atomics.notify(this.controls, CONTROL_HEADER.complete);
  }
  readRows(first: number, last = this.tick): Float64Array {
    this.validate();
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last > ARM_MAX_TICKS || last > this.tick || !Atomics.load(this.controls, CONTROL_HEADER.ready)) throw new Error("Invalid observation range");
    return this.#rows.slice(first * CONTROL_ROW_WIDTH, (last + 1) * CONTROL_ROW_WIDTH);
  }
}
export interface ArmTelemetry {
  readonly version: typeof CONTROL_VERSION; readonly identity: ControlIdentity; readonly model: typeof ARM_MODEL;
  readonly sequence: number; readonly firstTick: number; readonly lastTick: number; readonly rows: Float64Array;
}
export function validateTelemetry(value: unknown, maximumPoints = 128): ArmTelemetry {
  const v = value as ArmTelemetry;
  if (!v || v.version !== CONTROL_VERSION || v.model?.id !== ARM_MODEL.id || v.model.version !== ARM_MODEL.version ||
      v.model.integrator !== ARM_MODEL.integrator || v.model.integratorVersion !== ARM_MODEL.integratorVersion ||
      !Number.isSafeInteger(v.sequence) || v.sequence < 1 || !Number.isInteger(v.firstTick) || !Number.isInteger(v.lastTick) ||
      v.firstTick < 0 || v.lastTick < v.firstTick || v.lastTick > ARM_MAX_TICKS || v.lastTick - v.firstTick + 1 > maximumPoints ||
      !(v.rows instanceof Float64Array) || v.rows.length !== (v.lastTick - v.firstTick + 1) * CONTROL_ROW_WIDTH ||
      v.rows.byteLength > (maximumPoints === 128 ? 16 * 1024 : 128 * 1024) || !v.rows.every(Number.isFinite)) throw new Error("Invalid arm telemetry");
  snapshotIdentity(v.identity);
  for (let offset = 0; offset < v.rows.length; offset += CONTROL_ROW_WIDTH) {
    if (v.rows[offset]! < 0 || v.rows[offset]! > 150 * Math.PI / 180 || Math.abs(v.rows[offset + 8]!) > 1.2 ||
        (!(v.rows[offset + 9]! & 1) && v.rows[offset + 2] !== 0)) throw new Error("Out-of-range arm telemetry");
    if (!Number.isInteger(v.rows[offset + 9]) || v.rows[offset + 9]! < 0 || v.rows[offset + 9]! > 31 ||
        ![0, 1].includes(v.rows[offset + 10]!) || ![0, 1].includes(v.rows[offset + 11]!)) throw new Error("Invalid arm telemetry flags");
  }
  return v;
}

export type SimulationNotice =
  | { version: typeof CONTROL_VERSION; type: "error"; message: string }
  | { version: typeof CONTROL_VERSION; type: "ready"; identity: ControlIdentity; model: typeof ARM_MODEL }
  | { version: typeof CONTROL_VERSION; type: "progress"; identity: ControlIdentity; model: typeof ARM_MODEL; sequence: number; tick: number; lagMs: number };
export function parseSimulationNotice(value: unknown): SimulationNotice {
  const v = value as SimulationNotice;
  if (!v || v.version !== CONTROL_VERSION) throw new Error("Invalid Simulation Worker protocol");
  if (v.type === "error") {
    if (typeof v.message !== "string" || v.message.length > 500) throw new Error("Invalid simulation error");
    return v;
  }
  if (v.type !== "ready" && v.type !== "progress") throw new Error("Unknown Simulation Worker message");
  snapshotIdentity(v.identity);
  if (v.model?.id !== ARM_MODEL.id || v.model.version !== ARM_MODEL.version || v.model.integrator !== ARM_MODEL.integrator || v.model.integratorVersion !== ARM_MODEL.integratorVersion) throw new Error("Simulation model version mismatch");
  if (v.type === "progress" && (!Number.isSafeInteger(v.sequence) || v.sequence < 1 || !Number.isInteger(v.tick) || v.tick < 0 || v.tick > ARM_MAX_TICKS || !Number.isFinite(v.lagMs) || v.lagMs < 0)) throw new Error("Invalid simulation progress");
  return v;
}
