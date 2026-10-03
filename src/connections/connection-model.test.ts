import { describe, expect, it } from "vitest";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import {
  createReferenceAnalogInputDefinition,
  createReferenceButtonDefinition,
  createReferenceI2cRegisterDefinition,
  createReferenceLedDefinition,
  createReferencePwmIndicatorDefinition,
  createReferenceSpiRegisterDefinition,
} from "../device-api/reference-devices";
import { createAeBme280Definition } from "../devices/bme280";
import { createGt502MggDefinition } from "../devices/gt-502mgg";
import { createOstamc5a31aVvDefinition } from "../devices/ostamc5a31a-vv";
import { createSsd1331Definition } from "../devices/ssd1331";
import type { DeviceDefinition } from "../device-api/types";
import { resolveConnectionGraph, validateConnectionGraph } from "./connection-model";
import { MANAGED_CONNECTION_GRAPH } from "./managed-connection-graph";

describe("Connection Model v1", () => {
  it("resolves the managed BME280 and SSD1331 wiring through the Pico 2 W profile", () => {
    const graph = resolveConnectionGraph(
      MANAGED_CONNECTION_GRAPH,
      RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
      managedDefinitions(),
    );
    const bme = graph.ports.find((port) => port.instanceId === "ae-bme280-0x76")!;
    const spi = graph.ports.find(
      (port) => port.instanceId === "qt095b-ssd1331" && port.portId === "spi",
    )!;

    expect(bme.endpoint).toMatchObject({
      kind: "i2c",
      address: 0x76,
      controller: { id: 0, sda: { runtimeId: "8" }, scl: { runtimeId: "9" } },
    });
    expect(spi.endpoint).toMatchObject({
      kind: "spi",
      controller: {
        id: 0,
        sck: { runtimeId: "6" },
        mosi: { runtimeId: "7" },
        miso: { runtimeId: "4" },
      },
      selectPortId: "cs",
      selectPin: { runtimeId: "5" },
      activeLevel: 0,
      fallback: false,
    });
  });

  it("rejects a GPIO assignment that conflicts with shared I2C pins", () => {
    const source = cloneManagedGraph();
    const ssd = source.devices.find((device) => device.instanceId === "qt095b-ssd1331")!;
    ssd.ports.find((port) => port.portId === "cs")!.endpoint = { kind: "gpio", pin: "GP8" };

    expect(() =>
      resolveConnectionGraph(
        validateConnectionGraph(source),
        RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
        managedDefinitions(),
      ),
    ).toThrow("pin:GP8 is already claimed");
  });

  it("rejects missing ports and incompatible endpoint kinds", () => {
    const missing = cloneManagedGraph();
    const ssd = missing.devices.find((device) => device.instanceId === "qt095b-ssd1331")!;
    ssd.ports = ssd.ports.filter((port) => port.portId !== "reset");
    expect(() =>
      resolveConnectionGraph(
        validateConnectionGraph(missing),
        RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
        managedDefinitions(),
      ),
    ).toThrow("bind every declared port");

    const incompatible = cloneManagedGraph();
    incompatible.devices.find(
      (device) => device.instanceId === "analog-gp26",
    )!.ports[0]!.endpoint = { kind: "gpio", pin: "GP26" };
    expect(() =>
      resolveConnectionGraph(
        validateConnectionGraph(incompatible),
        RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
        managedDefinitions(),
      ),
    ).toThrow("incompatible with adc-source");
  });

  it("rejects duplicate I2C addresses before runtime creation", () => {
    const first = createReferenceI2cRegisterDefinition(0x50);
    const second = createReferenceI2cRegisterDefinition(0x50);
    const graph = validateConnectionGraph({
      schemaVersion: 1,
      boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
      devices: [
        connectionFor("first", first, 0x50),
        connectionFor("second", second, 0x50),
      ],
    });

    expect(() =>
      resolveConnectionGraph(
        graph,
        RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
        new Map([
          ["first", first],
          ["second", second],
        ]),
      ),
    ).toThrow("i2c:0:80 is already claimed");
  });
});

function managedDefinitions(): ReadonlyMap<string, DeviceDefinition> {
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

function cloneManagedGraph(): {
  schemaVersion: number;
  boardProfile: { id: string; version: number };
  devices: Array<{
    instanceId: string;
    deviceId: string;
    deviceVersion: string;
    ports: Array<{ portId: string; endpoint: Record<string, unknown> }>;
  }>;
} {
  return JSON.parse(JSON.stringify(MANAGED_CONNECTION_GRAPH)) as ReturnType<typeof cloneManagedGraph>;
}

function connectionFor(instanceId: string, definition: DeviceDefinition, address: number) {
  return {
    instanceId,
    deviceId: definition.manifest.id,
    deviceVersion: definition.manifest.version,
    ports: [{ portId: "i2c", endpoint: { kind: "i2c", controller: 0, address } }],
  };
}
