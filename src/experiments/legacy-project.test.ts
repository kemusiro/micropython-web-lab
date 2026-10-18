import { describe, expect, it } from "vitest";
import { MANAGED_CONNECTION_GRAPH } from "../connections/managed-connection-graph";
import { validateConnectionGraph } from "../connections/connection-model";
import { ProjectFiles } from "../project/filesystem";
import { snapshotStoredProject, type StoredProject } from "../project/project-state";
import { ProjectWorkspace } from "../project/workspace";
import { captureLegacyBoardExperiment } from "./legacy-project";

function project(): StoredProject {
  const files = new ProjectFiles();
  files.mkdir("empty");
  files.write("main.py", new Uint8Array([255, 0])); // Written by Python, not the old editor buffer.
  return { version: 1, filesystem: files.snapshot(), tabs: [
    { id: "main", path: "main.py", title: "main.py", source: "print('old editor buffer')" },
    { id: "draft", title: "無題", source: "print('draft')" },
  ], activeTabId: "draft" };
}

describe("current project to board experiment adapter", () => {
  it("round-trips captured data through the workspace port with dirty buffers intact", async () => {
    const original = project();
    const captured = captureLegacyBoardExperiment(original, MANAGED_CONNECTION_GRAPH);
    let committed = captured.project;
    const workspace = new ProjectWorkspace({
      load: async () => snapshotStoredProject(committed),
      save: async value => { committed = snapshotStoredProject(value); },
    });
    const restored = await workspace.load(original.tabs, original.activeTabId);
    expect(restored).toEqual(original);
    expect(restored.tabs.every(tab => workspace.isTabUnsaved(tab))).toBe(true);
    await workspace.save(restored.tabs, restored.activeTabId);
    const recaptured = captureLegacyBoardExperiment(committed, captured.environment.connectionGraph);
    expect(recaptured).toEqual(captured);
    expect(workspace.files.get("main.py")).toMatchObject({ data: new Uint8Array([255, 0]) });
    expect(workspace.files.snapshot().entries).toHaveLength(2);
    expect(restored.tabs.every(tab => workspace.isTabUnsaved(tab))).toBe(true);
  });

  it("detaches the applied graph and project from live editing", () => {
    const input = project();
    const graph = structuredClone(MANAGED_CONNECTION_GRAPH);
    const captured = captureLegacyBoardExperiment(input, graph);
    input.tabs.splice(0);
    // The validator returns frozen copies; callers cannot change the captured graph.
    expect(captured.environment.connectionGraph).not.toBe(graph);
    expect(captured.environment.connectionGraph.devices[0]).not.toBe(graph.devices[0]);
    expect(Object.isFrozen(captured.environment.connectionGraph.devices[0]!.ports[0]!.endpoint)).toBe(true);
    expect(captured.project.tabs).toHaveLength(2);
  });

  it("preserves unknown but well-formed board and device references without substituting versions", () => {
    const graph = { schemaVersion: 1, boardProfile: { id: "future-board", version: 99 }, devices: [
      { instanceId: "future", deviceId: "future-device", deviceVersion: "99.0.0", ports: [] },
    ] };
    expect(captureLegacyBoardExperiment(project(), graph).environment.connectionGraph).toEqual(graph);
  });

  it.each([null, {}, { ...MANAGED_CONNECTION_GRAPH, schemaVersion: 2 }])(
    "rejects an invalid graph without changing recoverable project data: %j", graph => {
      const input = project();
      const before = structuredClone(input);
      expect(() => captureLegacyBoardExperiment(input, graph)).toThrow();
      expect(input).toEqual(before);
    },
  );

  it("enforces the existing connection storage budget even for structurally valid graphs", () => {
    const graph = { schemaVersion: 1, boardProfile: MANAGED_CONNECTION_GRAPH.boardProfile,
      devices: Array.from({ length: 64 }, (_, i) => ({
        instanceId: `device-${i}`, deviceId: "device", deviceVersion: "1.0.0",
        ports: Array.from({ length: 32 }, (_, j) => ({ portId: `port-${j}`, endpoint: { kind: "gpio", pin: "GP0" } })),
      })),
    };
    expect(() => validateConnectionGraph(graph)).not.toThrow();
    expect(() => captureLegacyBoardExperiment(project(), graph)).toThrow("64 KiB");
  });
});
