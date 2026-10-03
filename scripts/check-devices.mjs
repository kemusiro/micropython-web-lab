import { loadLocalDeviceWorkspace } from "./lib/local-device-workspace.mjs";

const requestedPath = process.argv.slice(2).find((argument) => argument !== "--");
if (requestedPath === undefined) {
  throw new Error("Usage: pnpm check:devices -- <web-lab.local.json>");
}

const workspace = await loadLocalDeviceWorkspace(requestedPath);
console.log(
  `Local device configuration verified: ${workspace.sources.length} source(s); ${workspace.instances.length} instance(s); ${workspace.basePreset}`,
);
