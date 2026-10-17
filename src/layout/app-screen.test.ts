import { describe, expect, it } from "vitest";
import { APP_SCREEN_STORAGE_KEY, EXPERIMENT_TOPIC_STORAGE_KEY, loadAppScreen, saveAppScreen, loadExperimentTopic, saveExperimentTopic } from "./app-screen";
import type { DraftStorage } from "../project/editor-draft";

const fresh = { hasSavedWorkspace: false, storageError: false, localMode: false };
const storage = (value: string | null): DraftStorage => ({ getItem: () => value, setItem() {}, removeItem() {} });

describe("app screen preference", () => {
  it("restores button experiments and defaults existing or unknown preferences to LED", () => {
    expect(loadExperimentTopic(storage("button"))).toBe("button");
    expect(loadExperimentTopic(storage("led"))).toBe("led");
    expect(loadExperimentTopic(storage("unknown"))).toBe("led");
    expect(loadExperimentTopic(null)).toBe("led");
    const writes: [string, string][] = [];
    saveExperimentTopic({ ...storage(null), setItem: (key, value) => { writes.push([key, value]); } }, "button");
    expect(writes).toEqual([[EXPERIMENT_TOPIC_STORAGE_KEY, "button"]]);
  });
  it("tolerates unavailable topic storage", () => {
    const failing: DraftStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() {},
    };
    expect(loadExperimentTopic(failing)).toBe("led");
    expect(() => saveExperimentTopic(failing, "button")).not.toThrow();
    expect(() => saveExperimentTopic(null, "button")).not.toThrow();
  });
  it("starts a fresh browser in the experiment and existing projects in the workspace", () => {
    expect(loadAppScreen(storage(null), fresh)).toBe("experiment");
    expect(loadAppScreen(storage(null), { ...fresh, hasSavedWorkspace: true })).toBe("workspace");
  });
  it("restores an explicit choice and ignores unknown values", () => {
    expect(loadAppScreen(storage("experiment"), { ...fresh, hasSavedWorkspace: true })).toBe("experiment");
    expect(loadAppScreen(storage("workspace"), fresh)).toBe("workspace");
    expect(loadAppScreen(storage("unknown"), fresh)).toBe("experiment");
  });
  it("keeps local device development and damaged saved data in the full workspace", () => {
    expect(loadAppScreen(storage("experiment"), { ...fresh, localMode: true })).toBe("workspace");
    expect(loadAppScreen(storage("experiment"), { ...fresh, storageError: true })).toBe("workspace");
  });
  it("works without storage and tolerates read and write failures", () => {
    const failing: DraftStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() {},
    };
    expect(loadAppScreen(null, fresh)).toBe("experiment");
    expect(loadAppScreen(failing, fresh)).toBe("experiment");
    expect(() => saveAppScreen(failing, "workspace")).not.toThrow();
    expect(() => saveAppScreen(null, "experiment")).not.toThrow();
  });
  it("writes only the independent presentation preference", () => {
    const writes: [string, string][] = [];
    saveAppScreen({ ...storage(null), setItem: (key, value) => { writes.push([key, value]); } }, "workspace");
    expect(writes).toEqual([[APP_SCREEN_STORAGE_KEY, "workspace"]]);
  });
});
