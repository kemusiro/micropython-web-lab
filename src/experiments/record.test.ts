import { describe, expect, it } from "vitest";
import { makeExperiment } from "../../fixtures/experiments/fixture";
import { applyExperimentContent, checkExperimentQuota, createExperiment, experimentBytes, experimentProject, MAX_EXPERIMENT_TOTAL_BYTES, snapshotExperiment } from "./record";

describe("experiment record contract", () => {
  it("assigns separate IDs to user copies without changing the template", () => {
    const template = makeExperiment("template");
    const options = { title: template.title, origin: template.origin, runtimeRef: template.runtimeRef };
    const first = createExperiment(experimentProject(template), template.environment, options);
    const second = createExperiment(experimentProject(template), template.environment, options);
    expect(new Set([template.id, first.id, second.id]).size).toBe(3);
    first.editor.tabs[0] = { ...first.editor.tabs[0]!, source: "changed copy" };
    expect(template.editor.tabs[0]!.source).toBe(second.editor.tabs[0]!.source);
  });
  it("keeps copies independent even when they have the same title and template", () => {
    const first = makeExperiment("first");
    const second = snapshotExperiment({ ...first, id: "second" });
    const file = second.filesystem.entries[2]!;
    if (file.kind !== "file") throw new Error("Expected file");
    file.data.fill(42);
    second.editor.tabs.splice(0);
    expect(first.editor.tabs).toHaveLength(2);
    expect(first.filesystem.entries[2]).toMatchObject({ data: new Uint8Array([0, 255, 128]) });
    expect(first.title).toBe(second.title);
    expect(first.id).not.toBe(second.id);
  });
  it("does not accept identity/revision changes from a content update", () => {
    const first = makeExperiment("first");
    const update = { ...makeExperiment("other"), revision: 99 };
    const result = applyExperimentContent(first, update);
    expect(result.id).toBe("first");
    expect(result.revision).toBe(1);
    expect(result.editor).toEqual(update.editor);
  });
  it("does not serialize execution state or executable fields", () => {
    const input = makeExperiment();
    const result = snapshotExperiment({ ...input, runtime: { executing: true }, renderer: () => {} });
    expect(result).toEqual(input);
    expect(result).not.toHaveProperty("runtime");
    expect(result).not.toHaveProperty("renderer");
  });
  it.each([
    ["unknown schema", { recordVersion: 2 }],
    ["invalid revision", { revision: Number.MAX_SAFE_INTEGER + 1 }],
    ["invalid date", { createdAt: "invalid" }],
    ["empty title", { title: "" }],
    ["invalid runtime reference", { runtimeRef: { id: "test", version: "1", buildHash: "wrong" } }],
    ["unknown model", { environment: { kind: "model", id: "unknown" } }],
    ["invalid policy", { runPolicy: { kind: "unlimited-server" } }],
    ["nonfinite input", { initialConditions: { inputs: { torque: Infinity } } }],
    ["duplicate view order", { view: { id: "devices-v1", section: "experience", deviceOrder: ["button", "button"] } }],
    ["sparse view order", { view: { id: "devices-v1", section: "experience", deviceOrder: [,] } }],
  ])("rejects %s without changing recoverable source data", (_name, changes) => {
    const original = makeExperiment();
    expect(() => snapshotExperiment({ ...original, ...changes })).toThrow();
    expect(original.editor.tabs[0]!.source).toContain("draft-first");
  });
  it("counts UTF-8 buffers and raw binary bytes without JSON-expanding the binary", () => {
    const first = makeExperiment("one", "a");
    const unicode = makeExperiment("one", "あ");
    expect(experimentBytes(unicode) - experimentBytes(first)).toBe(2);
    const changed = snapshotExperiment(first);
    changed.filesystem.entries[2] = { kind: "file", path: "data.bin", data: new Uint8Array([255, 255, 255]) };
    expect(experimentBytes(changed)).toBe(experimentBytes(first));
    changed.filesystem.entries[2] = { kind: "file", path: "data.bin", data: new Uint8Array(103) };
    expect(experimentBytes(changed) - experimentBytes(first)).toBe(100);
  });
  it("enforces quota boundaries and permits shrinking existing over-limit data", () => {
    expect(() => checkExperimentQuota([], Array(16).fill(1))).not.toThrow();
    expect(() => checkExperimentQuota(Array(16).fill(1), Array(17).fill(1))).toThrow("16");
    expect(() => checkExperimentQuota([], [MAX_EXPERIMENT_TOTAL_BYTES])).not.toThrow();
    expect(() => checkExperimentQuota([], [MAX_EXPERIMENT_TOTAL_BYTES + 1])).toThrow("64 MiB");
    expect(() => checkExperimentQuota([MAX_EXPERIMENT_TOTAL_BYTES + 2], [MAX_EXPERIMENT_TOTAL_BYTES + 1])).not.toThrow();
  });
});
