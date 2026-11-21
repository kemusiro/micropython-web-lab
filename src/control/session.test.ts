import { afterEach, describe, expect, it, vi } from "vitest";
import { ArmRuntimeSession, type SimulationWorker } from "./session";
import { CONTROL_VERSION, CONTROL_START_TIMEOUT_MS, SharedArmChannel, type ArmRuntimeProfile } from "./channel";
import { DEFAULT_ARM_CONTROL } from "../physics/arm-control";
import { ARM_MODEL, OneAxisArm } from "../physics/one-axis-arm";
import { RUNTIME_PROTOCOL_VERSION, type MainToWorkerMessage } from "../runtime/protocol";
import type { RuntimeWorker } from "../runtime/client";

class Runtime implements RuntimeWorker {
  onmessage: RuntimeWorker["onmessage"] = null; onerror: RuntimeWorker["onerror"] = null; onmessageerror: RuntimeWorker["onmessageerror"] = null;
  terminate = vi.fn(); messages: MainToWorkerMessage[] = [];
  postMessage(message: MainToWorkerMessage) { this.messages.push(message); }
  ready(capabilities?: readonly "arm-control-v1"[]) { this.onmessage?.({ data: { version: RUNTIME_PROTOCOL_VERSION, type: "ready", micropythonVersion: "test", capabilities,
    runtimeBuild: { sourceVersion: "test", sourceCommit: "0".repeat(40), variant: "test" } } } as MessageEvent); }
}
class Simulation implements SimulationWorker {
  onmessage: SimulationWorker["onmessage"] = null; onerror: SimulationWorker["onerror"] = null; onmessageerror: SimulationWorker["onmessageerror"] = null;
  terminate = vi.fn(); profile!: ArmRuntimeProfile;
  postMessage(profile: ArmRuntimeProfile) { this.profile = profile; }
  ready() { const c = SharedArmChannel.attach(this.profile.buffer, this.profile.identity.generation); c.publish(new OneAxisArm().read());
    this.emit({ version: CONTROL_VERSION, type: "ready", identity: this.profile.identity, model: ARM_MODEL }); }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
function setup() {
  vi.stubGlobal("crossOriginIsolated", true);
  const runtime = new Runtime(), simulation = new Simulation();
  const session = new ArmRuntimeSession({ setId: "set", generation: 3, conditions: DEFAULT_ARM_CONTROL,
    runtimeFactory: () => runtime, simulationFactory: () => simulation });
  return { session, runtime, simulation };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("paired arm Worker lifecycle", () => {
  it("starts both explicit model profiles without executing code and requires capability confirmation", async () => {
    const { session, runtime, simulation } = setup(); const startup = session.start();
    simulation.ready(); expect(session.status).toBe("starting"); runtime.ready(["arm-control-v1"]); await startup;
    expect(session.status).toBe("ready"); expect(runtime.messages).toHaveLength(1);
    const message = runtime.messages[0]!; expect(message.type).toBe("start");
    if (message.type !== "start") throw new Error("start expected");
    expect(message.runtimeProfile?.identity).toEqual(session.identity); expect(message.connectionGraph).toBeUndefined();
    session.stop(); expect(runtime.terminate).toHaveBeenCalledOnce(); expect(simulation.terminate).toHaveBeenCalledOnce();
    await expect(session.start()).rejects.toThrow("fresh");
  });
  it("rejects missing isolation before making either Worker", async () => {
    const { session, runtime, simulation } = setup(); vi.stubGlobal("crossOriginIsolated", false);
    await expect(session.start()).rejects.toThrow("isolation");
    expect(runtime.messages).toHaveLength(0); expect(simulation.profile).toBeUndefined();
  });
  it("rejects an old runtime without model capability and terminates both Workers", async () => {
    const { session, runtime, simulation } = setup(); const startup = session.start();
    simulation.ready(); runtime.ready(); await expect(startup).rejects.toThrow("capability");
    expect(runtime.terminate).toHaveBeenCalledOnce(); expect(simulation.terminate).toHaveBeenCalledOnce();
  });
  it("times out startup and cancels shared waits even if neither peer reports ready", async () => {
    vi.useFakeTimers(); const { session, runtime, simulation } = setup();
    const startup = session.start(); const rejected = expect(startup).rejects.toThrow("timed out");
    vi.advanceTimersByTime(CONTROL_START_TIMEOUT_MS); await rejected;
    expect(runtime.terminate).toHaveBeenCalledOnce(); expect(simulation.terminate).toHaveBeenCalledOnce();
    const channel = SharedArmChannel.attach(simulation.profile.buffer, 3); expect(() => channel.assertLive()).toThrow("cancelled");
  });
  it("ignores another run's progress but rejects malformed current progress and cancels the pair", async () => {
    const { session, runtime, simulation } = setup(); const startup = session.start(); simulation.ready(); runtime.ready(["arm-control-v1"]); await startup;
    simulation.emit({ version: 1, type: "progress", identity: { ...session.identity, runId: "old" }, model: ARM_MODEL, sequence: 1, tick: 0, lagMs: 0 });
    expect(session.status).toBe("ready");
    simulation.emit({ version: 1, type: "progress", identity: session.identity, model: ARM_MODEL, sequence: 1, tick: 1001, lagMs: 0 });
    expect(session.status).toBe("failed"); expect(runtime.terminate).toHaveBeenCalledOnce(); expect(simulation.terminate).toHaveBeenCalledOnce();
  });
  it("rejects a backward observation tick even when its sequence is newer and retains the committed prefix", async () => {
    const { session, runtime, simulation } = setup(); const startup = session.start(); simulation.ready(); runtime.ready(["arm-control-v1"]); await startup;
    const executing = session.execute("pass");
    await vi.waitFor(() => expect(runtime.messages.some(message => message.type === "execute")).toBe(true));
    const channel = SharedArmChannel.attach(simulation.profile.buffer, 3);
    Atomics.store(channel.controls, 3, 1);
    const arm = new OneAxisArm(); const result = arm.step(0.5); channel.publish(result.observation, result.interval);
    const progress = { version: 1, type: "progress", identity: session.identity, model: ARM_MODEL, sequence: 1, tick: 1, lagMs: 0 };
    simulation.emit(progress); expect(session.status).toBe("executing");
    simulation.emit({ ...progress, sequence: 2, tick: 0 });
    const finished = await executing;
    expect(finished.status).toBe("failed"); expect(finished.telemetry?.firstTick).toBe(0); expect(finished.telemetry?.lastTick).toBe(1);
    expect(runtime.terminate).toHaveBeenCalledOnce(); expect(simulation.terminate).toHaveBeenCalledOnce();
  });
  it("cleans up one peer's startup failure and ignores a previously captured late callback", async () => {
    const { session, runtime, simulation } = setup(); const startup = session.start();
    const late = simulation.onmessage!; simulation.emit({ version: 1, type: "error", message: "model unavailable" });
    await expect(startup).rejects.toThrow("unavailable");
    late({ data: { version: 1, type: "ready", identity: session.identity, model: ARM_MODEL } } as MessageEvent);
    runtime.ready(["arm-control-v1"]); expect(session.status).toBe("failed");
    expect(runtime.terminate).toHaveBeenCalledOnce(); expect(simulation.terminate).toHaveBeenCalledOnce();
  });
});
