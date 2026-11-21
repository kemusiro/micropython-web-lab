import { ARM_CONTROL_PERIOD_US, DEFAULT_ARM_PHYSICS, OneAxisArm, exactObject, finiteNumber, type ArmIntegrationStepUs, type ArmTrace } from "./one-axis-arm";

/** SI conditions shared by the reference controller and model runtime.
 * Persistence and Python APIs own their explicit surrounding contracts. */
export interface ArmControlConditions {
  readonly payloadMassKg: number;
  readonly initialAngleRad: number;
  readonly targetAngleRad: number;
  readonly kpNmPerRad: number;
  readonly kdNmSPerRad: number;
  readonly gravityCompensation: boolean;
  readonly durationMs: number;
}
export const DEFAULT_ARM_CONTROL: Readonly<ArmControlConditions> = Object.freeze({
  payloadMassKg: 0.15, initialAngleRad: 0, targetAngleRad: Math.PI / 3,
  kpNmPerRad: 1.2, kdNmSPerRad: 0.040, gravityCompensation: false, durationMs: 6_000,
});
export function snapshotArmControlConditions(value: unknown): ArmControlConditions {
  const v = exactObject(value, Object.keys(DEFAULT_ARM_CONTROL));
  const range = (key: keyof ArmControlConditions, min: number, max: number) => {
    const number = finiteNumber(v[key], key);
    if (number < min || number > max) throw new RangeError(`Out of range: ${key}`);
    return number;
  };
  if (typeof v.gravityCompensation !== "boolean") throw new TypeError("Invalid gravityCompensation: expected a boolean");
  const durationMs = range("durationMs", 1_000, 10_000);
  if (!Number.isInteger(durationMs) || durationMs % (ARM_CONTROL_PERIOD_US / 1_000)) throw new RangeError("Duration must contain whole control ticks");
  return { payloadMassKg: range("payloadMassKg", 0, 0.60), initialAngleRad: range("initialAngleRad", 0, 100 * Math.PI / 180),
    targetAngleRad: range("targetAngleRad", 10 * Math.PI / 180, 100 * Math.PI / 180), kpNmPerRad: range("kpNmPerRad", 0.5, 3),
    kdNmSPerRad: range("kdNmSPerRad", 0, 0.150), gravityCompensation: v.gravityCompensation, durationMs };
}
export interface ArmControlResult extends ArmTrace { readonly conditions: ArmControlConditions }

/** Deterministic host-side reference, not execution of user Python code. */
export function runArmControl(value: unknown, integrationStepUs: ArmIntegrationStepUs = 1_000): ArmControlResult {
  const conditions = snapshotArmControlConditions(value);
  const steps = conditions.durationMs * 1_000 / ARM_CONTROL_PERIOD_US;
  const arm = new OneAxisArm({ parameters: { ...DEFAULT_ARM_PHYSICS, payloadMassKg: conditions.payloadMassKg },
    initialState: { angleRad: conditions.initialAngleRad, angularVelocityRadPerS: 0 }, maxTicks: steps, integrationStepUs });
  for (let tick = 0; tick < steps; tick++) {
    const state = arm.read();
    const torque = conditions.kpNmPerRad * (conditions.targetAngleRad - state.angleRad) - conditions.kdNmSPerRad * state.angularVelocityRadPerS +
      (conditions.gravityCompensation ? arm.gravityCoefficientNm * Math.cos(state.angleRad) : 0);
    arm.step(torque);
  }
  return { ...arm.trace(), conditions };
}
