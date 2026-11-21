import { describe, expect, it } from "vitest";
import { ArmRecording, armMetrics, armPlotPath, snapshotArmSeries, type ArmSample } from "./presentation";
import { CONTROL_VERSION, SharedArmChannel } from "./channel";
import { DEFAULT_ARM_CONTROL } from "../physics/arm-control";
import { ARM_MODEL, OneAxisArm } from "../physics/one-axis-arm";

const sample = (tick: number, angle: number): ArmSample => ({ tick, angle, speed: 0, acceleration: 0, gravity: 0, requestedTorque: 0, appliedTorque: 0, saturated: false, contact: false });
describe("arm presentation data", () => {
  it("evaluates overshoot in either direction and keeps finite-run error separate", () => {
    expect(armMetrics([sample(0, 0), sample(1, 1.5), sample(2, 0.75)], { ...DEFAULT_ARM_CONTROL, targetAngleRad: 1 })).toMatchObject({ overshoot: 0.5, finalError: 0.25 });
    const down = armMetrics([sample(0, 1.5), sample(1, 0.25), sample(2, 0.8)], { ...DEFAULT_ARM_CONTROL, initialAngleRad: 1.5, targetAngleRad: 0.5 });
    expect(down.overshoot).toBe(0.25); expect(down.finalError).toBeCloseTo(-0.3, 12);
    expect(armMetrics([sample(0, 1)], { ...DEFAULT_ARM_CONTROL, initialAngleRad: 1, targetAngleRad: 1 }).overshoot).toBeNull();
    expect(armMetrics([], DEFAULT_ARM_CONTROL).finalError).toBeNull();
  });
  it("does not count initial contact as an interval and counts saturation separately", () => {
    const points = [{ ...sample(0, 0), contact: true }, { ...sample(1, 0), contact: true, saturated: true }];
    expect(armMetrics(points, DEFAULT_ARM_CONTROL)).toMatchObject({ saturatedIntervals: 1, contactIntervals: 1 });
  });
  it("copies overlapping windows, rejects another run, and replaces gaps with the final full trace", () => {
    const channel = SharedArmChannel.create(1), arm = new OneAxisArm(); channel.publish(arm.read());
    for (let n = 1; n <= 3; n++) { Atomics.store(channel.controls, 3, n); const result = arm.step(0.5); channel.publish(result.observation, result.interval); }
    const frame = { version: CONTROL_VERSION, identity: { setId: "set", generation: 1, runId: "run" }, model: ARM_MODEL, sequence: 1, firstTick: 2, lastTick: 3, rows: channel.readRows(2, 3) };
    const recording = new ArmRecording(); recording.accept(frame); frame.rows.fill(999);
    expect(recording.samples().map(p => p.tick)).toEqual([2, 3]); expect(recording.samples()[0]!.requestedTorque).toBe(0.5);
    expect(() => recording.accept({ ...frame, sequence: 2, rows: channel.readRows(2, 3), identity: { ...frame.identity, runId: "old" } })).toThrow("Obsolete");
    recording.accept({ ...frame, sequence: 2, firstTick: 0, rows: channel.readRows(0, 3) });
    expect(recording.samples().map(p => p.tick)).toEqual([0, 1, 2, 3]);
  });
  it("plots interval torque over the preceding interval and breaks at missing or invalid states", () => {
    const a = sample(1, 0.5), b = sample(2, 0.7), c = sample(4, 0.8);
    expect(armPlotPath([a, b], p => p.angle, x => x, y => y, true)).toBe("M0,0.5L1,0.5L1,0.7L2,0.7");
    expect(armPlotPath([a, b, c], p => p.angle, x => x, y => y)).toBe("M1,0.5L2,0.7M4,0.8");
    expect(armPlotPath([a, { ...b, acceleration: null }, c], p => p.acceleration, x => x, y => y)).toBe("M1,0M4,0");
  });
  it("accepts only bounded registered extra plots", () => {
    expect(snapshotArmSeries(["speed", "torque"])).toEqual(["speed", "torque"]);
    for (const value of [["torque", "torque"], ["unknown"], [,], "speed"]) expect(() => snapshotArmSeries(value)).toThrow();
  });
});
