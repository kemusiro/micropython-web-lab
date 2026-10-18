import { describe, expect, it } from "vitest";
import { DEFAULT_ARM_CONTROL, runArmControl, snapshotArmControlConditions } from "./arm-control";

const degrees = (radians: number) => radians * 180 / Math.PI;
const cases = [
  { name: "gravity bias", change: {}, finalDegrees: 45.13, tolerance: 0.05 },
  { name: "ideal gravity compensation", change: { gravityCompensation: true }, finalDegrees: 60, tolerance: 0.05 },
  { name: "low damping overshoot", change: { kdNmSPerRad: 0.005 }, peakDegrees: 85.07, tolerance: 0.1 },
  { name: "insufficient lifting torque", change: { payloadMassKg: 0.60 }, finalDegrees: 0, tolerance: 0 },
];
describe("sampled PD reference controller", () => {
  it.each(cases)("reproduces the agreed $name case", ({ change, finalDegrees, peakDegrees, tolerance }) => {
    const result = runArmControl({ ...DEFAULT_ARM_CONTROL, ...change });
    const value = finalDegrees === undefined ? Math.max(...result.observations.map(state => degrees(state.angleRad)))
      : degrees(result.observations.at(-1)!.angleRad);
    expect(Math.abs(value - (finalDegrees ?? peakDegrees!))).toBeLessThanOrEqual(tolerance);
    expect(result.observations).toHaveLength(601); expect(result.intervals).toHaveLength(600);
    expect(result.observations.at(-1)!.timeS).toBe(6);
  });
  it.each(cases)("changes the $name angle series by less than 0.01 degrees when halving the integration step", ({ change }) => {
    const conditions = { ...DEFAULT_ARM_CONTROL, ...change };
    const normal = runArmControl(conditions), fine = runArmControl(conditions, 500);
    const difference = Math.max(...normal.observations.map((state, i) => Math.abs(degrees(state.angleRad - fine.observations[i]!.angleRad))));
    expect(difference).toBeLessThan(0.01);
    expect(normal.integrationStepUs).toBe(1000); expect(fine.integrationStepUs).toBe(500);
  });
  it("repeats the same series exactly without reading any wall clock or random source", () => {
    const conditions = { ...DEFAULT_ARM_CONTROL, kdNmSPerRad: 0.005 };
    expect(runArmControl(conditions)).toEqual(runArmControl(conditions));
  });
  it("uses one held torque per control interval and includes the model and conditions in a detached result", () => {
    const conditions = { ...DEFAULT_ARM_CONTROL };
    const result = runArmControl(conditions);
    conditions.payloadMassKg = 0.6;
    expect(result.conditions.payloadMassKg).toBe(0.15);
    expect(result.model).toEqual({ id: "one-axis-arm", version: "1.0.0", integrator: "rk4", integratorVersion: 1 });
    expect(result.intervals[0]!.requestedTorqueNm).toBeCloseTo(1.2 * Math.PI / 3, 13);
    expect(result.intervals[0]!.appliedTorqueNm).toBe(1.2);
    expect(result.intervals[0]!.saturated).toBe(true);
    for (const interval of result.intervals) {
      const state = result.observations[interval.tick]!;
      expect(interval.requestedTorqueNm).toBeCloseTo(1.2 * (Math.PI / 3 - state.angleRad) - 0.04 * state.angularVelocityRadPerS, 12);
    }
  });
  it.each([
    { payloadMassKg: 0, initialAngleRad: 0, targetAngleRad: 100 * Math.PI / 180, kpNmPerRad: 3, kdNmSPerRad: 0 },
    { payloadMassKg: 0.6, initialAngleRad: 100 * Math.PI / 180, targetAngleRad: 10 * Math.PI / 180, kpNmPerRad: 3, kdNmSPerRad: 0 },
  ])("keeps high-gain motion bounded through contacts at the allowed condition extremes %j", change => {
    const result = runArmControl({ ...DEFAULT_ARM_CONTROL, ...change, gravityCompensation: true, durationMs: 10000 });
    expect(result.status).toBe("completed");
    expect(result.intervals.some(interval => interval.velocityProjected)).toBe(true);
    for (const state of result.observations) {
      expect(state.angleRad).toBeGreaterThanOrEqual(0);
      expect(state.angleRad).toBeLessThanOrEqual(150 * Math.PI / 180);
      expect(Number.isFinite(state.angularVelocityRadPerS)).toBe(true);
      expect(state.accelerationRadPerS2 === null || Number.isFinite(state.accelerationRadPerS2)).toBe(true);
    }
  });
  it("validates a one-second minimum, a ten-second maximum and full control ticks", () => {
    expect(runArmControl({ ...DEFAULT_ARM_CONTROL, durationMs: 1000 }).observations).toHaveLength(101);
    expect(runArmControl({ ...DEFAULT_ARM_CONTROL, durationMs: 10000 }).observations).toHaveLength(1001);
    expect(snapshotArmControlConditions({ ...DEFAULT_ARM_CONTROL, durationMs: 1010 }).durationMs).toBe(1010);
  });
  it.each([
    { payloadMassKg: -0.01 }, { payloadMassKg: 0.601 }, { initialAngleRad: -0.01 }, { initialAngleRad: Math.PI },
    { targetAngleRad: 0 }, { targetAngleRad: 100 }, { kpNmPerRad: 0.49 }, { kpNmPerRad: 3.01 },
    { kdNmSPerRad: -0.001 }, { kdNmSPerRad: 0.151 }, { gravityCompensation: 1 }, { payloadMassKg: "0.15" },
    { targetAngleRad: NaN }, { targetAngleRad: Infinity }, { durationMs: 999 }, { durationMs: 10001 }, { durationMs: 1001 },
  ])("rejects invalid conditions %j before running", change => {
    expect(() => runArmControl({ ...DEFAULT_ARM_CONTROL, ...change })).toThrow();
  });
  it("rejects unknown fields and unit substitutions rather than silently using defaults", () => {
    expect(() => runArmControl({ ...DEFAULT_ARM_CONTROL, targetDegrees: 60 })).toThrow("Unknown or missing");
    const { targetAngleRad: _target, ...missing } = DEFAULT_ARM_CONTROL;
    expect(() => runArmControl(missing)).toThrow("Unknown or missing");
    expect(() => runArmControl({ ...DEFAULT_ARM_CONTROL, initialVelocity: 1 })).toThrow();
    expect(() => runArmControl(null)).toThrow();
  });
});
