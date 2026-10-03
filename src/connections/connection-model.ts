import {
  BoardResourceRegistry,
  type BoardProfile,
  type ResolvedAdcChannel,
  type ResolvedBoardPin,
  type ResolvedI2cController,
  type ResolvedPwmOutput,
  type ResolvedSpiController,
  type ResolvedUartController,
} from "../board/board-profile.ts";
import type { DeviceDefinition, DevicePortKind } from "../device-api/types.ts";

export const CONNECTION_GRAPH_SCHEMA_VERSION = 1 as const;
export const MAX_CONNECTION_DEVICES = 64;
export const MAX_CONNECTION_PORTS_PER_DEVICE = 32;

export interface ConnectionGraphV1 {
  readonly schemaVersion: 1;
  readonly boardProfile: { readonly id: string; readonly version: number };
  readonly devices: readonly DeviceConnectionV1[];
}

export interface DeviceConnectionV1 {
  readonly instanceId: string;
  readonly deviceId: string;
  readonly deviceVersion: string;
  readonly ports: readonly PortConnectionV1[];
}

export interface PortConnectionV1 {
  readonly portId: string;
  readonly endpoint: ConnectionEndpointV1;
}

export type ConnectionEndpointV1 =
  | { readonly kind: "gpio"; readonly pin: string }
  | { readonly kind: "adc"; readonly pin: string }
  | { readonly kind: "i2c"; readonly controller: number; readonly address: number }
  | {
      readonly kind: "spi";
      readonly controller: number;
      readonly selectPort?: string;
      readonly activeLevel?: 0 | 1;
      readonly fallback?: true;
    }
  | { readonly kind: "uart"; readonly controller: number }
  | { readonly kind: "pwm"; readonly pin: string };

export type ResolvedConnectionEndpoint =
  | { readonly kind: "gpio"; readonly pin: ResolvedBoardPin }
  | { readonly kind: "adc"; readonly channel: ResolvedAdcChannel }
  | {
      readonly kind: "i2c";
      readonly controller: ResolvedI2cController;
      readonly address: number;
    }
  | {
      readonly kind: "spi";
      readonly controller: ResolvedSpiController;
      readonly selectPortId?: string;
      readonly selectPin?: ResolvedBoardPin;
      readonly activeLevel?: 0 | 1;
      readonly fallback: boolean;
    }
  | { readonly kind: "uart"; readonly controller: ResolvedUartController }
  | { readonly kind: "pwm"; readonly output: ResolvedPwmOutput };

export interface ResolvedPortConnection {
  readonly instanceId: string;
  readonly portId: string;
  readonly portKind: DevicePortKind;
  readonly endpoint: ResolvedConnectionEndpoint;
}

export interface ResolvedConnectionGraph {
  readonly schemaVersion: 1;
  readonly boardProfile: ConnectionGraphV1["boardProfile"];
  readonly ports: readonly ResolvedPortConnection[];
}

const ENDPOINT_FIELDS: Record<ConnectionEndpointV1["kind"], readonly string[]> = {
  gpio: ["kind", "pin"],
  adc: ["kind", "pin"],
  i2c: ["kind", "controller", "address"],
  spi: ["kind", "controller", "selectPort", "activeLevel", "fallback"],
  uart: ["kind", "controller"],
  pwm: ["kind", "pin"],
};

