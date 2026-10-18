import { describe, expect, it } from "vitest";
import { ARM_MAX_TICKS, DEFAULT_ARM_PHYSICS, OneAxisArm, type ArmPhysicalParameters } from "./one-axis-arm";

const rad = (degrees: number) => degrees * Math.PI / 180;
const pendulum = { ...DEFAULT_ARM_PHYSICS, minAngleRad: -Math.PI, maxAngleRad: Math.PI };
function free(parameters: Partial<ArmPhysicalParameters> = {}) {
  return new OneAxisArm({ parameters: { ...pendulum, ...parameters }, initialState: { angleRad: 0.4, angularVelocityRadPerS: 0 } });
}

describe("one-axis rigid arm dynamics", () => {
  it("keeps the rod's inertia and gravity with no payload", () => {
    const arm = free({ payloadMassKg: 0 });
    expect(arm.inertiaKgM2).toBeCloseTo(0.002, 14);
    expect(arm.gravityCoefficientNm).toBeCloseTo(0.14715, 14);
    const loaded = free();
    expect(loaded.inertiaKgM2).toBeCloseTo(0.008, 14);
    expect(loaded.gravityCoefficientNm).toBeCloseTo(0.44145, 14);
  });
  it("uses the horizontal-angle convention for free acceleration and gravitational potential", () => {
    const arm = new OneAxisArm({ parameters: pendulum, initialState: { angleRad: 0, angularVelocityRadPerS: 0 } });
    expect(arm.read().accelerationRadPerS2).toBeCloseTo(-55.18125, 12);
    expect(arm.read().mechanicalEnergyJ).toBe(0);
    const vertical = new OneAxisArm({ parameters: pendulum, initialState: { angleRad: Math.PI / 2, angularVelocityRadPerS: 0 } });
    expect(vertical.read().gravityTorqueNm).toBeCloseTo(0, 14);
    expect(vertical.read().mechanicalEnergyJ).toBeCloseTo(0.44145, 14);
  });
  it("balances known gravity torque exactly at an interior equilibrium", () => {
    const arm = free();
    const torque = 0.44145 * Math.cos(0.4);
    for (let i = 0; i < 600; i++) arm.step(torque);
    expect(arm.read().angleRad).toBeCloseTo(0.4, 11);
    expect(arm.read().angularVelocityRadPerS).toBeCloseTo(0, 11);
  });
  it("matches the constant-acceleration solution without gravity or friction", () => {
    const arm = new OneAxisArm({ parameters: { ...pendulum, gravityMPerS2: 0, viscousFrictionNmSPerRad: 0 },
      initialState: { angleRad: -0.4, angularVelocityRadPerS: 0.1 } });
    for (let i = 0; i < 10; i++) arm.step(0.001);
    expect(arm.read().angleRad).toBeCloseTo(-0.4 + 0.1 * 0.1 + 0.001 / 0.008 * 0.1 ** 2 / 2, 13);
    expect(arm.read().angularVelocityRadPerS).toBeCloseTo(0.1 + 0.001 / 0.008 * 0.1, 13);
    expect(arm.read().accelerationRadPerS2).toBeCloseTo(0.125, 13);
  });
  it("matches exponential viscous damping independently of the controller", () => {
    const arm = new OneAxisArm({ parameters: { ...pendulum, gravityMPerS2: 0 }, initialState: { angleRad: 0, angularVelocityRadPerS: 0.5 } });
    for (let i = 0; i < 50; i++) arm.step(0);
    const decay = Math.exp(-0.012 / 0.008 * 0.5);
    expect(arm.read().angularVelocityRadPerS).toBeCloseTo(0.5 * decay, 12);
    expect(arm.read().angleRad).toBeCloseTo(0.5 * 0.008 / 0.012 * (1 - decay), 12);
  });
  it("conserves mechanical energy for an unforced frictionless pendulum away from the stops", () => {
    const arm = new OneAxisArm({ parameters: { ...pendulum, viscousFrictionNmSPerRad: 0 },
      initialState: { angleRad: -Math.PI / 2 + 0.3, angularVelocityRadPerS: 0 } });
    const initial = arm.read().mechanicalEnergyJ;
    for (let i = 0; i < 600; i++) {
      const { observation, interval } = arm.step(0);
      expect(Math.abs(observation.mechanicalEnergyJ - initial)).toBeLessThan(1e-9);
      expect(interval.contactedLowerStop || interval.contactedUpperStop).toBe(false);
    }
  });
  it("loses energy under viscous friction and reaches the downward equilibrium", () => {
    const arm = new OneAxisArm({ parameters: pendulum, initialState: { angleRad: -Math.PI / 2 + 0.3, angularVelocityRadPerS: 0 } });
    let energy = arm.read().mechanicalEnergyJ;
    for (let i = 0; i < 600; i++) {
      const next = arm.step(0).observation.mechanicalEnergyJ;
      expect(next).toBeLessThanOrEqual(energy + 1e-12); energy = next;
    }
    expect(arm.read().angleRad).toBeCloseTo(-Math.PI / 2, 2);
    expect(energy).toBeLessThan(-0.4414);
  });
  it("balances applied work against mechanical energy away from contacts and friction", () => {
    const arm = free({ viscousFrictionNmSPerRad: 0 });
    const initial = arm.read();
    for (let i = 0; i < 10; i++) arm.step(0.1);
    const final = arm.read();
    expect(Math.abs(final.mechanicalEnergyJ - initial.mechanicalEnergyJ - 0.1 * (final.angleRad - initial.angleRad))).toBeLessThan(1e-9);
  });
  it("saturates torque in both directions while keeping the original command", () => {
    for (const sign of [-1, 1]) {
      const arm = free({ gravityMPerS2: 0, viscousFrictionNmSPerRad: 0 });
      const { interval, observation } = arm.step(sign * Number.MAX_VALUE);
      expect(interval.requestedTorqueNm).toBe(sign * Number.MAX_VALUE);
      expect(interval.appliedTorqueNm).toBe(sign * 1.2);
      expect(interval.saturated).toBe(true);
      expect(observation.angularVelocityRadPerS).toBeCloseTo(sign * 1.5, 12);
    }
    expect(free().step(1.2).interval.saturated).toBe(false);
  });
});

