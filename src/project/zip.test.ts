import { describe, expect, it } from "vitest";
import { MAX_PROJECT_BYTES, ProjectFiles } from "./filesystem";
import { crc32, exportProjectZip, importProjectZip, projectSubtree } from "./zip";

async function ordinaryZip(name: string, data: Uint8Array, method = 8): Promise<Uint8Array> {
  const fs = new ProjectFiles(); fs.write(name, data);
  const zip = exportProjectZip(fs.snapshot());
  if (!method) return zip;
  const nameBytes = new TextEncoder().encode(name);
  const compressed = new Uint8Array(await new Response(new Blob([data.slice().buffer]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()).slice(2, -4);
  const localEnd = 30 + nameBytes.length;
  const originalCentral = localEnd + data.length;
  const next = new Uint8Array(zip.length - data.length + compressed.length);
  next.set(zip.subarray(0, localEnd)); next.set(compressed, localEnd); next.set(zip.subarray(originalCentral), localEnd + compressed.length);
  const view = new DataView(next.buffer), central = localEnd + compressed.length;
  view.setUint16(8, 8, true); view.setUint32(18, compressed.length, true);
  view.setUint16(central + 10, 8, true); view.setUint32(central + 20, compressed.length, true);
  view.setUint32(next.length - 6, central, true);
  return next;
}
describe("project ZIP", () => {
  it("round-trips ordinary UTF-8 names, bytes and empty directories without metadata", async () => {
    const fs = new ProjectFiles(); fs.write("日本語.py", new TextEncoder().encode("print('hello')\r\n")); fs.write("data/raw", new Uint8Array([0, 255])); fs.mkdir("empty");
    expect(await importProjectZip(exportProjectZip(fs.snapshot()))).toEqual(fs.snapshot());
  });
  it("imports externally compressed Deflate files", async () => {
    const data = new TextEncoder().encode("answer = 42\n");
    expect((await importProjectZip(await ordinaryZip("main.py", data))).entries).toContainEqual({ path: "main.py", kind: "file", data });
  });
  it("rejects corrupt CRC and excessive declared expansion", async () => {
    const zip = await ordinaryZip("main.py", new Uint8Array([1, 2, 3]), 0);
    zip[37] = 255; await expect(importProjectZip(zip)).rejects.toThrow();
    const bomb = await ordinaryZip("main.py", new Uint8Array([1]));
    const view = new DataView(bomb.buffer); const central = view.getUint32(bomb.length - 6, true);
    view.setUint32(central + 24, MAX_PROJECT_BYTES + 1, true);
    await expect(importProjectZip(bomb)).rejects.toThrow(/4 MiB/);
  });
  it("rejects traversal, encryption and links", async () => {
    const zip = await ordinaryZip("main.py", new Uint8Array([1]), 0); const view = new DataView(zip.buffer); const central = view.getUint32(zip.length - 6, true);
    zip.set(new TextEncoder().encode("../a.py"), 30); zip.set(new TextEncoder().encode("../a.py"), central + 46);
    await expect(importProjectZip(zip)).rejects.toThrow();
    const encrypted = await ordinaryZip("a", new Uint8Array([1]), 0); const encryptedView = new DataView(encrypted.buffer); encryptedView.setUint16(31 + 1 + 8, 1, true);
    await expect(importProjectZip(encrypted)).rejects.toThrow();
    const link = await ordinaryZip("a", new Uint8Array([1]), 0); const linkView = new DataView(link.buffer); linkView.setUint32(32 + 38, 0xa1ff0000, true);
    await expect(importProjectZip(link)).rejects.toThrow();
  });
  it("selects a containing directory explicitly", () => {
    const fs = new ProjectFiles(); fs.write("example/main.py", new Uint8Array([1]));
    expect(projectSubtree(fs.snapshot(), "example").entries).toEqual([{ path: "main.py", kind: "file", data: new Uint8Array([1]) }]);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
