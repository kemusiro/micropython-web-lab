import { describe, expect, it } from "vitest";
import { loadMicroPython } from "../vendor/micropython-build/micropython.mjs";
import { RuntimeProjectFilesystem, type EmscriptenFs } from "./project-filesystem";
import { MAX_PROJECT_BYTES, ProjectFiles } from "../project/filesystem";

async function fixture(project = new ProjectFiles()) {
  const output: string[] = [];
  const mp = await loadMicroPython({ url: new URL("../vendor/micropython-build/micropython.wasm", import.meta.url).href, linebuffer: false, stdout: bytes => output.push(new TextDecoder().decode(bytes)) });
  const fs = (mp as unknown as { FS: EmscriptenFs }).FS;
  const messages: unknown[] = [];
  const gate = new SharedArrayBuffer(4);
  const filesystem = new RuntimeProjectFilesystem(fs, project.snapshot(), gate, (snapshot, revision) => messages.push({ snapshot, revision }));
  mp.runPython("import sys\nsys.path[:] = ['/project', '/project/lib']");
  return { mp, fs, filesystem, messages, gate, output };
}

describe("bounded MicroPython project filesystem", () => {
  it("imports files and packages and checkpoints binary writes, renames and deletes", async () => {
    const project = new ProjectFiles();
    project.write("drivers/__init__.py", new TextEncoder().encode("from .sensor import answer\n"));
    project.write("drivers/sensor.py", new TextEncoder().encode("answer = 42\n"));
    const { mp, filesystem, messages, output } = await fixture(project);
    mp.runPython("from drivers import answer\nprint(answer)\nimport os\nwith open('data.bin', 'wb') as f:\n f.write(bytes([0, 255, 42]))\nos.rename('data.bin', 'renamed.bin')\nos.mkdir('empty')\nos.rmdir('empty')");
    mp.runPython("open('empty.txt', 'w').close()");
    filesystem.flush(true);
    expect(filesystem.snapshot().entries).toContainEqual({ kind: "file", path: "empty.txt", data: new Uint8Array() });
    expect(output.join("")).toContain("42\n");
    expect(filesystem.snapshot().entries).toContainEqual({ path: "renamed.bin", kind: "file", data: new Uint8Array([0, 255, 42]) });
    expect(messages.length).toBeGreaterThan(0);
    mp.runPython("os.remove('renamed.bin')");
    expect(filesystem.snapshot().entries.some(entry => entry.path === "renamed.bin")).toBe(false);
  });
  it("rejects growth before allocation, allows overwrite and releases deleted capacity", async () => {
    const project = new ProjectFiles(); project.write("full.bin", new Uint8Array(MAX_PROJECT_BYTES));
    const { mp, filesystem } = await fixture(project);
    expect(() => mp.runPython("with open('full.bin', 'ab') as f:\n f.write(b'x')")).toThrow();
    expect(() => mp.runPython("with open('hole.bin', 'wb') as f:\n f.seek(4194304)\n f.write(b'x')")).toThrow();
    mp.runPython("with open('full.bin', 'r+b') as f:\n f.write(b'x')");
    expect(filesystem.snapshot().entries.find(entry => entry.path === "full.bin")).toMatchObject({ data: expect.any(Uint8Array) });
    mp.runPython("import os\nos.remove('full.bin')\nwith open('new.bin', 'wb') as f:\n f.write(b'new')");
    expect(filesystem.snapshot().entries.find(entry => entry.path === "new.bin")).toMatchObject({ data: new TextEncoder().encode("new") });
  });
  it("denies filesystem writes outside /project and symlinks", async () => {
    const { mp, fs } = await fixture();
    expect(() => mp.runPython("open('/tmp/escape', 'w')")).toThrow();
    expect(() => mp.runPython("import os\nos.mkdir('/outside')")).toThrow();
    expect(() => mp.runPython("os.rename('/project', '/tmp/project')")).toThrow();
    const dynamicFs = fs as unknown as { symlink(target: string, path: string): void };
    expect(() => dynamicFs.symlink("/tmp", "/project/link")).toThrow();
  });
  it("retains accounting for open deleted files and bounds in-flight checkpoints", async () => {
    const { mp, filesystem, messages, gate } = await fixture();
    mp.runPython("f = open('open.bin', 'wb')\nf.write(b'x' * 4096)\nimport os\nos.remove('open.bin')\nf.write(b'y' * 4096)");
    filesystem.flush(true);
    expect(filesystem.snapshot().entries).toEqual([]);
    expect(Atomics.load(new Int32Array(gate), 0)).toBe(1);
    expect(messages.length).toBeLessThanOrEqual(2);
    mp.runPython("f.close()");
  });
  it("emits a final checkpoint even when the last mutation was already streamed", async () => {
    const { mp, filesystem, messages, gate } = await fixture();
    mp.runPython("open('empty', 'w').close()");
    Atomics.store(new Int32Array(gate), 0, 0);
    filesystem.flush(true);
    const before = messages.length;
    filesystem.flush(true);
    expect(messages.length).toBe(before);
    expect(before).toBe(2);
    expect((messages[1] as { revision: number }).revision).toBeGreaterThan((messages[0] as { revision: number }).revision);
  });
  it("preflights synchronization with retained open files without altering existing data", async () => {
    const initial = new ProjectFiles(); initial.write("held", new Uint8Array(MAX_PROJECT_BYTES - 1)); initial.write("marker", new Uint8Array([9]));
    const { mp, filesystem } = await fixture(initial);
    mp.runPython("f = open('held', 'rb')");
    const replacement = new ProjectFiles(); replacement.write("marker", new Uint8Array([8, 7]));
    expect(() => filesystem.synchronize(replacement.snapshot())).toThrow();
    expect(filesystem.snapshot().entries.find(entry => entry.path === "marker")).toMatchObject({ data: new Uint8Array([9]) });
    mp.runPython("f.close()"); filesystem.synchronize(replacement.snapshot());
    expect(filesystem.snapshot().entries).toEqual(replacement.snapshot().entries);
  });
});
