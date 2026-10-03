import { spawn, spawnSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { parseDeviceManifest } from "../packages/device-api/dist/index.js";

const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
const requestedPath = argumentsWithoutSeparator.shift();
if (requestedPath === undefined) {
  throw new Error("Usage: pnpm dev:device -- <device-directory> [Vite options]");
}
assertLoopbackOptions(argumentsWithoutSeparator);

const deviceDirectory = await realpath(path.resolve(requestedPath));
if (!(await stat(deviceDirectory)).isDirectory()) {
  throw new Error(`Device path is not a directory: ${deviceDirectory}`);
}
const manifest = parseDeviceManifest(
  await readFile(path.join(deviceDirectory, "device.json"), "utf8"),
);
const entrypoint = await realpath(path.resolve(deviceDirectory, manifest.entrypoint));
assertInsideDirectory(deviceDirectory, entrypoint);

const checkResult = spawnSync(
  process.execPath,
  [path.join(import.meta.dirname, "check-device.mjs"), deviceDirectory],
  { stdio: "inherit" },
);
if (checkResult.error !== undefined) {
  throw checkResult.error;
}
if (checkResult.status !== 0) {
  process.exitCode = checkResult.status ?? 1;
} else {
  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(packageManager, ["dev", ...argumentsWithoutSeparator], {
    env: {
      ...process.env,
      WEB_LAB_LOCAL_DEVICE_DIRECTORY: deviceDirectory,
      WEB_LAB_LOCAL_DEVICE_ENTRYPOINT: entrypoint,
      WEB_LAB_LOCAL_DEVICE_ID: manifest.id,
      WEB_LAB_LOCAL_DEVICE_NAME: manifest.name,
      WEB_LAB_LOCAL_DEVICE_DESCRIPTOR: JSON.stringify({
        directory: deviceDirectory,
        entrypoint,
        manifest,
      }),
    },
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

function assertLoopbackOptions(options) {
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const inline = option?.startsWith("--host=") ? option.slice("--host=".length) : null;
    const host = option === "--host" ? options[index + 1] : inline;
    if (host !== null && host !== undefined && !isLoopback(host)) {
      throw new Error("Local Device development server must use a loopback host.");
    }
  }
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function assertInsideDirectory(directory, target) {
  const relative = path.relative(directory, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Device entrypoint must remain inside the device directory.");
  }
}
