import { MAX_PROJECT_BYTES, MAX_PROJECT_ENTRIES, ProjectFiles, projectPath, type ProjectSnapshot } from "./filesystem";

export const MAX_ZIP_BYTES = 8 * 1024 * 1024;
export const MAX_ZIP_PROCESSING_MS = 15_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]!;
  return (value ^ 0xffffffff) >>> 0;
}

/** Portable ordinary ZIP; no manifest, OS permissions or runtime state is required. */
export function exportProjectZip(snapshot: ProjectSnapshot): Uint8Array {
  const entries = new ProjectFiles(snapshot).snapshot().entries;
  const files = entries.map(entry => {
    const name = encoder.encode(entry.path + (entry.kind === "directory" ? "/" : ""));
    const data = entry.kind === "file" ? entry.data : new Uint8Array();
    return { name, data, crc: crc32(data), offset: 0 };
  });
  const size = files.reduce((sum, file) => sum + 30 + file.name.length + file.data.length + 46 + file.name.length, 22);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let position = 0;
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  for (const file of files) {
    file.offset = position;
    u32(position, 0x04034b50); u16(position + 4, 20); u16(position + 6, 0x800);
    u16(position + 12, 0x21); // 1980-01-01, fixed reproducible timestamp.
    u32(position + 14, file.crc); u32(position + 18, file.data.length); u32(position + 22, file.data.length);
    u16(position + 26, file.name.length);
    bytes.set(file.name, position + 30); bytes.set(file.data, position + 30 + file.name.length);
    position += 30 + file.name.length + file.data.length;
  }
  const centralStart = position;
  for (const file of files) {
    u32(position, 0x02014b50); u16(position + 4, 20); u16(position + 6, 20); u16(position + 8, 0x800);
    u16(position + 14, 0x21);
    u32(position + 16, file.crc); u32(position + 20, file.data.length); u32(position + 24, file.data.length);
    u16(position + 28, file.name.length); u32(position + 42, file.offset);
    bytes.set(file.name, position + 46);
    position += 46 + file.name.length;
  }
  u32(position, 0x06054b50); u16(position + 8, files.length); u16(position + 10, files.length);
  u32(position + 12, position - centralStart); u32(position + 16, centralStart);
  return bytes;
}

export async function importProjectZip(bytes: Uint8Array): Promise<ProjectSnapshot> {
  if (bytes.length < 22 || bytes.length > MAX_ZIP_BYTES) throw new Error("ZIP size must be at most 8 MiB / ZIPは8 MiB以内にしてください");
  const started = Date.now();
  const checkTime = () => { if (Date.now() - started > MAX_ZIP_PROCESSING_MS) throw new Error("ZIP processing timed out"); };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw new Error("Invalid or split ZIP");
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
  if (count > MAX_PROJECT_ENTRIES || centralStart + centralSize !== end) throw new Error("ZIP64 or excessive ZIP entries are not supported");
  const project = new ProjectFiles();
  const names = new Set<string>();
  const intervals: [number, number][] = [];
  let total = 0, position = centralStart;
  for (let index = 0; index < count; index++) {
    checkTime();
    if (position + 46 > end || u32(position) !== 0x02014b50) throw new Error("Invalid ZIP directory");
    const flags = u16(position + 8), method = u16(position + 10), crc = u32(position + 16);
    const compressed = u32(position + 20), expanded = u32(position + 24);
    const nameLength = u16(position + 28), extraLength = u16(position + 30), commentLength = u16(position + 32);
    const offset = u32(position + 42), attributes = u32(position + 38), unixType = attributes >>> 16 & 0xf000;
    if (u16(position + 34) || flags & ~(0x800 | 8 | 6) || (method !== 0 && method !== 8) ||
        unixType && unixType !== 0x8000 && unixType !== 0x4000) throw new Error("Encrypted, linked or unsupported ZIP entry");
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new Error("Truncated ZIP directory");
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength);
    // UTF-8 flag or ASCII is unambiguous; never guess a legacy locale encoding.
    if (!(flags & 0x800) && nameBytes.some(byte => byte >= 128)) throw new Error("Use UTF-8 ZIP filenames / ZIPのファイル名はUTF-8にしてください");
    const name = decoder.decode(nameBytes), directory = name.endsWith("/");
    const path = projectPath(directory ? name.slice(0, -1) : name);
    if (names.has(path)) throw new Error("Duplicate ZIP path");
    names.add(path);
    if (directory && expanded !== 0) throw new Error("Directory contains file data");
    total += expanded;
    if (total > MAX_PROJECT_BYTES) throw new Error("ZIP expands beyond 4 MiB / 展開後の容量が4 MiBを超えています");
    if (offset + 30 > centralStart || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) throw new Error("Invalid ZIP local header");
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtraLength;
    if (localNameLength !== nameLength || dataStart + compressed > centralStart ||
        nameBytes.some((byte, i) => byte !== bytes[offset + 30 + i])) throw new Error("Conflicting ZIP headers");
    if (!(flags & 8) && (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== expanded)) throw new Error("Conflicting ZIP sizes or CRC");
    if (intervals.some(([start, finish]) => offset < finish && dataStart + compressed > start)) throw new Error("Overlapping ZIP entries");
    intervals.push([offset, dataStart + compressed]);
    const input = bytes.subarray(dataStart, dataStart + compressed);
    let data: Uint8Array;
    if (method === 0) data = input.slice();
    else {
      // Feed small compressed chunks so native decompression cannot enqueue a
      // huge expanded Blob chunk before our output quota check runs.
      let inputOffset = 0;
      const compressedStream = new ReadableStream<BufferSource>({
        pull(controller) {
          if (inputOffset === input.length) { controller.close(); return; }
          const end = Math.min(inputOffset + 1024, input.length);
          controller.enqueue(input.slice(inputOffset, end));
          inputOffset = end;
        },
      });
      const stream = compressedStream.pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          checkTime();
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > expanded || total - expanded + size > MAX_PROJECT_BYTES) throw new Error("ZIP expansion exceeds size limit");
          chunks.push(chunk.value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      data = new Uint8Array(size);
      let cursor = 0;
      for (const chunk of chunks) { data.set(chunk, cursor); cursor += chunk.length; }
    }
    if (data.length !== expanded || crc32(data) !== crc) throw new Error("ZIP data or CRC is corrupt");
    if (directory) { if (!project.get(path)) project.mkdir(path); else if (project.get(path)?.kind !== "directory") throw new Error("File/directory collision"); }
    else project.write(path, data);
    position = next;
  }
  if (position !== end) throw new Error("Unexpected ZIP directory records");
  return project.snapshot();
}

export function projectSubtree(snapshot: ProjectSnapshot, directory: string): ProjectSnapshot {
  if (!directory) return new ProjectFiles(snapshot).snapshot();
  projectPath(directory);
  const prefix = directory + "/";
  return new ProjectFiles({ version: 1, entries: snapshot.entries.filter(entry => entry.path.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path.slice(prefix.length) })) }).snapshot();
}
