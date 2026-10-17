import { describe, expect, it } from "vitest";
import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE as board } from "../board/raspberry-pi-pico-2-w";
import { createReferenceLedDefinition } from "../device-api/reference-devices";
import { connectExperimentButton } from "./button-experiment-connection";
import { type ConnectionGraphV1, resolveConnectionGraph } from "./connection-model";
import { createManagedDeviceDefinitions } from "./connection-presets";
import { MANAGED_CONNECTION_GRAPH as managed } from "./managed-connection-graph";

const definitions = createManagedDeviceDefinitions();
const withoutButton = { ...managed, devices: managed.devices.filter(device => device.instanceId !== "button-gp15") };
const buttonPin = (graph: ConnectionGraphV1) => graph.devices.find(device => device.instanceId === "button-gp15")!.ports[0]!.endpoint;

describe("button experiment connection", () => {
  it("adds the missing button at GP15 without changing the other connections or input graph", () => {
    const original = JSON.stringify(withoutButton);
    const result = connectExperimentButton(withoutButton, board, definitions)!;
    expect(result).toEqual(managed);
    expect(JSON.stringify(withoutButton)).toBe(original);
  });

  it("preserves an already connected button on its user's chosen GPIO", () => {
    const graph: ConnectionGraphV1 = { ...managed, devices: managed.devices.map(device => device.instanceId === "button-gp15"
      ? { ...device, ports: [{ portId: "input", endpoint: { kind: "gpio", pin: "GP13" } }] } : device) };
    expect(connectExperimentButton(graph, board, definitions)).toBe(graph);
  });

  it("can reconnect a retained sample to its previous GPIO", () => {
    expect(buttonPin(connectExperimentButton(withoutButton, board, definitions, "GP13")!))
      .toEqual({ kind: "gpio", pin: "GP13" });
  });

  it("chooses a free GPIO when GP15 is used, including avoiding implicit bus pins", () => {
    const graph: ConnectionGraphV1 = { ...withoutButton, devices: withoutButton.devices.map(device => device.instanceId === "gt-502mgg-n"
      ? { ...device, ports: device.ports.map(port => port.portId === "pps"
        ? { ...port, endpoint: { kind: "gpio", pin: "GP15" } } : port) } : device) };
    const result = connectExperimentButton(graph, board, definitions)!;
    expect(result).not.toBeNull();
    expect(buttonPin(result)).not.toEqual({ kind: "gpio", pin: "GP15" });
    expect(result.devices.filter(device => device.instanceId !== "button-gp15")).toEqual(graph.devices);
    expect(() => resolveConnectionGraph(result, board, definitions)).not.toThrow();
  });

  it("adds no other default devices to a board-only workspace", () => {
    const graph = { ...managed, devices: [managed.devices[0]!] };
    expect(connectExperimentButton(graph, board, definitions)!.devices.map(device => device.instanceId))
      .toEqual(["built-in-led", "button-gp15"]);
  });

  it("leaves the graph unchanged if every GPIO is occupied", () => {
    const busyDefinitions = new Map(definitions);
    const graph: ConnectionGraphV1 = { ...managed, devices: board.physicalPins.flatMap(pin => {
      if (pin.kind !== "gpio" || pin.gpioId === undefined) return [];
      const instanceId = `busy-${pin.gpioId}`;
      busyDefinitions.set(instanceId, createReferenceLedDefinition());
      return [{ ...managed.devices[0]!, instanceId, ports: [{ portId: "output", endpoint: { kind: "gpio" as const, pin: pin.gpioId } }] }];
    }) };
    const original = JSON.stringify(graph);
    expect(() => resolveConnectionGraph(graph, board, busyDefinitions)).not.toThrow();
    expect(connectExperimentButton(graph, board, busyDefinitions)).toBeNull();
    expect(JSON.stringify(graph)).toBe(original);
  });
});
