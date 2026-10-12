import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const versions = Object.fromEntries((await readFile(new URL("runtime/ymfm/versions.env", root), "utf8")).trim().split("\n").map(line => line.split("=")));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const path of ["runtime/ymfm/LICENSE", "public/ymfm-LICENSE.txt", "src/vendor/ymfm-build/LICENSE.txt"]) {
  if (sha(await readFile(new URL(path, root))) !== versions.YMFM_LICENSE_SHA256) throw new Error(`ymfm license mismatch: ${path}`);
}
const [expected, path] = (await readFile(new URL("runtime/ymfm/artifacts.sha256", root), "utf8")).trim().split(/\s+/);
if (path !== "src/vendor/ymfm-build/ym2203.wasm") throw new Error("Unexpected ymfm artifact path");
const binary = await readFile(new URL(path, root));
if (sha(binary) !== expected) throw new Error("ymfm WASM checksum mismatch; regenerate with the pinned build script");
const module = await WebAssembly.compile(binary);
if (WebAssembly.Module.imports(module).length) throw new Error("ymfm WASM unexpectedly imports host capabilities");
const notices = await readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8");
if (!notices.includes(versions.YMFM_COMMIT) || !notices.includes("BSD-3-Clause")) throw new Error("ymfm notice missing");
console.log(`Pinned ymfm verified: ${versions.YMFM_COMMIT}; ${binary.byteLength} bytes; no host imports`);