export function validateConnectionGraph(value: unknown): ConnectionGraphV1 {
  const graph = record(value, "Connection graph");
  rejectUnknown(graph, ["schemaVersion", "boardProfile", "devices"], "Connection graph");
  if (graph.schemaVersion !== CONNECTION_GRAPH_SCHEMA_VERSION) {
    throw new RangeError(`Unsupported connection graph version: ${String(graph.schemaVersion)}`);
  }
  const profile = record(graph.boardProfile, "Connection graph boardProfile");
  rejectUnknown(profile, ["id", "version"], "Connection graph boardProfile");
  const boardProfile = Object.freeze({
    id: identifier(profile.id, "Connection graph board profile id"),
    version: positiveInteger(profile.version, "Connection graph board profile version"),
  });
  if (!Array.isArray(graph.devices) || graph.devices.length > MAX_CONNECTION_DEVICES) {
    throw new RangeError(`Connection graph supports at most ${MAX_CONNECTION_DEVICES} devices.`);
  }
  const instanceIds = new Set<string>();
  const devices = graph.devices.map((entry, index) => {
    const device = record(entry, `Connection graph device ${index}`);
    rejectUnknown(
      device,
      ["instanceId", "deviceId", "deviceVersion", "ports"],
      `Connection graph device ${index}`,
    );
    const instanceId = identifier(device.instanceId, `Connection graph device ${index} instanceId`);
    if (instanceIds.has(instanceId)) {
      throw new Error(`Duplicate connection device instance: ${instanceId}`);
    }
    instanceIds.add(instanceId);
    if (!Array.isArray(device.ports) || device.ports.length > MAX_CONNECTION_PORTS_PER_DEVICE) {
      throw new RangeError(
        `Connection device ${instanceId} supports at most ${MAX_CONNECTION_PORTS_PER_DEVICE} ports.`,
      );
    }
    const portIds = new Set<string>();
    const ports = device.ports.map((portValue, portIndex) => {
      const port = record(portValue, `Connection device ${instanceId} port ${portIndex}`);
      rejectUnknown(port, ["portId", "endpoint"], `Connection device ${instanceId} port`);
      const portId = identifier(port.portId, `Connection device ${instanceId} portId`);
      if (portIds.has(portId)) {
        throw new Error(`Duplicate connection port: ${instanceId}.${portId}`);
      }
      portIds.add(portId);
      return Object.freeze({ portId, endpoint: validateEndpoint(port.endpoint, instanceId, portId) });
    });
    return Object.freeze({
      instanceId,
      deviceId: identifier(device.deviceId, `Connection device ${instanceId} deviceId`),
      deviceVersion: semanticVersion(device.deviceVersion, `Connection device ${instanceId} version`),
      ports: Object.freeze(ports),
    });
  });
  return Object.freeze({
    schemaVersion: CONNECTION_GRAPH_SCHEMA_VERSION,
    boardProfile,
    devices: Object.freeze(devices),
  });
}

export function resolveConnectionGraph(
  source: ConnectionGraphV1,
  board: BoardProfile,
  definitions: ReadonlyMap<string, DeviceDefinition>,
): ResolvedConnectionGraph {
  const graph = validateConnectionGraph(source);
  if (graph.boardProfile.id !== board.id || graph.boardProfile.version !== board.version) {
    throw new Error(
      `Connection graph requires ${graph.boardProfile.id}@${graph.boardProfile.version}, received ${board.id}@${board.version}.`,
    );
  }
  const resources = new BoardResourceRegistry();
  const resolved: ResolvedPortConnection[] = [];
  const spiFallbacks = new Set<number>();
  const uartControllers = new Set<number>();

  for (const device of graph.devices) {
    const definition = definitions.get(device.instanceId);
    if (definition === undefined) {
      throw new Error(`Connection device ${device.instanceId} has no Device Definition.`);
    }
    const manifest = definition.manifest;
    if (manifest.id !== device.deviceId || manifest.version !== device.deviceVersion) {
      throw new Error(
        `Connection device ${device.instanceId} expects ${device.deviceId}@${device.deviceVersion}, received ${manifest.id}@${manifest.version}.`,
      );
    }
    const declaredPorts = new Map(manifest.ports.map((port) => [port.id, port]));
    if (declaredPorts.size !== device.ports.length) {
      throw new Error(`Connection device ${device.instanceId} must bind every declared port exactly once.`);
    }
    const resolvedByPort = new Map<string, ResolvedPortConnection>();
    for (const connection of device.ports) {
      const declared = declaredPorts.get(connection.portId);
      if (declared === undefined) {
        throw new Error(`Connection port ${device.instanceId}.${connection.portId} is not declared.`);
      }
      assertEndpointCompatibility(declared.kind, connection.endpoint.kind, device.instanceId, connection.portId);
      if (
        connection.endpoint.kind === "i2c" &&
        declared.defaultAddress !== undefined &&
        connection.endpoint.address !== declared.defaultAddress
      ) {
        throw new Error(
          `Connection port ${device.instanceId}.${connection.portId} must use address ${formatI2cAddress(declared.defaultAddress)}.`,
        );
      }
      const port = resolvePortConnection(
        device.instanceId,
        connection,
        declared.kind,
        board,
        resources,
        spiFallbacks,
        uartControllers,
      );
      resolvedByPort.set(connection.portId, port);
    }
    for (const declaredPortId of declaredPorts.keys()) {
      if (!resolvedByPort.has(declaredPortId)) {
        throw new Error(`Connection device ${device.instanceId} does not bind port ${declaredPortId}.`);
      }
    }
    resolveSpiSelections(device, resolvedByPort);
    resolved.push(...resolvedByPort.values());
  }
  return Object.freeze({
    schemaVersion: CONNECTION_GRAPH_SCHEMA_VERSION,
    boardProfile: graph.boardProfile,
    ports: Object.freeze(resolved),
  });
}