describe("unilateral stops and observation intervals", () => {
  it.each(["lower", "upper"] as const)("removes outward velocity and energy at the %s stop without reflecting it", stop => {
    const lower = stop === "lower";
    const arm = new OneAxisArm({ parameters: { ...DEFAULT_ARM_PHYSICS, gravityMPerS2: 0, viscousFrictionNmSPerRad: 0 },
      initialState: { angleRad: lower ? 0.001 : rad(150) - 0.001, angularVelocityRadPerS: lower ? -2 : 2 } });
    const energy = arm.read().mechanicalEnergyJ;
    const { observation, interval } = arm.step(0);
    expect(observation.angleRad).toBe(lower ? 0 : rad(150));
    expect(observation.angularVelocityRadPerS).toBe(0);
    expect(observation.mechanicalEnergyJ).toBeLessThan(energy);
    expect(interval.velocityProjected).toBe(true);
    expect(lower ? interval.contactedLowerStop : interval.contactedUpperStop).toBe(true);
    expect(observation.accelerationRadPerS2).toBeNull();
    const resting = arm.step(0);
    expect(resting.interval.velocityProjected).toBe(false);
    expect(resting.observation.accelerationRadPerS2).toBe(0);
  });
  it.each(["lower", "upper"] as const)("retains inward velocity at the %s stop", stop => {
    const lower = stop === "lower";
    const arm = new OneAxisArm({ parameters: { ...DEFAULT_ARM_PHYSICS, gravityMPerS2: 0, viscousFrictionNmSPerRad: 0 },
      initialState: { angleRad: lower ? 0 : rad(150), angularVelocityRadPerS: lower ? 0.2 : -0.2 } });
    const result = arm.step(0);
    expect(result.observation.angularVelocityRadPerS).toBe(lower ? 0.2 : -0.2);
    expect(result.interval.velocityProjected).toBe(false);
    expect(lower ? result.observation.angleRad > 0 : result.observation.angleRad < rad(150)).toBe(true);
  });
  it("holds an overloaded arm at the lower stop without fictitious recurring impacts, then allows release", () => {
    const arm = new OneAxisArm({ parameters: { ...DEFAULT_ARM_PHYSICS, payloadMassKg: 0.6 } });
    expect(arm.gravityCoefficientNm).toBeCloseTo(1.32435, 12);
    for (let i = 0; i < 100; i++) {
      const result = arm.step(2);
      expect(result.observation.angleRad).toBe(0);
      expect(result.observation.angularVelocityRadPerS).toBe(0);
      expect(result.observation.accelerationRadPerS2).toBe(0);
      expect(result.observation.unconstrainedAccelerationRadPerS2).toBeLessThan(0);
      expect(result.interval.contactedLowerStop).toBe(true);
      expect(result.interval.velocityProjected).toBe(false);
    }
    const light = new OneAxisArm();
    expect(light.step(1).observation.angleRad).toBeGreaterThan(0);
  });
  it("dissipates energy at either stop under gravity with no applied work", () => {
    for (const [angleRad, angularVelocityRadPerS] of [[0.001, -2], [rad(150) - 0.001, 2]]) {
      const arm = new OneAxisArm({ parameters: { ...DEFAULT_ARM_PHYSICS, viscousFrictionNmSPerRad: 0 }, initialState: { angleRad: angleRad!, angularVelocityRadPerS: angularVelocityRadPerS! } });
      let energy = arm.read().mechanicalEnergyJ;
      for (let i = 0; i < 100; i++) {
        const next = arm.step(0).observation.mechanicalEnergyJ;
        expect(next).toBeLessThanOrEqual(energy + 1e-9); energy = next;
      }
    }
  });
  it("records tick zero, held commands on [n,n+1), and integer-derived time", () => {
    const arm = free({ gravityMPerS2: 0 });
    const initial = arm.read();
    expect(initial.tick).toBe(0); expect(initial.timeS).toBe(0);
    expect(initial.accelerationRadPerS2).toBe(0);
    const first = arm.step(0.1), second = arm.step(-0.1);
    expect(first.interval.tick).toBe(0); expect(first.observation.tick).toBe(1); expect(first.observation.timeS).toBe(0.01);
    expect(second.interval.tick).toBe(1); expect(second.observation.tick).toBe(2); expect(second.observation.timeS).toBe(0.02);
    expect(first.observation.accelerationRadPerS2).toBeGreaterThan(0);
    expect(second.observation.accelerationRadPerS2).toBeLessThan(0);
    expect(arm.trace().observations).toHaveLength(3);
  });
  it("copies inputs and outputs so callers cannot rewrite the model or prior history", () => {
    const parameters = { ...DEFAULT_ARM_PHYSICS };
    const initial = { angleRad: 0.4, angularVelocityRadPerS: 0 };
    const arm = new OneAxisArm({ parameters, initialState: initial });
    parameters.payloadMassKg = 0.6; initial.angleRad = 0;
    const first = arm.step(0.5);
    (first.observation as any).angleRad = 123;
    const trace = arm.trace(); (trace.physicalParameters as any).armMassKg = 100; (trace.observations[0] as any).angleRad = 10;
    expect(arm.read().angleRad).not.toBe(123);
    expect(arm.trace().observations[0]!.angleRad).toBe(0.4);
    expect(arm.trace().physicalParameters.armMassKg).toBe(0.15);
    expect(arm.inertiaKgM2).toBeCloseTo(0.008, 14);
  });
  it("bounds history and rejects advancement after completion or explicit end", () => {
    const arm = new OneAxisArm();
    for (let i = 0; i < ARM_MAX_TICKS; i++) arm.step(0);
    const trace = arm.trace();
    expect(trace.observations).toHaveLength(1001); expect(trace.intervals).toHaveLength(1000);
    expect(arm.read().timeS).toBe(10); expect(arm.ended).toBe(true);
    expect(trace.status).toBe("completed"); expect(trace.plannedTicks).toBe(1000);
    expect(() => arm.step(0)).toThrow("ended"); expect(arm.trace()).toEqual(trace);
    const stopped = new OneAxisArm(); stopped.end(); expect(() => stopped.step(1)).toThrow("ended");
    expect(stopped.read().tick).toBe(0); expect(stopped.trace().status).toBe("stopped");
    expect(new OneAxisArm().trace().status).toBe("running");
  });
  it("does not commit a partial tick when an unstable diagnostic parameter produces a nonfinite result", () => {
    const arm = new OneAxisArm({ parameters: { ...pendulum, viscousFrictionNmSPerRad: 1e6 },
      initialState: { angleRad: 0.4, angularVelocityRadPerS: 1 } });
    const before = arm.trace();
    expect(() => arm.step(0)).toThrow("finite");
    expect(arm.trace()).toEqual(before);
    expect(arm.tick).toBe(0);
  });
  it.each([NaN, Infinity, -Infinity, "1", null])("rejects invalid torque %s without advancing", torque => {
    const arm = new OneAxisArm(); const before = arm.trace();
    expect(() => arm.step(torque as number)).toThrow(); expect(arm.trace()).toEqual(before);
  });
  it.each([
    { lengthM: 0 }, { armMassKg: -1 }, { payloadMassKg: -0.1 }, { gravityMPerS2: NaN },
    { viscousFrictionNmSPerRad: -1 }, { maxTorqueNm: 0 }, { minAngleRad: Math.PI },
    { lengthM: 1e-300 }, { armMassKg: Number.MAX_VALUE, lengthM: Number.MAX_VALUE },
  ])("rejects invalid or nonfinite derived parameters %j", change => {
    expect(() => new OneAxisArm({ parameters: { ...DEFAULT_ARM_PHYSICS, ...change } })).toThrow();
  });
  it("rejects unknown integration, invalid states and unbounded run lengths", () => {
    expect(() => new OneAxisArm({ integrationStepUs: 100 as any })).toThrow();
    for (const maxTicks of [0, 1001, 1.5, Infinity]) expect(() => new OneAxisArm({ maxTicks })).toThrow();
    for (const angleRad of [-0.01, rad(151), Infinity]) expect(() => new OneAxisArm({ initialState: { angleRad, angularVelocityRadPerS: 0 } })).toThrow();
    expect(() => new OneAxisArm({ initialState: { angleRad: 0, angularVelocityRadPerS: NaN } })).toThrow();
    expect(() => new OneAxisArm({ initialState: { angleRad: 0, angularVelocityRadPerS: -1 } })).toThrow("outside the stops");
    expect(() => new OneAxisArm({ initialState: { angleRad: rad(150), angularVelocityRadPerS: 1 } })).toThrow("outside the stops");
  });
});
