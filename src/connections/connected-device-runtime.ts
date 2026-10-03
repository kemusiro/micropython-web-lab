import type { DeviceHost } from "../device-api/device-host";
import type {
  DigitalValue,
  I2cTargetPort,
  PwmObserverPort,
  SpiTargetPort,
  UartPeerPort,
} from "../device-api/types";
import { attachI2cTargetPort } from "../simulation/device-port-adapters";
import type { VirtualI2cBus } from "../simulation/virtual-i2c";
import { VirtualSpiBus } from "../simulation/virtual-spi";
import type { ResolvedConnectionGraph, ResolvedPortConnection } from "./connection-model";

export type I2cPortTransform = (
  connection: ResolvedPortConnection,
  port: I2cTargetPort,
) => I2cTargetPort;

export class ConnectedDeviceRuntime {
  readonly #host: DeviceHost;
  readonly #graph: ResolvedConnectionGraph;
  readonly #gpioValues = new Map<string, DigitalValue>();

  constructor(host: DeviceHost, graph: ResolvedConnectionGraph) {
    this.#host = host;
    this.#graph = graph;
  }

  gpioPinId(instanceId: string, portId: string): string {
    const connection = this.connection(instanceId, portId, "gpio");
    return connection.endpoint.kind === "gpio" ? connection.endpoint.pin.runtimeId : unreachable();
  }

  gpioPinIdOrNull(instanceId: string, portId: string): string | null {
    return this.hasConnection(instanceId, portId)
      ? this.gpioPinId(instanceId, portId)
      : null;
  }

  adcPinId(instanceId: string, portId: string): string {
    const connection = this.connection(instanceId, portId, "adc");
    return connection.endpoint.kind === "adc"
      ? connection.endpoint.channel.pin.runtimeId
      : unreachable();
  }

  adcPinIdOrNull(instanceId: string, portId: string): string | null {
    return this.hasConnection(instanceId, portId)
      ? this.adcPinId(instanceId, portId)
      : null;
  }

  hasConnection(instanceId: string, portId?: string): boolean {
    return this.#graph.ports.some(
      (connection) =>
        connection.instanceId === instanceId &&
        (portId === undefined || connection.portId === portId),
    );
  }

  writeGpio(pinId: string, value: DigitalValue): void {
    this.#gpioValues.set(pinId, value);
    for (const connection of this.connectionsAtPin(pinId, "gpio-observer")) {
      this.#host.getPort(connection.instanceId, connection.portId, "gpio-observer").write(value);
    }
  }

  readGpio(pinId: string): DigitalValue | null {
    const connection = this.singleConnectionAtPin(pinId, "gpio-driver");
    return connection === undefined
      ? null
      : this.#host.getPort(connection.instanceId, connection.portId, "gpio-driver").read();
  }

  readAdc(pinId: string): number | null {
    const connection = this.singleConnectionAtPin(pinId, "adc-source");
    return connection === undefined
      ? null
      : this.#host.getPort(connection.instanceId, connection.portId, "adc-source").readU16();
  }

  attachI2cBus(bus: VirtualI2cBus, transform: I2cPortTransform = (_, port) => port): void {
    for (const connection of this.#graph.ports) {
      if (connection.portKind !== "i2c-target" || connection.endpoint.kind !== "i2c") {
        continue;
      }
      if (connection.endpoint.controller.id !== bus.id) {
        continue;
      }
      const port = this.#host.getPort(connection.instanceId, connection.portId, "i2c-target");
      if (
        port.addresses.length !== 1 ||
        port.addresses[0] !== connection.endpoint.address
      ) {
        throw new Error(
          `I2C port ${connection.instanceId}.${connection.portId} does not provide its resolved address.`,
        );
      }
      attachI2cTargetPort(bus, transform(connection, port));
    }
  }

  createSpiTarget(controllerId: number): SpiTargetPort {
    const bus = new VirtualSpiBus(controllerId);
    for (const connection of this.#graph.ports) {
      if (connection.portKind !== "spi-target" || connection.endpoint.kind !== "spi") {
        continue;
      }
      if (connection.endpoint.controller.id !== controllerId) {
        continue;
      }
      const endpoint = connection.endpoint;
      const selectPinId = endpoint.selectPin?.runtimeId;
      bus.attach({
        id: `${connection.instanceId}.${connection.portId}`,
        port: this.#host.getPort(connection.instanceId, connection.portId, "spi-target"),
        ...(endpoint.fallback ? { fallback: true } : {}),
        ...(selectPinId === undefined
          ? {}
          : {
              isSelected: () =>
                this.#gpioValues.get(selectPinId) === (endpoint.activeLevel ?? 0),
            }),
      });
    }
    return bus;
  }

  uartPeer(controllerId: number): UartPeerPort | null {
    const connection = this.#graph.ports.find(
      (candidate) =>
        candidate.portKind === "uart-peer" &&
        candidate.endpoint.kind === "uart" &&
        candidate.endpoint.controller.id === controllerId,
    );
    return connection === undefined
      ? null
      : this.#host.getPort(connection.instanceId, connection.portId, "uart-peer");
  }

  pwmObserver(pinId: string): PwmObserverPort | null {
    const connection = this.singleConnectionAtPin(pinId, "pwm-observer");
    return connection === undefined
      ? null
      : this.#host.getPort(connection.instanceId, connection.portId, "pwm-observer");
  }

  private connection(
    instanceId: string,
    portId: string,
    endpointKind: ResolvedPortConnection["endpoint"]["kind"],
  ): ResolvedPortConnection {
    const connection = this.#graph.ports.find(
      (candidate) => candidate.instanceId === instanceId && candidate.portId === portId,
    );
    if (connection === undefined || connection.endpoint.kind !== endpointKind) {
      throw new Error(`No ${endpointKind} connection for ${instanceId}.${portId}.`);
    }
    return connection;
  }

  private connectionsAtPin(pinId: string, kind: "gpio-observer"): ResolvedPortConnection[];
  private connectionsAtPin(pinId: string, kind: "gpio-driver"): ResolvedPortConnection[];
  private connectionsAtPin(pinId: string, kind: "adc-source"): ResolvedPortConnection[];
  private connectionsAtPin(pinId: string, kind: "pwm-observer"): ResolvedPortConnection[];
  private connectionsAtPin(pinId: string, kind: ResolvedPortConnection["portKind"]): ResolvedPortConnection[] {
    return this.#graph.ports.filter((connection) => {
      if (connection.portKind !== kind) {
        return false;
      }
      switch (connection.endpoint.kind) {
        case "gpio":
          return connection.endpoint.pin.runtimeId === pinId;
        case "adc":
          return connection.endpoint.channel.pin.runtimeId === pinId;
        case "pwm":
          return connection.endpoint.output.pin.runtimeId === pinId;
        default:
          return false;
      }
    });
  }

  private singleConnectionAtPin(
    pinId: string,
    kind: "gpio-driver" | "adc-source" | "pwm-observer",
  ): ResolvedPortConnection | undefined {
    const matches =
      kind === "gpio-driver"
        ? this.connectionsAtPin(pinId, kind)
        : kind === "adc-source"
          ? this.connectionsAtPin(pinId, kind)
          : this.connectionsAtPin(pinId, kind);
    if (matches.length > 1) {
      throw new Error(`Pin ${pinId} has multiple ${kind} connections.`);
    }
    return matches[0];
  }
}

function unreachable(): never {
  throw new Error("Unreachable connection endpoint.");
}
