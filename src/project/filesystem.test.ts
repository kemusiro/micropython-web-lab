import { describe, expect, it } from "vitest";
import { MAX_PROJECT_BYTES, ProjectFiles, projectPath, validateProjectSnapshot } from "./filesystem";
describe("project files", () => {
  it("creates parents, preserves empty directories and renames descendants", () => {
    const fs = new ProjectFiles(); fs.write("drivers/sensor.py", new Uint8Array([1])); fs.mkdir("empty"); fs.rename("drivers", "lib/drivers");
    expect(fs.get("lib/drivers/sensor.py")).toBeDefined(); expect(fs.get("empty")).toEqual({ kind: "directory", path: "empty" });
    expect(() => fs.remove("lib")).toThrow();
  });
  it("makes oversized writes atomic and counts bytes", () => {
    const fs = new ProjectFiles(); fs.write("full", new Uint8Array(MAX_PROJECT_BYTES));
    expect(() => fs.write("other", new Uint8Array([1]))).toThrow(); expect(fs.get("other")).toBeUndefined();
    fs.write("full", new Uint8Array([2])); expect(fs.usedBytes).toBe(1);
  });
  it.each(["../main.py", "/main.py", "a/../b", "a\\b", "a//b", "C:/main.py", "a\0b"])("rejects unsafe path %s", path => expect(() => projectPath(path)).toThrow());
  it("rejects duplicate and conflicting paths", () => {
    expect(() => validateProjectSnapshot({ version: 1, entries: [{ path: "a", kind: "directory" }, { path: "a", kind: "directory" }] })).toThrow();
    expect(() => validateProjectSnapshot({ version: 1, entries: [{ path: "a/b", kind: "file", data: new Uint8Array() }] })).toThrow();
  });
});
