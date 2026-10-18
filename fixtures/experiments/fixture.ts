import { createExperiment, experimentProject } from "../../src/experiments/record";
export { ProjectDatabase } from "../../src/project/database";
export { ProjectStore } from "../../src/project/project-store";
export { ExperimentStore } from "../../src/experiments/store";
export { ExperimentCoordinator, ExperimentProjectPersistence } from "../../src/experiments/coordinator";
export { snapshotExperiment, experimentBytes, experimentProject } from "../../src/experiments/record";

export const TEST_RUNTIME = { id: "test-runtime", version: "1.0.0", buildHash: "0".repeat(64) };
export function makeExperiment(id = "first", source = `print('draft-${id}')`) {
  return createExperiment({ version: 1, savedAt: "2026-10-18T00:00:00.000Z",
    filesystem: { version: 1, entries: [
      { kind: "directory", path: "empty" },
      { kind: "file", path: "main.py", data: new TextEncoder().encode(`print('saved-${id}')\r\n`) },
      { kind: "file", path: "data.bin", data: new Uint8Array([0, 255, 128]) },
    ] },
    tabs: [{ id: "main", title: "main.py", path: "main.py", source }, { id: "draft", title: "無題", source: "" }],
    activeTabId: "draft",
  }, { kind: "board", connectionGraph: { schemaVersion: 1,
    boardProfile: { id: "test-board", version: 1 }, devices: [{ instanceId: "button", deviceId: "test-button",
      deviceVersion: "1.0.0", ports: [{ portId: "input", endpoint: { kind: "gpio", pin: id === "first" ? "GP15" : "GP14" } }] }] } }, {
    id, title: "Same title", origin: { kind: "template", id: "test-template", version: "1.0.0", hash: "1".repeat(64) },
    runtimeRef: TEST_RUNTIME, now: "2026-10-18T00:00:00.000Z",
  });
}
export function migrationOptions() {
  const record = makeExperiment();
  return { fallback: experimentProject(record), environment: record.environment, runtimeRef: TEST_RUNTIME };
}

export async function seedLegacy(name: string, value = experimentProject(makeExperiment())): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("project");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("project", "readwrite");
      tx.objectStore("project").put(value, "current");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function rawValue(db: IDBDatabase, store: string, key = "current"): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Abort after a real put succeeds, while all writes still belong to the same transaction. */
export function abortAfterPut(ordinal: number): () => void {
  const original = IDBObjectStore.prototype.put;
  let count = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
    const request = original.apply(this, args);
    if (["experimentSets", "experimentWorkspace"].includes(this.name) && ++count === ordinal) {
      request.onsuccess = () => this.transaction.abort();
    }
    return request;
  };
  return () => { IDBObjectStore.prototype.put = original; };
}
