import { describe, expect, it } from "vitest";
import { APP_SCREEN_STORAGE_KEY, loadAppScreen, saveAppScreen } from "./app-screen";
import type { DraftStorage } from "../project/editor-draft";

const fresh = { hasSavedWorkspace: false, storageError: false, localMode: false };
const storage = (value: string | null): DraftStorage => ({ getItem: () => value, setItem() {}, removeItem() {} });

describe("app screen preference", () => {
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
