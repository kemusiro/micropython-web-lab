declare const __WEB_LAB_LOCAL_MODE__: boolean;
declare const __WEB_LAB_LOCAL_DEVICE_ID__: string;
declare const __WEB_LAB_LOCAL_DEVICE_NAME__: string;

declare module "virtual:local-device" {
  import type { DeviceDefinition } from "./device-api/types";
  import type { ConnectionGraphV1 } from "./connections/connection-model";
  import type { ConnectionPresetId } from "./connections/connection-presets";

  export interface LocalDeviceBundle {
    readonly basePreset: ConnectionPresetId;
    readonly connectionGraph: ConnectionGraphV1;
    readonly devices: readonly {
      readonly instanceId: string;
      readonly definition: DeviceDefinition;
    }[];
  }

  export const localDeviceBundle: LocalDeviceBundle | null;
}

declare module "virtual:local-device-metadata" {
  import type { ConnectionGraphV1 } from "./connections/connection-model";
  import type { ConnectionPresetId } from "./connections/connection-presets";

  export interface LocalDeviceMetadata {
    readonly basePreset: ConnectionPresetId;
    readonly connectionGraph: ConnectionGraphV1;
    readonly sourceCount: number;
    readonly instances: readonly {
      readonly instanceId: string;
      readonly sourceId: string;
      readonly deviceId: string;
      readonly deviceVersion: string;
      readonly name: string;
    }[];
  }

  export const localDeviceMetadata: LocalDeviceMetadata | null;
}