export function findResolvedConnection(
  graph: ResolvedConnectionGraph,
  instanceId: string,
  portId: string,
): ResolvedPortConnection {
  const connection = graph.ports.find(
    (candidate) => candidate.instanceId === instanceId && candidate.portId === portId,
  );
  if (connection === undefined) {
    throw new Error(`No resolved connection for ${instanceId}.${portId}.`);
  }
  return connection;
}

function resolvePortConnection(
  instanceId: string,
  connection: PortConnectionV1,
  portKind: DevicePortKind,
  board: BoardProfile,
  resources: BoardResourceRegistry,
  spiFallbacks: Set<number>,
  uartControllers: Set<number>,
): ResolvedPortConnection {
  const owner = `${instanceId}.${connection.portId}`;
  const endpoint = connection.endpoint;
  let resolvedEndpoint: ResolvedConnectionEndpoint;
  switch (endpoint.kind) {
    case "gpio": {
      const pin = board.resolvePin(endpoint.pin);
      resources.claimPin(owner, pin);
      resolvedEndpoint = { kind: endpoint.kind, pin };
      break;
    }
    case "adc": {
      const channel = board.resolveAdc(board.resolvePin(endpoint.pin));
      resources.claimPin(owner, channel.pin);
      resolvedEndpoint = { kind: endpoint.kind, channel };
      break;
    }
    case "i2c": {
      const controller = board.resolveI2c(endpoint.controller);
      claimI2cController(resources, controller);
      resources.claimI2cAddress(owner, controller.id, endpoint.address);
      resolvedEndpoint = { kind: endpoint.kind, controller, address: endpoint.address };
      break;
    }
    case "spi": {
      const controller = board.resolveSpi(endpoint.controller);
      claimSpiController(resources, controller);
      if (endpoint.fallback === true) {
        if (spiFallbacks.has(controller.id)) {
          throw new Error(`SPI${controller.id} has more than one fallback target.`);
        }
        spiFallbacks.add(controller.id);
      }
      resolvedEndpoint = {
        kind: endpoint.kind,
        controller,
        ...(endpoint.selectPort === undefined ? {} : { selectPortId: endpoint.selectPort }),
        ...(endpoint.activeLevel === undefined ? {} : { activeLevel: endpoint.activeLevel }),
        fallback: endpoint.fallback === true,
      };
      break;
    }
    case "uart": {
      const controller = board.resolveUart(endpoint.controller);
      if (uartControllers.has(controller.id)) {
        throw new Error(`UART${controller.id} has more than one peer.`);
      }
      uartControllers.add(controller.id);
      resources.claimBus(owner, "uart", controller.id);
      resources.claimPin(owner, controller.tx);
      resources.claimPin(owner, controller.rx);
      resolvedEndpoint = { kind: endpoint.kind, controller };
      break;
    }
    case "pwm": {
      const output = board.resolvePwm(board.resolvePin(endpoint.pin));
      resources.claimPin(owner, output.pin);
      resolvedEndpoint = { kind: endpoint.kind, output };
      break;
    }
  }
  return { instanceId, portId: connection.portId, portKind, endpoint: resolvedEndpoint };
}

function resolveSpiSelections(
  device: DeviceConnectionV1,
  resolvedByPort: Map<string, ResolvedPortConnection>,
): void {
  for (const connection of device.ports) {
    if (connection.endpoint.kind !== "spi" || connection.endpoint.selectPort === undefined) {
      continue;
    }
    const spi = resolvedByPort.get(connection.portId)!;
    const select = resolvedByPort.get(connection.endpoint.selectPort);
    if (spi.endpoint.kind !== "spi") {
      throw new Error(`Connection endpoint ${device.instanceId}.${connection.portId} is not SPI.`);
    }
    if (select?.portKind !== "gpio-observer" || select.endpoint.kind !== "gpio") {
      throw new Error(
        `SPI connection ${device.instanceId}.${connection.portId} selectPort must reference a gpio-observer on the same device.`,
      );
    }
    resolvedByPort.set(connection.portId, {
      ...spi,
      endpoint: {
        ...spi.endpoint,
        selectPin: select.endpoint.pin,
      },
    });
  }
}

