import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRuntime } from "./workspace-runtime";
import type { ArmRunResult, ArmSessionOptions } from "../control/session";
import { DEFAULT_ARM_CONTROL } from "../physics/arm-control";
import { ARM_MODEL } from "../physics/one-axis-arm";
import { MANAGED_EXPERIMENT_RUNTIME } from "../runtime/build-reference";
import { RUNTIME_PROTOCOL_VERSION } from "../runtime/protocol";

function setup() {
  vi.stubGlobal("crossOriginIsolated", true);
  const created: { options: ArmSessionOptions; stop: ReturnType<typeof vi.fn>; finish(result: ArmRunResult): void }[] = [];
  const handlers = { onMessage: vi.fn(), onStatus: vi.fn(), onArmFrame: vi.fn(), onArmResult: vi.fn(), onCheckpoint: vi.fn(async () => {}) };
  const runtime = new WorkspaceRuntime(handlers, {}, () => { throw new Error("A board must not start for a model"); }, options => {
    let finish!: (result: ArmRunResult) => void;
    const result = new Promise<ArmRunResult>(resolve => { finish = resolve; });
    const stop = vi.fn(); created.push({ options, stop, finish });
    return { start: async () => {}, execute: async () => result, stop };
  });
  runtime.configureModel({ session: { setId: "set", generation: 2 }, conditions: DEFAULT_ARM_CONTROL });
  const result = (status: ArmRunResult["status"] = "completed"): ArmRunResult => ({ status, project: { version: 1, entries: [] }, telemetry: null,
    metadata: { identity: { setId: "set", generation: 2, runId: "run" }, sourceHash: "0".repeat(64), projectHash: "1".repeat(64),
      runtimeProtocol: RUNTIME_PROTOCOL_VERSION, controlProtocol: 1, controlPeriodUs: 10000, integrationStepUs: 1000,
      conditions: DEFAULT_ARM_CONTROL, model: ARM_MODEL, runtime: MANAGED_EXPERIMENT_RUNTIME } });
  return { runtime, created, handlers, result };
}
afterEach(() => vi.unstubAllGlobals());
describe("workspace runtime routing", () => {
  it("opens a model without executing code and uses current files in a fresh pair for each run", async () => {
    const { runtime, created, handlers, result } = setup(); runtime.start();
    expect(runtime.status).toBe("ready"); expect(created).toHaveLength(0);
    runtime.setProject({ version: 1, entries: [{ kind: "file", path: "data.bin", data: new Uint8Array([255]) }] });
    expect(runtime.executeScript("pass")).toBe(true); expect(runtime.executeScript("again")).toBe(false);
    expect(created[0]!.options.project?.entries[0]).toMatchObject({ data: new Uint8Array([255]) });
    await Promise.resolve(); created[0]!.finish(result()); await runtime.settled();
    expect(runtime.status).toBe("ready"); expect(handlers.onArmResult).toHaveBeenCalledOnce();
    runtime.executeScript("again"); expect(created).toHaveLength(2);
    const messages = handlers.onMessage.mock.calls.length; created[0]!.options.onOutput?.("stdout", "late previous run");
    expect(handlers.onMessage.mock.calls.length).toBe(messages);
    await Promise.resolve(); created[1]!.finish(result()); await runtime.settled();
    expect(created[0]!.stop).toHaveBeenCalled(); expect(created[1]!.stop).toHaveBeenCalled();
  });
  it("forwards file checkpoints and retains a stopped run before a switch can install another set", async () => {
    const { runtime, created, handlers, result } = setup(); runtime.start(); runtime.executeScript("pass"); await Promise.resolve();
    created[0]!.options.onProject?.({ version: 1, entries: [] }); await created[0]!.options.onCheckpoint?.();
    expect(handlers.onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "filesystem" })); expect(handlers.onCheckpoint).toHaveBeenCalledOnce();
    runtime.stop(); created[0]!.finish(result("stopped")); await runtime.settled();
    expect(runtime.status).toBe("stopped"); expect(handlers.onArmResult).toHaveBeenCalledWith(expect.objectContaining({ status: "stopped" }));
    const messages = handlers.onMessage.mock.calls.length;
    runtime.configureModel({ session: { setId: "other", generation: 3 }, conditions: DEFAULT_ARM_CONTROL });
    created[0]!.options.onOutput?.("stdout", "late"); created[0]!.options.onProject?.({ version: 1, entries: [] });
    expect(handlers.onMessage.mock.calls.length).toBe(messages);
  });
  it("rejects board operations and missing isolation without creating a pair", () => {
    const { runtime, created } = setup(); runtime.start();
    expect(runtime.sendInput("print(1)")).toBe(false); expect(runtime.sendDebuggerCommand("c")).toBe(false);
    expect(runtime.executeScript("pass", "debug")).toBe(false);
    expect(() => runtime.setConnectionGraph({} as any)).toThrow("no board");
    runtime.stop(); vi.stubGlobal("crossOriginIsolated", false); runtime.start(); expect(runtime.status).toBe("error"); expect(created).toHaveLength(0);
  });
});
