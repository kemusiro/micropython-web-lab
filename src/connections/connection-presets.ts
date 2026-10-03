import { createAeBme280Definition } from "../devices/bme280.ts";
import { createSsd1331Definition } from "../devices/ssd1331.ts";
import { createGt502MggDefinition } from "../devices/gt-502mgg.ts";
import { createOstamc5a31aVvDefinition } from "../devices/ostamc5a31a-vv.ts";
import {
  createReferenceAnalogInputDefinition,
  createReferenceButtonDefinition,
  createReferenceI2cRegisterDefinition,
  createReferenceLedDefinition,
  createReferencePwmIndicatorDefinition,
  createReferenceSpiRegisterDefinition,
} from "../device-api/reference-devices.ts";
import type { DeviceDefinition } from "../device-api/types.ts";
import {
  validateConnectionGraph,
  type ConnectionGraphV1,
} from "./connection-model.ts";
import { MANAGED_CONNECTION_GRAPH } from "./managed-connection-graph.ts";

export const MANAGED_PICO_2_W_PRESET_ID = "pico-2-w-managed-v1" as const;
export const BOARD_ONLY_PICO_2_W_PRESET_ID = "pico-2-w-board-only-v1" as const;

export type ConnectionPresetId =
  | typeof MANAGED_PICO_2_W_PRESET_ID
  | typeof BOARD_ONLY_PICO_2_W_PRESET_ID;

export interface ConnectionPreset {
  readonly id: ConnectionPresetId;
  readonly graph: ConnectionGraphV1;
  readonly definitions: ReadonlyMap<string, DeviceDefinition>;
}

const BOARD_ONLY_CONNECTION_GRAPH = validateConnectionGraph({
  schemaVersion: 1,
  boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
  devices: [MANAGED_CONNECTION_GRAPH.devices[0]],
});

export function isConnectionPresetId(value: unknown): value is ConnectionPresetId {
  return value === MANAGED_PICO_2_W_PRESET_ID || value === BOARD_ONLY_PICO_2_W_PRESET_ID;
}

export function createConnectionPreset(id: ConnectionPresetId): ConnectionPreset {
  if (id === BOARD_ONLY_PICO_2_W_PRESET_ID) {
    return {
      id,
      graph: BOARD_ONLY_CONNECTION_GRAPH,
      definitions: new Map([["built-in-led", createReferenceLedDefinition()]]),
    };
  }
  return {
    id,
    graph: MANAGED_CONNECTION_GRAPH,
    definitions: createManagedDeviceDefinitions(),
  };
}

export function createManagedDeviceDefinitions(): ReadonlyMap<string, DeviceDefinition> {
  return new Map([
    ["built-in-led", createReferenceLedDefinition()],
    ["button-gp15", createReferenceButtonDefinition()],
    ["analog-gp26", createReferenceAnalogInputDefinition()],
    ["i2c-register-0x50", createReferenceI2cRegisterDefinition()],
    ["ae-bme280-0x76", createAeBme280Definition()],
    ["spi-register-0", createReferenceSpiRegisterDefinition()],
    ["qt095b-ssd1331", createSsd1331Definition()],
    ["gt-502mgg-n", createGt502MggDefinition()],
    ["pwm-indicator-gp16", createReferencePwmIndicatorDefinition()],
    ["ostamc5a31a-vv", createOstamc5a31aVvDefinition()],
  ]);
}

export function mergeConnectionGraphs(
  base: ConnectionGraphV1,
  additional: ConnectionGraphV1,
): ConnectionGraphV1 {
  if (
    base.boardProfile.id !== additional.boardProfile.id ||
    base.boardProfile.version !== additional.boardProfile.version
  ) {
    throw new Error("Connection graphs must use the same Board Profile.");
  }
  return validateConnectionGraph({
    schemaVersion: 1,
    boardProfile: base.boardProfile,
    devices: [...base.devices, ...additional.devices],
  });
}
