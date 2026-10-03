import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseDeviceManifest } from "../packages/device-api/dist/index.js";
import { runPico2WConformance } from "../packages/device-testkit/dist/index.js";

const requestedPath = process.argv.slice(2).find((argument) => argument !== "--");
if (!requestedPath) {
  throw new Error("Usage: pnpm check:device -- <device-directory>");
}

const deviceDirectory = await realpath(path.resolve(requestedPath));
if (!(await stat(deviceDirectory)).isDirectory()) {
  throw new Error(`Device path is not a directory: ${deviceDirectory}`);
}

const manifestPath = path.join(deviceDirectory, "device.json");
const manifest = parseDeviceManifest(await readFile(manifestPath, "utf8"));
const packageJson = await readOptionalJson(path.join(deviceDirectory, "package.json"));
if (packageJson?.dependencies && Object.keys(packageJson.dependencies).length > 0) {
  throw new Error("Device API v1 normal review does not allow runtime dependencies.");
}

await scanForbiddenSource(path.join(deviceDirectory, "src"));

const entrypoint = await realpath(path.resolve(deviceDirectory, manifest.entrypoint));
assertInsideDirectory(deviceDirectory, entrypoint, "Device entrypoint");
await scanForbiddenSource(path.dirname(entrypoint));
const loaded = await import(`${pathToFileURL(entrypoint).href}?check=${Date.now()}`);
const definition = loaded.default;
if (typeof definition !== "object" || definition === null) {
  throw new Error("Device entrypoint must default-export a DeviceDefinition object.");
}
const definitionManifest = parseDeviceManifest(JSON.stringify(definition.manifest));
if (JSON.stringify(definitionManifest) !== JSON.stringify(manifest)) {
  throw new Error("device.json and the entrypoint DeviceDefinition manifest do not match.");
}

const report = runPico2WConformance(definition);
if (!report.ok) {
  const details = report.issues.map((issue) => `- ${issue.code}: ${issue.message}`).join("\n");
  throw new Error(`Device model failed Pico 2 W conformance:\n${details}`);
}

const exampleDirectory = path.join(deviceDirectory, "examples");
const exampleNames = (await readdir(exampleDirectory)).filter((name) => name.endsWith(".py"));
if (exampleNames.length === 0) {
  throw new Error("Device package must contain at least one examples/*.py file.");
}
for (const name of exampleNames) {
  const source = await readFile(path.join(exampleDirectory, name), "utf8");
  if (source.length === 0 || source.length > 200_000) {
    throw new Error(`Python example ${name} must contain from 1 to 200000 characters.`);
  }
  if (!/(?:from\s+machine\s+import|import\s+machine)/.test(source)) {
    throw new Error(`Python example ${name} must use the MicroPython machine module.`);
  }
}

console.log(
  `Device verified: ${manifest.id} ${manifest.version}; ${manifest.ports.length} port(s); ${exampleNames.length} Python example(s)`,
);

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function assertInsideDirectory(directory, target, label) {
  const relative = path.relative(directory, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain inside the device directory.`);
  }
}

async function scanForbiddenSource(directory) {
  const forbiddenGlobal = /\b(?:window|document|fetch|XMLHttpRequest|WebSocket|localStorage|indexedDB|SharedArrayBuffer|Atomics|eval|Function|globalThis|navigator|importScripts|process|require|Deno|Bun)\b/;
  const forbiddenModule = /(?:from\s*|import\s*\()\s*["'](?:node:|fs|path|url|http|https|net|tls|child_process|worker_threads)/;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scanForbiddenSource(entryPath);
    } else if (/\.(?:ts|js|mts|mjs)$/.test(entry.name)) {
      const source = await readFile(entryPath, "utf8");
      const match = source.match(forbiddenGlobal) ?? source.match(forbiddenModule);
      if (match) {
        throw new Error(`Forbidden Device API capability ${match[0]} found in ${entryPath}.`);
      }
    }
  }
}
