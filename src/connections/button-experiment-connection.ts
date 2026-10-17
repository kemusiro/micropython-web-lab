import type { BoardProfile } from "../board/board-profile";
import type { DeviceDefinition } from "../device-api/types";
import { resolveConnectionGraph, type ConnectionGraphV1 } from "./connection-model";
import { MANAGED_CONNECTION_GRAPH } from "./managed-connection-graph";

/** Add only the experiment button, without taking pins from the user's other devices. */
export function connectExperimentButton(
  graph: ConnectionGraphV1,
  board: BoardProfile,
  definitions: ReadonlyMap<string, DeviceDefinition>,
  preferredPin = "GP15",
): ConnectionGraphV1 | null {
  if (graph.devices.some(device => device.instanceId === "button-gp15")) return graph;
  const button = MANAGED_CONNECTION_GRAPH.devices.find(device => device.instanceId === "button-gp15")!;
  const pins = new Set([preferredPin, "GP15", ...board.physicalPins.flatMap(pin =>
    pin.kind === "gpio" && pin.gpioId !== undefined ? [pin.gpioId] : [])]);
  const devices = [...graph.devices];
  // Keep the catalog order used by the connection editor.
  const buttonIndex = devices.findIndex(device => device.instanceId !== "built-in-led");
  for (const pin of pins) {
    const connectedDevices = [...devices];
    connectedDevices.splice(buttonIndex < 0 ? devices.length : buttonIndex, 0, {
      ...button,
      ports: [{ portId: "input", endpoint: { kind: "gpio", pin } }],
    });
    const candidate: ConnectionGraphV1 = {
      ...graph,
      devices: connectedDevices,
    };
    try {
      // Includes implicit bus pins, not just explicit GPIO endpoints.
      resolveConnectionGraph(candidate, board, definitions);
      return candidate;
    } catch { /* Try another pin; never disconnect another device to make room. */ }
  }
  return null;
}
