import { DEFAULT_NETWORK_SETTINGS, validateSettings, type NetworkSettings } from "./contracts";
import type { ProjectSnapshot } from "../project/filesystem";

export const NETWORK_SETTINGS_PATH = ".weblab-network.json";
export function readNetworkSettings(project: ProjectSnapshot): NetworkSettings {
  const entry = project.entries.find(entry => entry.path === NETWORK_SETTINGS_PATH);
  if (!entry) return { ...DEFAULT_NETWORK_SETTINGS };
  if (entry.kind !== "file" || entry.data.length > 2048) throw new Error("Invalid network settings file");
  return validateSettings(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry.data)));
}
