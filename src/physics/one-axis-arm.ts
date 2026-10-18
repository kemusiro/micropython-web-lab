/** Host-side numerical model. No DOM, clock, storage, board or Python dependencies. */
export const ARM_MODEL = Object.freeze({ id: "one-axis-arm", version: "1.0.0", integrator: "rk4", integratorVersion: 1 });
export const ARM_CONTROL_PERIOD_US = 10_000;
export const ARM_MAX_TICKS = 1_000;
export type ArmIntegrationStepUs = 1_000 | 500;

export interface ArmPhysicalParameters {
  readonly lengthM: number;
  readonly armMassKg: number;
  readonly payloadMassKg: number;
  readonly gravityMPerS2: number;
  readonly viscousFrictionNmSPerRad: number;
  readonly maxTorqueNm: number;
  readonly minAngleRad: number;
  readonly maxAngleRad: number;
}
export const DEFAULT_ARM_PHYSICS: Readonly<ArmPhysicalParameters> = Object.freeze({
  lengthM: 0.20, armMassKg: 0.15, payloadMassKg: 0.15, gravityMPerS2: 9.81,
  viscousFrictionNmSPerRad: 0.012, maxTorqueNm: 1.20, minAngleRad: 0, maxAngleRad: 150 * Math.PI / 180,
});
export interface ArmState { readonly angleRad: number; readonly angularVelocityRadPerS: number }
export interface ArmObservation extends ArmState {
  readonly tick: number;
  readonly timeS: number;
  /** Acceleration under the preceding interval's held torque (zero torque at tick 0).
   * Null for an interval containing a velocity projection, not a measured impact acceleration. */
  readonly accelerationRadPerS2: number | null;
  readonly unconstrainedAccelerationRadPerS2: number;
  readonly gravityTorqueNm: number;
  readonly viscousTorqueNm: number;
  readonly mechanicalEnergyJ: number;
  readonly atLowerStop: boolean;
  readonly atUpperStop: boolean;
}
export interface ArmInterval {
  /** Command selected at tick n acts over [n, n + 1). */
  readonly tick: number;
  readonly requestedTorqueNm: number;
  readonly appliedTorqueNm: number;
  readonly saturated: boolean;
  readonly contactedLowerStop: boolean;
  readonly contactedUpperStop: boolean;
  readonly velocityProjected: boolean;
}
export interface ArmTrace {
  readonly model: typeof ARM_MODEL;
  readonly physicalParameters: ArmPhysicalParameters;
  readonly initialState: ArmState;
  readonly controlPeriodUs: number;
  readonly integrationStepUs: ArmIntegrationStepUs;
  readonly plannedTicks: number;
  readonly status: "running" | "completed" | "stopped";
  readonly observations: readonly ArmObservation[];
  readonly intervals: readonly ArmInterval[];
}

