import { MAX_PROJECT_BYTES, MAX_PROJECT_ENTRIES, PROJECT_ROOT, projectPath, validateProjectSnapshot, type ProjectSnapshot, type ProjectEntry } from "../project/filesystem";

// Emscripten's pinned FS API is not typed upstream. Keep this dynamic boundary here.
type NativeFunction = (...args: any[]) => any;
interface FsNode {
  parent: FsNode; name: string; mode: number; usedBytes: number;
  contents: Record<string, FsNode> | Uint8Array;
  node_ops: Record<string, NativeFunction>; stream_ops: Record<string, NativeFunction>;
}
interface FsStream { node: FsNode; position: number; flags: number }
export interface EmscriptenFs {
  filesystems: { MEMFS: { createNode: NativeFunction } };
  ErrnoError: new (errno: number) => Error;
  getPath(node: FsNode): string;
  lookupPath(path: string): { node: FsNode };
  isFile(mode: number): boolean; isDir(mode: number): boolean;
  mkdir(path: string): void; writeFile(path: string, bytes: Uint8Array): void;
  unlink(path: string): void; rmdir(path: string): void;
  readFile(path: string): Uint8Array; chdir(path: string): void;
}

/** Guards MEMFS before allocations; never expose the FS object to Python. */
export class RuntimeProjectFilesystem {
  #fs: EmscriptenFs;
  #nodes = new Set<FsNode>();
  #references = new Map<FsNode, number>();
  #detached = new Set<FsNode>();
  #bytes = 0;
  #loading = false;
  #dirty = false;
  #checkpointNeeded = false;
  #revision = 0;
  #lastSentAt = 0;
  #sentWithoutGate = false;
  #gate: Int32Array | null;
  #publish: (snapshot: ProjectSnapshot, revision: number, checkpoint: boolean) => void;
  constructor(fs: EmscriptenFs, snapshot: ProjectSnapshot, gate: SharedArrayBuffer | undefined,
    publish: (snapshot: ProjectSnapshot, revision: number, checkpoint: boolean) => void) {
    this.#fs = fs;
    this.#gate = gate ? new Int32Array(gate) : null;
    this.#publish = publish;
    fs.mkdir(PROJECT_ROOT);
    const nativeCreate = fs.filesystems.MEMFS.createNode;
    fs.filesystems.MEMFS.createNode = (parent: FsNode | null, name: string, mode: number, dev: number) => {
      if (parent) this.#checkPath(fs.getPath(parent) + "/" + name);
      if (!fs.isFile(mode) && !fs.isDir(mode)) throw new fs.ErrnoError(63);
      if (this.#nodes.size >= MAX_PROJECT_ENTRIES) throw new fs.ErrnoError(51);
      const node = nativeCreate(parent, name, mode, dev) as FsNode;
      this.#nodes.add(node);
      this.#guard(node);
      this.#changed();
      return node;
    };
    const visit = (node: FsNode): void => {
      this.#guard(node);
      if (fs.isDir(node.mode)) for (const child of Object.values(node.contents)) visit(child as FsNode);
    };
    visit(fs.lookupPath("/").node);
    this.synchronize(snapshot);
    fs.chdir(PROJECT_ROOT);
    this.#dirty = false;
  }
  #checkPath(path: string): void {
    if (!path.startsWith(PROJECT_ROOT + "/")) throw new this.#fs.ErrnoError(69);
    try { projectPath(path.slice(PROJECT_ROOT.length + 1)); } catch { throw new this.#fs.ErrnoError(28); }
  }
  #guard(node: FsNode): void {
    const fs = this.#fs;
    const ops = { ...node.node_ops };
    node.node_ops = ops;
    const stream = { ...node.stream_ops };
    node.stream_ops = stream;
    const setattr = ops.setattr;
    if (setattr) ops.setattr = (target: FsNode, attr: { size?: number }) => {
      if (attr.size !== undefined) {
        this.#checkPath(fs.getPath(target));
        this.#checkSize(target, attr.size);
        const oldSize = target.usedBytes;
        setattr(target, attr);
        this.#bytes += target.usedBytes - oldSize;
        this.#changed();
      } else setattr(target, attr);
    };
    if (fs.isDir(node.mode)) {
      const unlink = ops.unlink!;
      const rmdir = ops.rmdir!;
      for (const [name, original] of [["unlink", unlink], ["rmdir", rmdir]] as const) {
        ops[name] = (parent: FsNode, childName: string) => {
          const path = fs.getPath(parent) + "/" + childName;
          this.#checkPath(path);
          const child = (parent.contents as Record<string, FsNode>)[childName];
          original(parent, childName);
          if (child) this.#detach(child);
          this.#changed();
        };
      }
      const rename = ops.rename!;
      ops.rename = (old: FsNode, parent: FsNode, name: string) => {
        this.#checkPath(fs.getPath(old));
        const destination = fs.getPath(parent) + "/" + name;
        this.#checkPath(destination);
        // Renaming a directory must also validate every descendant's new path.
        const check = (child: FsNode, path: string): void => {
          this.#checkPath(path);
          if (fs.isDir(child.mode)) for (const nested of Object.values(child.contents)) check(nested as FsNode, path + "/" + (nested as FsNode).name);
        };
        check(old, destination);
        const replaced = (parent.contents as Record<string, FsNode>)[name];
        rename(old, parent, name);
        if (replaced && replaced !== old) this.#detach(replaced);
        this.#changed();
      };
      ops.symlink = () => { throw new fs.ErrnoError(63); };
    } else if (fs.isFile(node.mode)) {
      const write = stream.write!;
      stream.write = (handle: FsStream, buffer: Uint8Array, offset: number, length: number, position: number, own: boolean) => {
        this.#checkPath(fs.getPath(handle.node));
        this.#checkSize(handle.node, Math.max(handle.node.usedBytes, position + length));
        const oldSize = handle.node.usedBytes;
        const result = write(handle, buffer, offset, length, position, own);
        this.#bytes += handle.node.usedBytes - oldSize;
        this.#changed();
        return result;
      };
      stream.open = (handle: FsStream) => this.#references.set(handle.node, (this.#references.get(handle.node) ?? 0) + 1);
      stream.close = (handle: FsStream) => {
        const refs = (this.#references.get(handle.node) ?? 1) - 1;
        this.#references.set(handle.node, refs);
        if (!refs && this.#detached.has(handle.node)) this.#release(handle.node);
        this.flush();
      };
      // Python does not need memory mapping; prohibit paths that bypass write accounting.
      stream.mmap = stream.msync = () => { throw new fs.ErrnoError(63); };
    }
  }
  #checkSize(node: FsNode, size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || this.#bytes - node.usedBytes + size > MAX_PROJECT_BYTES) throw new this.#fs.ErrnoError(51);
  }
  #detach(node: FsNode): void {
    this.#detached.add(node);
    if (!(this.#references.get(node) ?? 0)) this.#release(node);
  }
  #release(node: FsNode): void {
    this.#bytes -= this.#fs.isFile(node.mode) ? node.usedBytes : 0;
    this.#nodes.delete(node);
    this.#references.delete(node);
    this.#detached.delete(node);
  }
  #changed(): void { if (!this.#loading) { this.#dirty = true; this.#checkpointNeeded = true; this.#revision++; this.flush(); } }
  snapshot(): ProjectSnapshot {
    const entries: ProjectEntry[] = [];
    const walk = (node: FsNode, prefix: string): void => {
      for (const child of Object.values(node.contents) as FsNode[]) {
        const path = prefix + child.name;
        if (this.#fs.isDir(child.mode)) { entries.push({ kind: "directory", path }); walk(child, path + "/"); }
        else entries.push({ kind: "file", path, data: Uint8Array.from((child.contents as Uint8Array).subarray(0, child.usedBytes)) });
      }
    };
    walk(this.#fs.lookupPath(PROJECT_ROOT).node, "");
    return { version: 1, entries };
  }
  beginOperation(): void { this.#sentWithoutGate = false; }
  flush(checkpoint = false): void {
    if (checkpoint ? !this.#checkpointNeeded : !this.#dirty) return;
    if (!checkpoint) {
      if (Date.now() - this.#lastSentAt < 100) return;
      if (this.#gate ? Atomics.compareExchange(this.#gate, 0, 0, 1) !== 0 : this.#sentWithoutGate) return;
    }
    if (checkpoint && !this.#dirty) this.#revision++;
    this.#publish(this.snapshot(), this.#revision, checkpoint);
    if (checkpoint) this.#checkpointNeeded = false;
    this.#dirty = false;
    this.#lastSentAt = Date.now();
    this.#sentWithoutGate = true;
  }
  synchronize(snapshot: ProjectSnapshot): void {
    validateProjectSnapshot(snapshot);
    this.#loading = true;
    try {
      const old = this.snapshot();
      const desired = new Map(snapshot.entries.map(entry => [entry.path, entry]));
      const retained = new Set(this.#detached);
      for (const node of this.#nodes) {
        const path = this.#fs.getPath(node).slice(PROJECT_ROOT.length + 1);
        if (this.#references.get(node) && desired.get(path)?.kind !== "file") retained.add(node);
      }
      const retainedBytes = [...retained].reduce((sum, node) => sum + node.usedBytes, 0);
      const targetBytes = snapshot.entries.reduce((sum, entry) => sum + (entry.kind === "file" ? entry.data.length : 0), 0);
      if (targetBytes + retainedBytes > MAX_PROJECT_BYTES || snapshot.entries.length + retained.size > MAX_PROJECT_ENTRIES) throw new this.#fs.ErrnoError(51);
      for (const entry of old.entries.sort((a, b) => b.path.length - a.path.length)) {
        if (desired.get(entry.path)?.kind !== entry.kind) {
          if (entry.kind === "file") this.#fs.unlink(PROJECT_ROOT + "/" + entry.path);
          else this.#fs.rmdir(PROJECT_ROOT + "/" + entry.path);
        }
      }
      const previous = new Map(old.entries.map(entry => [entry.path, entry]));
      // Free changed file storage before growing other files; a valid final image
      // must not fail just because its entries arrive in an unfortunate order.
      for (const entry of snapshot.entries) {
        const before = previous.get(entry.path);
        if (entry.kind === "file" && before?.kind === "file" &&
            (before.data.length !== entry.data.length || before.data.some((byte, i) => byte !== entry.data[i]))) this.#fs.writeFile(PROJECT_ROOT + "/" + entry.path, new Uint8Array());
      }
      for (const entry of [...snapshot.entries].sort((a, b) => a.path.length - b.path.length)) {
        const path = PROJECT_ROOT + "/" + entry.path;
        const before = previous.get(entry.path);
        if (entry.kind === "directory") { if (before?.kind !== "directory") this.#fs.mkdir(path); }
        else if (before?.kind !== "file" || before.data.length !== entry.data.length || before.data.some((byte, i) => byte !== entry.data[i])) this.#fs.writeFile(path, entry.data);
      }
    } finally { this.#loading = false; }
  }
}
