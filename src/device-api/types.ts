export * from "../../packages/device-api/src/index";

import type { DeviceState } from "../../packages/device-api/src/index";

export interface DeviceStateEvent {
  readonly instanceId: string;
  readonly sequence: number;
  readonly state: DeviceState;
}
