export const PROJECT_ROOT = "/project";
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
export const MAX_PROJECT_ENTRIES = 1024;
export const MAX_PROJECT_PATH_BYTES = 240;
export type ProjectEntry = { path: string; kind: "directory" } | { path: string; kind: "file"; data: Uint8Array };
export interface ProjectSnapshot { version: 1; entries: ProjectEntry[] }

export function projectPath(path: string): string {
  if (!path || path.startsWith("/") || path.includes("\\") || /[\x00-\x1f\x7f:]/.test(path) ||
      new TextEncoder().encode(path).length > MAX_PROJECT_PATH_BYTES ||
      path.split("/").some(part => !part || part === "." || part === ".." || part === "__proto__")) {
    throw new Error("Invalid project path / 不正なファイルパスです");
  }
  return path;
}

export function validateProjectSnapshot(value: unknown): asserts value is ProjectSnapshot {
  if (typeof value !== "object" || value === null) throw new Error("Invalid filesystem");
  const candidate = value as ProjectSnapshot;
  if (candidate.version !== 1 || !Array.isArray(candidate.entries) || candidate.entries.length > MAX_PROJECT_ENTRIES) throw new Error("Invalid filesystem version or entry count");
  const paths = new Map<string, ProjectEntry>();
  let bytes = 0;
  for (const entry of candidate.entries) {
    if (!entry || typeof entry.path !== "string" || (entry.kind !== "file" && entry.kind !== "directory")) throw new Error("Invalid filesystem entry");
    projectPath(entry.path);
    if (paths.has(entry.path)) throw new Error("Duplicate project path");
    paths.set(entry.path, entry);
    if (entry.kind === "file") {
      if (!(entry.data instanceof Uint8Array)) throw new Error("Invalid file data");
      bytes += entry.data.byteLength;
      if (bytes > MAX_PROJECT_BYTES) throw new Error("Project exceeds 4 MiB / 容量上限4 MiBを超えています");
    }
  }
  for (const path of paths.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (paths.get(parts.slice(0, i).join("/"))?.kind !== "directory") throw new Error("Missing parent directory or file/directory conflict");
    }
  }
}

export class ProjectFiles {
  #entries = new Map<string, ProjectEntry>();
  constructor(snapshot: ProjectSnapshot = { version: 1, entries: [] }) { this.replace(snapshot); }
  get usedBytes(): number { return [...this.#entries.values()].reduce((sum, entry) => sum + (entry.kind === "file" ? entry.data.length : 0), 0); }
  snapshot(): ProjectSnapshot {
    return { version: 1, entries: [...this.#entries.values()].sort((a, b) => a.path.localeCompare(b.path)).map(entry => entry.kind === "file" ? { ...entry, data: entry.data.slice() } : { ...entry }) };
  }
  replace(snapshot: ProjectSnapshot): void {
    validateProjectSnapshot(snapshot);
    this.#entries = new Map(snapshot.entries.map(entry => [entry.path, entry.kind === "file" ? { ...entry, data: entry.data.slice() } : { ...entry }]));
  }
  get(path: string): ProjectEntry | undefined { return this.#entries.get(path); }
  write(path: string, data: Uint8Array): void {
    projectPath(path);
    if (this.get(path)?.kind === "directory") throw new Error("Path is a directory");
    const next = new Map(this.#entries);
    this.#parents(next, path);
    next.set(path, { path, kind: "file", data });
    this.replace({ version: 1, entries: [...next.values()] });
  }
  mkdir(path: string): void {
    projectPath(path);
    if (this.get(path)) throw new Error("Path already exists");
    const next = new Map(this.#entries);
    this.#parents(next, path);
    next.set(path, { path, kind: "directory" });
    this.replace({ version: 1, entries: [...next.values()] });
  }
  remove(path: string): void {
    if (!this.get(path)) throw new Error("Path does not exist");
    if ([...this.#entries.keys()].some(key => key.startsWith(path + "/"))) throw new Error("Directory is not empty");
    const next = this.snapshot();
    next.entries = next.entries.filter(entry => entry.path !== path);
    this.replace(next);
  }
  rename(path: string, target: string): void {
    projectPath(target);
    if (!this.get(path) || this.get(target) || target.startsWith(path + "/")) throw new Error("Invalid rename destination");
    const next = new Map<string, ProjectEntry>();
    for (const entry of this.#entries.values()) {
      const name = entry.path === path || entry.path.startsWith(path + "/") ? target + entry.path.slice(path.length) : entry.path;
      next.set(name, { ...entry, path: name });
    }
    this.#parents(next, target);
    this.replace({ version: 1, entries: [...next.values()] });
  }
  #parents(entries: Map<string, ProjectEntry>, path: string): void {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (entries.get(parent)?.kind === "file") throw new Error("Parent is a file");
      entries.set(parent, { path: parent, kind: "directory" });
    }
  }
}