function claimI2cController(
  resources: BoardResourceRegistry,
  controller: ResolvedI2cController,
): void {
  const owner = `shared:i2c:${controller.id}`;
  resources.claimPin(owner, controller.scl);
  resources.claimPin(owner, controller.sda);
}

function claimSpiController(
  resources: BoardResourceRegistry,
  controller: ResolvedSpiController,
): void {
  const owner = `shared:spi:${controller.id}`;
  resources.claimPin(owner, controller.sck);
  resources.claimPin(owner, controller.mosi);
  resources.claimPin(owner, controller.miso);
}

function assertEndpointCompatibility(
  portKind: DevicePortKind,
  endpointKind: ConnectionEndpointV1["kind"],
  instanceId: string,
  portId: string,
): void {
  const compatible =
    (endpointKind === "gpio" && (portKind === "gpio-observer" || portKind === "gpio-driver")) ||
    (endpointKind === "adc" && portKind === "adc-source") ||
    (endpointKind === "i2c" && portKind === "i2c-target") ||
    (endpointKind === "spi" && portKind === "spi-target") ||
    (endpointKind === "uart" && portKind === "uart-peer") ||
    (endpointKind === "pwm" && portKind === "pwm-observer");
  if (!compatible) {
    throw new Error(
      `Connection endpoint ${instanceId}.${portId} (${endpointKind}) is incompatible with ${portKind}.`,
    );
  }
}

function validateEndpoint(value: unknown, instanceId: string, portId: string): ConnectionEndpointV1 {
  const label = `Connection endpoint ${instanceId}.${portId}`;
  const endpoint = record(value, label);
  if (!Object.hasOwn(ENDPOINT_FIELDS, String(endpoint.kind))) {
    throw new RangeError(`${label} has unsupported kind ${String(endpoint.kind)}.`);
  }
  const kind = endpoint.kind as ConnectionEndpointV1["kind"];
  rejectUnknown(endpoint, ENDPOINT_FIELDS[kind], label);
  switch (kind) {
    case "gpio":
    case "adc":
    case "pwm":
      return Object.freeze({ kind, pin: pinName(endpoint.pin, `${label} pin`) });
    case "i2c":
      return Object.freeze({
        kind,
        controller: nonNegativeInteger(endpoint.controller, `${label} controller`),
        address: i2cAddress(endpoint.address, `${label} address`),
      });
    case "spi": {
      const selectPort =
        endpoint.selectPort === undefined
          ? undefined
          : identifier(endpoint.selectPort, `${label} selectPort`);
      const fallback = endpoint.fallback;
      if ((selectPort === undefined) === (fallback !== true)) {
        throw new Error(`${label} must specify exactly one of selectPort or fallback.`);
      }
      const activeLevel = endpoint.activeLevel ?? 0;
      if (selectPort === undefined && endpoint.activeLevel !== undefined) {
        throw new Error(`${label} activeLevel requires selectPort.`);
      }
      if (activeLevel !== 0 && activeLevel !== 1) {
        throw new RangeError(`${label} activeLevel must be 0 or 1.`);
      }
      return Object.freeze({
        kind,
        controller: nonNegativeInteger(endpoint.controller, `${label} controller`),
        ...(selectPort === undefined ? {} : { selectPort, activeLevel }),
        ...(fallback === true ? { fallback: true as const } : {}),
      });
    }
    case "uart":
      return Object.freeze({
        kind,
        controller: nonNegativeInteger(endpoint.controller, `${label} controller`),
      });
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label} contains unsupported field ${key}.`);
    }
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new TypeError(`${label} must be a valid identifier.`);
  }
  return value;
}

function semanticVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new TypeError(`${label} must be a semantic version.`);
  }
  return value;
}

function pinName(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:GP\d+|LED)$/.test(value)) {
    throw new TypeError(`${label} must be LED or a GP number.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function i2cAddress(value: unknown, label: string): number {
  const address = nonNegativeInteger(value, label);
  if (address < 0x08 || address > 0x77) {
    throw new RangeError(`${label} must be from 0x08 to 0x77.`);
  }
  return address;
}

function formatI2cAddress(address: number): string {
  return `0x${address.toString(16).padStart(2, "0")}`;
}
