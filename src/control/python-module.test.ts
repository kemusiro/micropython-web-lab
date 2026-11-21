import { describe, expect, it } from "vitest";
import { ArmPythonBridge } from "./python-module";
import { CONTROL_VERSION, SharedArmChannel } from "./channel";
import { DEFAULT_ARM_CONTROL } from "../physics/arm-control";
import { OneAxisArm } from "../physics/one-axis-arm";
import type { MicroPythonInstance } from "../vendor/micropython";

describe("Python allowlist lifecycle", () => {
  it("returns only primitive snapshots, restricts handles and invalidates the bridge after execution", () => {
    const channel = SharedArmChannel.create(1); channel.publish(new OneAxisArm().read());
    const bridge = new ArmPythonBridge({ kind: "arm", version: CONTROL_VERSION, identity: { setId: "set", generation: 1, runId: "run" }, conditions: DEFAULT_ARM_CONTROL, buffer: channel.buffer });
    let api: any;
    bridge.install({ registerJsModule: (_name: string, module: unknown) => { api = module; }, runPython: () => {} } as unknown as MicroPythonInstance);
    const call = (operation: string, token = 0, value: unknown = 0) => JSON.parse(api.invoke(operation, token, value));
    expect(call("open").ok).toBe(false); bridge.begin(); expect(call("open").value).toBe(1);
    expect(call("open").error).toContain("one Experiment"); expect(call("read", 2).error).toContain("Obsolete");
    expect(call("read", 1).value).toEqual([0, 0]);
    const params = call("parameters", 1).value; params.kp = 500; expect(call("parameters", 1).value.kp).toBe(1.2);
    for (const value of [NaN, Infinity, '"1"', null, "true", "NaN"]) expect(call("torque", 1, value).ok).toBe(false);
    expect(call("constructor", 1).ok).toBe(false);
    bridge.end(); expect(call("read", 1).error).toContain("Obsolete"); expect(() => bridge.begin()).toThrow("fresh");
    expect(Object.getPrototypeOf(api)).toBeNull(); expect(Object.getPrototypeOf(api.invoke)).toBeNull();
    expect(api.constructor).toBeUndefined(); expect(api.invoke.constructor).toBeUndefined(); expect(Object.getPrototypeOf(api.invoke.call)).toBeNull();
    expect(Object.values(api).every(value => typeof value === "function")).toBe(true);
  });
});
