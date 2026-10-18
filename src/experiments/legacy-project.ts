import { validateConnectionGraph, type ConnectionGraphV1 } from "../connections/connection-model";
import { MAX_CONNECTION_PROJECT_BYTES } from "../project/connection-project";
import { snapshotStoredProject, type StoredProject } from "../project/project-state";

/** In-memory input for migration; this is not a new persistence format. */
export interface LegacyBoardExperiment {
  readonly project: StoredProject;
  readonly environment: {
    readonly kind: "board";
    readonly connectionGraph: ConnectionGraphV1;
  };
}

/** Capture only project data and the applied graph, without reading or writing storage. */
export function captureLegacyBoardExperiment(project: unknown, connectionGraph: unknown): LegacyBoardExperiment {
  const captured = snapshotStoredProject(project);
  const graph = validateConnectionGraph(connectionGraph);
  // Include the existing envelope when enforcing the legacy 64 KiB budget.
  const envelope = { schemaVersion: 1, savedAt: new Date(0).toISOString(), graph };
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_CONNECTION_PROJECT_BYTES) {
    throw new Error("Connection project exceeds 64 KiB");
  }
  return { project: captured, environment: { kind: "board", connectionGraph: graph } };
}
