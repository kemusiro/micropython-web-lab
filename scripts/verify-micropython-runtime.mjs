import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { loadMicroPython } from "../src/vendor/micropython-build/micropython.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const versions = parseKeyValueFile(
  await readFile(new URL("runtime/micropython/versions.env", repositoryRoot), "utf8"),
);
verifyVersionMetadata(versions);
await verifyFileHash(
  "runtime/micropython/LICENSE",
  versions.MICROPYTHON_LICENSE_SHA256,
);
await verifyArtifactHashes(
  await readFile(
    new URL("runtime/micropython/artifacts.sha256", repositoryRoot),
    "utf8",
  ),
);

const output = [];
const decoder = new TextDecoder();
const micropython = await loadMicroPython({
  linebuffer: false,
  stdout: (data) => output.push(decoder.decode(data, { stream: true })),
});

const sys = micropython.pyimport("sys");
const version = String(sys.version);
if (!version.includes(`MicroPython v${versions.MICROPYTHON_VERSION}`)) {
  throw new Error(`Unexpected MicroPython version: ${version}`);
}
if (typeof sys.settrace !== "function") {
  throw new Error("Restricted runtime must expose sys.settrace for debug execution.");
}

for (const moduleName of ["js", "jsffi", "socket", "network"]) {
  try {
    micropython.runPython(`import ${moduleName}`);
    throw new Error(`Restricted runtime unexpectedly imported ${moduleName}.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Restricted runtime")) {
      throw error;
    }
    if (error?.type !== "ImportError") {
      throw new Error(`Expected ImportError for ${moduleName}.`, { cause: error });
    }
  }
}

let ledValue = 0;
micropython.registerJsModule("machine", {
  Pin: () => ({
    on() {
      ledValue = 1;
    },
    value() {
      return ledValue;
    },
  }),
});
micropython.runPython(
  'from machine import Pin\nled = Pin("LED", 1)\nled.on()\nprint(led.value())',
);

if (ledValue !== 1 || !output.join("").includes("1\n")) {
  throw new Error("The allowlisted machine bridge did not work.");
}

console.log(`Restricted runtime verified: ${version}`);

function parseKeyValueFile(contents) {
  return Object.fromEntries(
    contents
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) {
          throw new Error(`Invalid runtime version line: ${line}`);
        }
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function verifyVersionMetadata(versions) {
  const requiredKeys = [
    "MICROPYTHON_VERSION",
    "MICROPYTHON_TAG",
    "MICROPYTHON_COMMIT",
    "MICROPYTHON_SOURCE_DATE_EPOCH",
    "MICROPYTHON_ARCHIVE_URL",
    "MICROPYTHON_ARCHIVE_SHA256",
    "MICROPYTHON_LICENSE_SHA256",
    "EMSCRIPTEN_VERSION",
    "WEB_LAB_BUILD_VARIANT",
  ];
  const actualKeys = Object.keys(versions).sort();
  if (actualKeys.join("\n") !== [...requiredKeys].sort().join("\n")) {
    throw new Error(`Unexpected runtime version keys: ${actualKeys.join(", ")}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(versions.MICROPYTHON_VERSION)) {
    throw new Error("Invalid MicroPython version.");
  }
  if (versions.MICROPYTHON_TAG !== `v${versions.MICROPYTHON_VERSION}`) {
    throw new Error("MicroPython tag and version do not match.");
  }
  if (!/^[0-9a-f]{40}$/.test(versions.MICROPYTHON_COMMIT)) {
    throw new Error("Invalid MicroPython commit.");
  }
  if (!/^\d+$/.test(versions.MICROPYTHON_SOURCE_DATE_EPOCH)) {
    throw new Error("Invalid MicroPython source date epoch.");
  }
  const expectedArchiveUrl =
    `https://github.com/micropython/micropython/archive/refs/tags/${versions.MICROPYTHON_TAG}.tar.gz`;
  if (versions.MICROPYTHON_ARCHIVE_URL !== expectedArchiveUrl) {
    throw new Error("MicroPython archive URL is not the pinned official tag archive.");
  }
  for (const key of ["MICROPYTHON_ARCHIVE_SHA256", "MICROPYTHON_LICENSE_SHA256"]) {
    if (!/^[0-9a-f]{64}$/.test(versions[key])) {
      throw new Error(`Invalid SHA-256 value: ${key}`);
    }
  }
  if (!/^\d+\.\d+\.\d+$/.test(versions.EMSCRIPTEN_VERSION)) {
    throw new Error("Invalid Emscripten version.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(versions.WEB_LAB_BUILD_VARIANT)) {
    throw new Error("Invalid Web Lab build variant.");
  }
}

async function verifyFileHash(relativePath, expectedHash) {
  const bytes = await readFile(new URL(relativePath, repositoryRoot));
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`File hash did not match: ${relativePath}`);
  }
}

async function verifyArtifactHashes(contents) {
  const entries = contents.trim().split("\n");
  if (entries.length !== 2) {
    throw new Error("Expected exactly two restricted runtime artifacts.");
  }

  const seenPaths = new Set();
  for (const entry of entries) {
    const match = /^([0-9a-f]{64})  (src\/vendor\/micropython-build\/(?:micropython\.mjs|micropython\.wasm))$/.exec(
      entry,
    );
    if (match === null) {
      throw new Error(`Invalid runtime artifact hash entry: ${entry}`);
    }

    const expectedHash = match[1];
    const relativePath = match[2];
    if (seenPaths.has(relativePath)) {
      throw new Error(`Runtime artifact hash path is duplicated: ${relativePath}`);
    }
    seenPaths.add(relativePath);
    await verifyFileHash(relativePath, expectedHash);
  }
  for (const requiredPath of [
    "src/vendor/micropython-build/micropython.mjs",
    "src/vendor/micropython-build/micropython.wasm",
  ]) {
    if (!seenPaths.has(requiredPath)) {
      throw new Error(`Runtime artifact hash is missing: ${requiredPath}`);
    }
  }
}
