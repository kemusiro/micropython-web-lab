import path from "node:path";

import { defineConfig, type Plugin } from "vite";

import {
  DEVELOPMENT_SECURITY_HEADERS,
  SECURITY_HEADERS,
} from "./config/security-headers.mjs";
import {
  loadLegacyLocalDeviceWorkspace,
  loadLocalDeviceWorkspace,
} from "./scripts/lib/local-device-workspace.mjs";

const LOCAL_DEVICE_MODULE_ID = "virtual:local-device";
const RESOLVED_LOCAL_DEVICE_MODULE_ID = `\0${LOCAL_DEVICE_MODULE_ID}`;
const LOCAL_DEVICE_METADATA_MODULE_ID = "virtual:local-device-metadata";
const RESOLVED_LOCAL_DEVICE_METADATA_MODULE_ID = `\0${LOCAL_DEVICE_METADATA_MODULE_ID}`;
const OPTIONAL_CONTENT_MODULE_ID = "virtual:optional-content-integration";
const RESOLVED_OPTIONAL_CONTENT_MODULE_ID = `\0${OPTIONAL_CONTENT_MODULE_ID}`;

export default defineConfig(async ({ command }) => {
  const localWorkspace = command === "serve" ? await readLocalDeviceEnvironment() : null;
  const optionalContentEntrypoint = process.env.WEB_LAB_OPTIONAL_CONTENT_ENTRYPOINT;
  const localNames = localWorkspace?.instances.map((instance) => instance.name) ?? [];
  const localIds = localWorkspace?.instances.map((instance) => instance.deviceId) ?? [];
  return {
    define: {
      __WEB_LAB_LOCAL_MODE__: JSON.stringify(localWorkspace !== null),
      __WEB_LAB_LOCAL_DEVICE_ID__: JSON.stringify(localIds.join(", ")),
      __WEB_LAB_LOCAL_DEVICE_NAME__: JSON.stringify(localNames.join(", ")),
    },
    plugins: [
      localDevicePlugin(localWorkspace),
      optionalContentPlugin(optionalContentEntrypoint),
    ],
    worker: {
      format: "es",
      plugins: () => [localDevicePlugin(localWorkspace)],
    },
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      headers: DEVELOPMENT_SECURITY_HEADERS,
      fs: {
        allow: [process.cwd(), ...(localWorkspace?.directories ?? [])],
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      headers: SECURITY_HEADERS,
    },
  };
});

function optionalContentPlugin(entrypoint: string | undefined): Plugin {
  return {
    name: "micropython-web-lab-optional-content",
    resolveId(id): string | undefined {
      return id === OPTIONAL_CONTENT_MODULE_ID
        ? RESOLVED_OPTIONAL_CONTENT_MODULE_ID
        : undefined;
    },
    load(id): string | undefined {
      if (id !== RESOLVED_OPTIONAL_CONTENT_MODULE_ID) {
        return undefined;
      }
      return entrypoint === undefined
        ? 'export { createNoopOptionalContentIntegration as createOptionalContentIntegration } from "/src/integration/optional-content.ts";'
        : `export { createOptionalContentIntegration } from ${JSON.stringify(path.resolve(entrypoint))};`;
    },
  };
}

interface LocalWorkspaceSource {
  readonly sourceId: string;
  readonly directory: string;
  readonly entrypoint: string;
}

interface LocalWorkspaceInstance {
  readonly instanceId: string;
  readonly sourceId: string;
  readonly deviceId: string;
  readonly deviceVersion: string;
  readonly name: string;
}

interface LocalWorkspace {
  readonly basePreset: string;
  readonly localGraph: unknown;
  readonly effectiveGraph: unknown;
  readonly sources: readonly LocalWorkspaceSource[];
  readonly instances: readonly LocalWorkspaceInstance[];
  readonly directories: readonly string[];
}

