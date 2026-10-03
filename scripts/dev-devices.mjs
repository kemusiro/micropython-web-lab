import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";

const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
const requestedPath = argumentsWithoutSeparator.shift();
if (requestedPath === undefined) {
  throw new Error("Usage: pnpm dev:devices -- <web-lab.local.json> [Vite options]");
}
assertLoopbackOptions(argumentsWithoutSeparator);

const configurationPath = await realpath(path.resolve(requestedPath));
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(packageManager, ["dev", ...argumentsWithoutSeparator], {
  env: {
    ...process.env,
    WEB_LAB_LOCAL_CONFIGURATION_PATH: configurationPath,
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
