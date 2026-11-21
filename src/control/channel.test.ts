import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTROL_BYTES, CONTROL_HEADER as H, CONTROL_VERSION, SharedArmChannel, snapshotArmProfile, validateTelemetry } from "./channel";
import { DEFAULT_ARM_CONTROL } from "../physics/arm-control";
import { ARM_MODEL, OneAxisArm } from "../physics/one-axis-arm";

afterEach(() => vi.restoreAllMocks());
function setup() { const channel = SharedArmChannel.create(7), arm = new OneAxisArm(); channel.publish(arm.read()); return { channel, arm }; }
const identity = { setId: "set", generation: 7, runId: "run" };
describe("bounded arm transport", () => {
  it("requires a fixed layout, version, generation and strict model conditions", () => {
    const { channel } = setup();
    expect(channel.buffer.byteLength).toBe(CONTROL_BYTES); expect(CONTROL_BYTES).toBeLessThan(128 * 1024);
    expect(SharedArmChannel.attach(channel.buffer, 7).tick).toBe(0);
    expect(() => SharedArmChannel.attach(channel.buffer, 8)).toThrow("generation");
    expect(() => SharedArmChannel.attach(new SharedArrayBuffer(8), 7)).toThrow("size");
    expect(() => snapshotArmProfile({ kind: "unknown", version: CONTROL_VERSION })).toThrow();
    const profile = { kind: "arm", version: CONTROL_VERSION, identity, conditions: DEFAULT_ARM_CONTROL, buffer: channel.buffer };
    expect(snapshotArmProfile(profile).conditions).not.toBe(DEFAULT_ARM_CONTROL);
    expect(() => snapshotArmProfile({ ...profile, version: 2 })).toThrow();
    expect(() => snapshotArmProfile({ ...profile, conditions: { ...DEFAULT_ARM_CONTROL, targetAngleRad: NaN } })).toThrow();
    Atomics.store(channel.controls, H.version, 77); expect(() => channel.readRows(0)).toThrow("version");
  });
  it("publishes one immutable prefix and keeps request/completion consistent", () => {
    const { channel, arm } = setup(); const before = channel.readRows(0);
    vi.spyOn(Atomics, "wait").mockImplementation(() => {
      expect(channel.requested).toBe(1); expect(channel.completed).toBe(0);
      const result = arm.step(channel.torque); channel.publish(result.observation, result.interval); return "ok";
    });
    channel.step(0.7, 100);
    expect(channel.tick).toBe(1); expect(channel.completed).toBe(1);
    expect(channel.readRows(0, 0)).toEqual(before); expect(channel.readRows(1)[7]).toBe(0.7);
    const copy = channel.readRows(0); copy[0] = 123; expect(channel.readRows(0)[0]).toBe(0);
    expect(() => channel.publish(arm.trace().observations[0]!)).toThrow("order");
  });
  it("cancels a waiting caller and rejects late completions or faulted generations", () => {
    const { channel } = setup();
    vi.spyOn(Atomics, "wait").mockImplementation(() => { channel.cancel(); return "ok"; });
    expect(() => channel.step(1, 100)).toThrow("cancelled");
    expect(() => channel.step(1, 100)).toThrow("cancelled");
    const next = setup().channel;
    vi.mocked(Atomics.wait).mockImplementation(() => { Atomics.store(next.controls, H.complete, 3); return "ok"; });
    expect(() => next.step(1, 100)).toThrow("Out-of-order");
    const fault = setup().channel; fault.fail(); expect(() => fault.step(1, 100)).toThrow("failed");
  });
  it("times out a peer that never completes instead of treating a spurious wake as success", () => {
    const { channel } = setup();
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(Atomics, "wait").mockImplementation(() => { now += 300; return "ok"; });
    expect(() => channel.step(1, 100)).toThrow("timed out");
    expect(channel.tick).toBe(0); expect(Atomics.load(channel.controls, H.fault)).toBe(1);
  });
  it("rejects completion observed after the deadline while retaining its committed row", () => {
    const { channel, arm } = setup();
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(Atomics, "wait").mockImplementation(() => {
      now = 1001;
      const result = arm.step(channel.torque); channel.publish(result.observation, result.interval);
      return "ok";
    });
    expect(() => channel.step(1, 100)).toThrow("timed out");
    expect(channel.tick).toBe(1); expect(channel.readRows(1)[7]).toBe(1);
    expect(Atomics.load(channel.controls, H.fault)).toBe(1);
  });
  it.each([NaN, Infinity, -Infinity, "1", null])("rejects torque %s without publishing a request", torque => {
    const { channel } = setup(); expect(() => channel.step(torque as number, 100)).toThrow(); expect(channel.requested).toBe(0);
  });
  it("rejects unfinished startup, nonsequential publication and exhausted or invalid lengths", () => {
    const channel = SharedArmChannel.create(7); expect(() => channel.step(1, 100)).toThrow();
    const initialized = setup();
    for (const limit of [0, 1001, NaN]) expect(() => initialized.channel.step(1, limit)).toThrow();
    expect(() => initialized.channel.publish({ ...initialized.arm.read(), tick: 2 })).toThrow();
    Atomics.store(initialized.channel.controls, H.complete, 1);
    Atomics.store(initialized.channel.controls, H.request, 1);
    Atomics.store(initialized.channel.controls, H.tick, 1);
    expect(() => initialized.channel.step(1, 1)).toThrow();
  });
  it("validates bounded finite telemetry and fixed flags before a view can consume it", () => {
    const { channel } = setup();
    const frame = { version: CONTROL_VERSION, identity, model: ARM_MODEL, sequence: 1, firstTick: 0, lastTick: 0, rows: channel.readRows(0) };
    expect(validateTelemetry(frame)).toBe(frame);
    for (const change of [{ sequence: 0 }, { lastTick: 128 }, { firstTick: -1 }, { model: { ...ARM_MODEL, version: "2" } }, { rows: new Float64Array(1) }]) expect(() => validateTelemetry({ ...frame, ...change })).toThrow();
    for (const [slot, value] of [[0, NaN], [0, 10], [8, 2], [9, 32], [10, 2]]) {
      const rows = frame.rows.slice(); rows[slot!] = value!;
      expect(() => validateTelemetry({ ...frame, rows })).toThrow();
    }
  });
});