async function readLocalDeviceEnvironment(): Promise<LocalWorkspace | null> {
  const configurationPath = process.env.WEB_LAB_LOCAL_CONFIGURATION_PATH;
  const legacyDescriptor = process.env.WEB_LAB_LOCAL_DEVICE_DESCRIPTOR;
  if (configurationPath !== undefined && legacyDescriptor !== undefined) {
    throw new Error("Local Device configuration and legacy device mode cannot be enabled together.");
  }
  if (configurationPath !== undefined) {
    return (await loadLocalDeviceWorkspace(configurationPath)) as LocalWorkspace;
  }
  if (legacyDescriptor !== undefined) {
    let descriptor: unknown;
    try {
      descriptor = JSON.parse(legacyDescriptor);
    } catch {
      throw new Error("Local Device descriptor must contain valid JSON.");
    }
    if (!isLegacyDescriptor(descriptor)) {
      throw new Error("Local Device descriptor is invalid. Use pnpm dev:device.");
    }
    return (await loadLegacyLocalDeviceWorkspace(descriptor)) as LocalWorkspace;
  }
  if (process.env.WEB_LAB_LOCAL_DEVICE_ENTRYPOINT !== undefined) {
    throw new Error("Legacy Local Device environment is incomplete. Use pnpm dev:device.");
  }
  return null;
}

function isLegacyDescriptor(
  value: unknown,
): value is { directory: string; entrypoint: string; manifest: Record<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).directory === "string" &&
    typeof (value as Record<string, unknown>).entrypoint === "string" &&
    typeof (value as Record<string, unknown>).manifest === "object" &&
    (value as Record<string, unknown>).manifest !== null
  );
}

function localDevicePlugin(localWorkspace: LocalWorkspace | null): Plugin {
  return {
    name: "micropython-web-lab-local-device",
    resolveId(id): string | undefined {
      if (id === LOCAL_DEVICE_MODULE_ID) {
        return RESOLVED_LOCAL_DEVICE_MODULE_ID;
      }
      if (id === LOCAL_DEVICE_METADATA_MODULE_ID) {
        return RESOLVED_LOCAL_DEVICE_METADATA_MODULE_ID;
      }
      return undefined;
    },
    load(id): string | undefined {
      if (id === RESOLVED_LOCAL_DEVICE_MODULE_ID) {
        return createWorkerModule(localWorkspace);
      }
      if (id === RESOLVED_LOCAL_DEVICE_METADATA_MODULE_ID) {
        return createMetadataModule(localWorkspace);
      }
      return undefined;
    },
  };
}

function createWorkerModule(localWorkspace: LocalWorkspace | null): string {
  if (localWorkspace === null) {
    return "export const localDeviceBundle = null;";
  }
  const sourceVariables = new Map<string, string>();
  const imports = localWorkspace.sources.map((source, index) => {
    const variable = `localDeviceSource${index}`;
    sourceVariables.set(source.sourceId, variable);
    return `import ${variable} from ${JSON.stringify(path.resolve(source.entrypoint))};`;
  });
  const instances = localWorkspace.instances.map((instance) => {
    const definition = sourceVariables.get(instance.sourceId);
    if (definition === undefined) {
      throw new Error(`Local Device source ${instance.sourceId} was not loaded.`);
    }
    return `{ instanceId: ${JSON.stringify(instance.instanceId)}, definition: ${definition} }`;
  });
  return [
    ...imports,
    "export const localDeviceBundle = Object.freeze({",
    `  basePreset: ${JSON.stringify(localWorkspace.basePreset)},`,
    `  connectionGraph: ${JSON.stringify(localWorkspace.localGraph)},`,
    `  devices: Object.freeze([${instances.join(",")}]),`,
    "});",
  ].join("\n");
}

function createMetadataModule(localWorkspace: LocalWorkspace | null): string {
  if (localWorkspace === null) {
    return "export const localDeviceMetadata = null;";
  }
  return `export const localDeviceMetadata = Object.freeze(${JSON.stringify({
    basePreset: localWorkspace.basePreset,
    connectionGraph: localWorkspace.effectiveGraph,
    sourceCount: localWorkspace.sources.length,
    instances: localWorkspace.instances,
  })});`;
}
