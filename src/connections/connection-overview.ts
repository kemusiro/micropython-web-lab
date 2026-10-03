import type { BoardProfile } from "../board/board-profile";
import type { ConnectionGraphV1, DeviceConnectionV1 } from "./connection-model";

export interface ConnectionOverviewRow {
  readonly instanceId: string;
  readonly summary: string;
}

export function createConnectionOverviewRows(
  graph: ConnectionGraphV1,
  board: BoardProfile,
): readonly ConnectionOverviewRow[] {
  if (graph.boardProfile.id !== board.id || graph.boardProfile.version !== board.version) {
    throw new Error("Connection overview board profile does not match the connection graph.");
  }
  return Object.freeze(
    graph.devices.map((device) =>
      Object.freeze({ instanceId: device.instanceId, summary: describeDevice(device, board) }),
    ),
  );
}

function describeDevice(device: DeviceConnectionV1, board: BoardProfile): string {
  const parts: string[] = [];
  const spiSelectPorts = new Set(
    device.ports.flatMap((connection) =>
      connection.endpoint.kind === "spi" && connection.endpoint.selectPort !== undefined
        ? [connection.endpoint.selectPort]
        : [],
    ),
  );
  for (const connection of device.ports) {
    const endpoint = connection.endpoint;
    switch (endpoint.kind) {
      case "gpio":
        if (!spiSelectPorts.has(connection.portId)) {
          parts.push(`${signalLabel(connection.portId)}=${board.resolvePin(endpoint.pin).displayName}`);
        }
        break;
      case "adc": {
        const channel = board.resolveAdc(board.resolvePin(endpoint.pin));
        parts.push(`ADC${channel.channel}=${channel.pin.displayName}`);
        break;
      }
      case "i2c": {
        const controller = board.resolveI2c(endpoint.controller);
        parts.push(
          `I2C${controller.id} · SDA=${controller.sda.displayName} · SCL=${controller.scl.displayName} · ${formatAddress(endpoint.address)}`,
        );
        break;
      }
      case "spi": {
        const controller = board.resolveSpi(endpoint.controller);
        const select =
          endpoint.selectPort === undefined
            ? "既定ターゲット"
            : `${signalLabel(endpoint.selectPort)}=${selectPin(device, endpoint.selectPort, board)} (${endpoint.activeLevel === 1 ? "High" : "Low"}選択)`;
        parts.push(
          `SPI${controller.id} · SCK=${controller.sck.displayName} · MOSI=${controller.mosi.displayName} · MISO=${controller.miso.displayName} · ${select}`,
        );
        break;
      }
      case "uart": {
        const controller = board.resolveUart(endpoint.controller);
        parts.push(`UART${controller.id} · TX=${controller.tx.displayName} · RX=${controller.rx.displayName}`);
        break;
      }
      case "pwm": {
        const output = board.resolvePwm(board.resolvePin(endpoint.pin));
        parts.push(`PWM=${output.pin.displayName}`);
        break;
      }
    }
  }
  return parts.join(" · ");
}

function selectPin(device: DeviceConnectionV1, portId: string, board: BoardProfile): string {
  const connection = device.ports.find((candidate) => candidate.portId === portId);
  if (connection?.endpoint.kind !== "gpio") {
    return "未接続";
  }
  return board.resolvePin(connection.endpoint.pin).displayName;
}

function signalLabel(portId: string): string {
  switch (portId.toLowerCase()) {
    case "cs":
      return "CS";
    case "dc":
      return "D/C";
    case "reset":
      return "RESET";
    case "output":
      return "出力";
    case "input":
      return "入力";
    default:
      return portId;
  }
}

function formatAddress(address: number): string {
  return `アドレス0x${address.toString(16).padStart(2, "0")}`;
}