export function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Invalid ${name}: expected a finite number`);
  return value;
}
export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a parameter object");
  const fields = Object.keys(value);
  if (fields.length !== keys.length || fields.some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError("Unknown or missing parameter (use the documented SI units)");
  }
  return value as Record<string, unknown>;
}
function physicalParameters(value: unknown): ArmPhysicalParameters {
  const fields = Object.keys(DEFAULT_ARM_PHYSICS) as (keyof ArmPhysicalParameters)[];
  const v = exactObject(value, fields);
  const p = Object.fromEntries(fields.map(key => [key, finiteNumber(v[key], key)])) as unknown as ArmPhysicalParameters;
  if (p.lengthM <= 0 || p.armMassKg <= 0 || p.payloadMassKg < 0 || p.gravityMPerS2 < 0 ||
      p.viscousFrictionNmSPerRad < 0 || p.maxTorqueNm <= 0 || p.minAngleRad < -Math.PI ||
      p.maxAngleRad > Math.PI || p.minAngleRad >= p.maxAngleRad) throw new RangeError("Invalid arm physical parameters");
  return Object.freeze(p);
}

/** One command advances exactly one control tick; callers own scheduling and rendering.
 * Physical overrides and 500 us integration are for numerical diagnostics, not lab UI settings. */
export class OneAxisArm {
  readonly #parameters: ArmPhysicalParameters;
  readonly #inertia: number;
  readonly #gravity: number;
  readonly #integrationStepUs: ArmIntegrationStepUs;
  readonly #maxTicks: number;
  readonly #initial: ArmState;
  readonly #observations: ArmObservation[];
  readonly #intervals: ArmInterval[] = [];
  #ended = false;

  constructor(options: { parameters?: ArmPhysicalParameters; initialState?: ArmState;
    integrationStepUs?: ArmIntegrationStepUs; maxTicks?: number } = {}) {
    this.#parameters = physicalParameters(options.parameters ?? DEFAULT_ARM_PHYSICS);
    const p = this.#parameters;
    this.#inertia = p.armMassKg * p.lengthM ** 2 / 3 + p.payloadMassKg * p.lengthM ** 2;
    this.#gravity = p.gravityMPerS2 * (p.armMassKg * p.lengthM / 2 + p.payloadMassKg * p.lengthM);
    if (!Number.isFinite(this.#inertia) || this.#inertia <= 0 || !Number.isFinite(this.#gravity) ||
        ![this.#gravity, p.maxTorqueNm, p.viscousFrictionNmSPerRad].every(value => Number.isFinite(value / this.#inertia))) {
      throw new RangeError("Arm dynamics exceed finite numerical bounds");
    }
    const integrationStepUs = options.integrationStepUs ?? 1_000;
    if (integrationStepUs !== 1_000 && integrationStepUs !== 500) throw new RangeError("Unsupported arm integration step");
    this.#integrationStepUs = integrationStepUs;
    this.#maxTicks = options.maxTicks ?? ARM_MAX_TICKS;
    if (!Number.isSafeInteger(this.#maxTicks) || this.#maxTicks < 1 || this.#maxTicks > ARM_MAX_TICKS) throw new RangeError("Invalid arm tick limit");
    const initial = exactObject(options.initialState ?? { angleRad: 0, angularVelocityRadPerS: 0 }, ["angleRad", "angularVelocityRadPerS"]);
    this.#initial = Object.freeze({ angleRad: finiteNumber(initial.angleRad, "angleRad"),
      angularVelocityRadPerS: finiteNumber(initial.angularVelocityRadPerS, "angularVelocityRadPerS") });
    if (this.#initial.angleRad < p.minAngleRad || this.#initial.angleRad > p.maxAngleRad) throw new RangeError("Initial angle is outside the stops");
    if ((this.#initial.angleRad === p.minAngleRad && this.#initial.angularVelocityRadPerS < 0) ||
        (this.#initial.angleRad === p.maxAngleRad && this.#initial.angularVelocityRadPerS > 0)) throw new RangeError("Initial velocity points outside the stops");
    this.#observations = [this.observe(this.#initial, 0, 0, false)];
  }
  get inertiaKgM2(): number { return this.#inertia; }
  get gravityCoefficientNm(): number { return this.#gravity; }
  get tick(): number { return this.#intervals.length; }
  get ended(): boolean { return this.#ended || this.tick === this.#maxTicks; }
  read(): ArmObservation { return { ...this.#observations[this.tick]! }; }
  end(): void { this.#ended = true; }
  trace(): ArmTrace {
    return { model: { ...ARM_MODEL }, physicalParameters: { ...this.#parameters }, initialState: { ...this.#initial },
      controlPeriodUs: ARM_CONTROL_PERIOD_US, integrationStepUs: this.#integrationStepUs, plannedTicks: this.#maxTicks,
      status: this.tick === this.#maxTicks ? "completed" : this.#ended ? "stopped" : "running",
      observations: this.#observations.map(value => ({ ...value })), intervals: this.#intervals.map(value => ({ ...value })) };
  }
  step(requestedTorqueNm: number): { interval: ArmInterval; observation: ArmObservation } {
    if (this.ended) throw new Error("Arm simulation has ended");
    finiteNumber(requestedTorqueNm, "requestedTorqueNm");
    const p = this.#parameters;
    const torque = Math.max(-p.maxTorqueNm, Math.min(p.maxTorqueNm, requestedTorqueNm));
    const interval = { tick: this.tick, requestedTorqueNm, appliedTorqueNm: torque, saturated: torque !== requestedTorqueNm,
      contactedLowerStop: false, contactedUpperStop: false, velocityProjected: false };
    let state: ArmState = this.read();
    const dt = this.#integrationStepUs / 1_000_000;
    for (let substep = 0; substep < ARM_CONTROL_PERIOD_US / this.#integrationStepUs; substep++) {
      // A resting unilateral constraint cancels outward acceleration without inventing repeated impacts.
      const acceleration = this.acceleration(state, torque);
      if (state.angularVelocityRadPerS === 0 &&
          ((state.angleRad === p.minAngleRad && acceleration <= 0) || (state.angleRad === p.maxAngleRad && acceleration >= 0))) {
        interval.contactedLowerStop ||= state.angleRad === p.minAngleRad;
        interval.contactedUpperStop ||= state.angleRad === p.maxAngleRad;
        continue;
      }
      const next = this.rk4(state, torque, dt);
      finiteNumber(next.angleRad, "integrated angle"); finiteNumber(next.angularVelocityRadPerS, "integrated velocity");
      let { angleRad, angularVelocityRadPerS } = next;
      if (angleRad <= p.minAngleRad) {
        interval.contactedLowerStop = true; angleRad = p.minAngleRad;
        if (angularVelocityRadPerS < 0) { angularVelocityRadPerS = 0; interval.velocityProjected = true; }
      } else if (angleRad >= p.maxAngleRad) {
        interval.contactedUpperStop = true; angleRad = p.maxAngleRad;
        if (angularVelocityRadPerS > 0) { angularVelocityRadPerS = 0; interval.velocityProjected = true; }
      }
      state = { angleRad, angularVelocityRadPerS };
    }
    const observation = this.observe(state, this.tick + 1, torque, interval.velocityProjected);
    // Commit only after every intermediate value and output has been checked.
    this.#intervals.push(interval); this.#observations.push(observation);
    return { interval: { ...interval }, observation: { ...observation } };
  }
  private acceleration(state: ArmState, torque: number): number {
    return (torque - this.#gravity * Math.cos(state.angleRad) - this.#parameters.viscousFrictionNmSPerRad * state.angularVelocityRadPerS) / this.#inertia;
  }
  private rk4(s: ArmState, torque: number, dt: number): ArmState {
    const k1a = s.angularVelocityRadPerS, k1v = this.acceleration(s, torque);
    const k2a = s.angularVelocityRadPerS + dt * k1v / 2;
    const k2v = this.acceleration({ angleRad: s.angleRad + dt * k1a / 2, angularVelocityRadPerS: k2a }, torque);
    const k3a = s.angularVelocityRadPerS + dt * k2v / 2;
    const k3v = this.acceleration({ angleRad: s.angleRad + dt * k2a / 2, angularVelocityRadPerS: k3a }, torque);
    const k4a = s.angularVelocityRadPerS + dt * k3v;
    const k4v = this.acceleration({ angleRad: s.angleRad + dt * k3a, angularVelocityRadPerS: k4a }, torque);
    return { angleRad: s.angleRad + dt * (k1a + 2 * k2a + 2 * k3a + k4a) / 6,
      angularVelocityRadPerS: s.angularVelocityRadPerS + dt * (k1v + 2 * k2v + 2 * k3v + k4v) / 6 };
  }
  private observe(state: ArmState, tick: number, torque: number, projected: boolean): ArmObservation {
    const p = this.#parameters;
    const gravityTorqueNm = this.#gravity * Math.cos(state.angleRad);
    const viscousTorqueNm = p.viscousFrictionNmSPerRad * state.angularVelocityRadPerS;
    const unconstrainedAccelerationRadPerS2 = this.acceleration(state, torque);
    const atLowerStop = state.angleRad === p.minAngleRad, atUpperStop = state.angleRad === p.maxAngleRad;
    const resting = state.angularVelocityRadPerS === 0 && ((atLowerStop && unconstrainedAccelerationRadPerS2 <= 0) || (atUpperStop && unconstrainedAccelerationRadPerS2 >= 0));
    const mechanicalEnergyJ = this.#inertia * state.angularVelocityRadPerS ** 2 / 2 + this.#gravity * Math.sin(state.angleRad);
    for (const value of [gravityTorqueNm, viscousTorqueNm, unconstrainedAccelerationRadPerS2, mechanicalEnergyJ]) finiteNumber(value, "arm observation");
    return { angleRad: state.angleRad, angularVelocityRadPerS: state.angularVelocityRadPerS,
      tick, timeS: tick * ARM_CONTROL_PERIOD_US / 1_000_000, accelerationRadPerS2: projected ? null : resting ? 0 : unconstrainedAccelerationRadPerS2,
      unconstrainedAccelerationRadPerS2, gravityTorqueNm, viscousTorqueNm, mechanicalEnergyJ, atLowerStop, atUpperStop };
  }
}
