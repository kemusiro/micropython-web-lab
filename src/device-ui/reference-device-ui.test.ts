import { describe, expect, it } from "vitest";

import { createDeviceAction, createDeviceUiStateViews } from "./device-ui";
import {
  findReferenceDeviceUi,
  referenceDeviceUisForConnectionGraph,
  REFERENCE_DEVICE_UIS,
} from "./reference-device-ui";
import { validateConnectionGraph } from "../connections/connection-model";
import { MANAGED_CONNECTION_GRAPH } from "../connections/managed-connection-graph";

describe("reference Device UI declarations", () => {
  it("declares every M11.2 reference device without executable presentation data", () => {
    expect(REFERENCE_DEVICE_UIS.map((entry) => entry.instanceId)).toEqual([
      "built-in-led",
      "button-gp15",
      "analog-gp26",
      "i2c-register-0x50",
      "ae-bme280-0x76",
      "spi-register-0",
      "qt095b-ssd1331",
      "gt-502mgg-n",
      "ostamc5a31a-vv",
      "pwm-indicator-gp16",
    ]);
    expect(JSON.stringify(REFERENCE_DEVICE_UIS)).not.toMatch(/<script|javascript:|\"html\"/i);
  });

  it("maps reference controls to validated DeviceActions", () => {
    const button = findReferenceDeviceUi("button-gp15")!;
    const analog = findReferenceDeviceUi("analog-gp26")!;
    const gps = findReferenceDeviceUi("gt-502mgg-n")!;
    const bme280 = findReferenceDeviceUi("ae-bme280-0x76")!;

    expect(createDeviceAction(button.definition, "press", true)).toEqual({
      controlId: "pressed",
      value: true,
    });
    expect(createDeviceAction(analog.definition, "value", 60_000)).toEqual({
      controlId: "value",
      value: 60_000,
    });
    expect(createDeviceAction(gps.definition, "position", "35.0,139.0,10")).toEqual({
      controlId: "positionText",
      value: "35.0,139.0,10",
    });
    expect(createDeviceAction(bme280.definition, "temperature", 30)).toEqual({
      controlId: "temperatureC",
      value: 30,
    });
  });

  it("labels the push button with its connected GPIO without mutating the reference", () => {
    const graph = validateConnectionGraph({
      ...MANAGED_CONNECTION_GRAPH,
      devices: MANAGED_CONNECTION_GRAPH.devices.map((device) =>
        device.instanceId === "button-gp15"
          ? { ...device, ports: [{ portId: "input", endpoint: { kind: "gpio", pin: "GP13" } }] }
          : device,
      ),
    });
    const button = referenceDeviceUisForConnectionGraph(graph, "ja").find(
      (entry) => entry.instanceId === "button-gp15",
    )!;
    const englishButton = referenceDeviceUisForConnectionGraph(graph, "en").find(
      (entry) => entry.instanceId === "button-gp15",
    )!;

    expect(button.definition.components.find((component) => component.id === "press")?.label).toBe(
      "GP13",
    );
    expect(button.definition.description).toContain("GP13へ接続");
    expect(englishButton.definition.description).toContain("connected to GP13");
    expect(
      findReferenceDeviceUi("button-gp15")!.definition.components.find(
        (component) => component.id === "press",
      )?.label,
    ).toBe("GPIO 15");
  });

  it("binds reference state keys one way", () => {
    const pwm = findReferenceDeviceUi("pwm-indicator-gp16")!;
    expect(
      createDeviceUiStateViews(pwm.definition, {
        enabled: true,
        frequencyHz: 2_000,
        dutyU16: 32_768,
        inverted: false,
      }).map((view) => view.displayValue),
    ).toEqual(["有効", "2,000", "32,768", "いいえ"]);
  });

  it("declares a bounded SSD1331 framebuffer preview", () => {
    const display = findReferenceDeviceUi("qt095b-ssd1331")!;
    const framebuffer = btoa(String.fromCharCode(...new Uint8Array(96 * 64)));

    expect(
      createDeviceUiStateViews(display.definition, {
        framebuffer,
        displayOn: true,
        baudrate: 8_000_000,
        transferCount: 24,
      }).map((view) => view.displayValue),
    ).toEqual(["96×64", "表示中", "8,000,000", "24"]);
  });

  it("renders GPS acquisition, PPS, and 1 Hz state without executable UI code", () => {
    const gps = findReferenceDeviceUi("gt-502mgg-n")!;
    const views = createDeviceUiStateViews(gps.definition, {
      acquisitionState: "fixed",
      fix: true,
      latitude: 35.681236,
      longitude: 139.767125,
      altitudeMeters: 40,
      satellites: 8,
      pps: true,
      nmeaRateHz: 1,
      bufferedBytes: 0,
      sentenceCount: 10,
      skippedSnapshots: 0,
      baudrate: 9_600,
    });

    expect(views.find((view) => view.componentId === "acquisition")?.displayValue).toBe("fixed");
    expect(views.find((view) => view.componentId === "pps")?.displayValue).toBe("HIGH");
    expect(views.find((view) => view.componentId === "nmea-rate")?.displayValue).toBe("1");
  });

  it("renders the resistor-integrated RGB LED color and PWM duties", () => {
    const rgbLed = findReferenceDeviceUi("ostamc5a31a-vv")!;
    const views = createDeviceUiStateViews(rgbLed.definition, {
      framebuffer: "6g==",
      active: true,
      colorHex: "#ff40b4",
      redDutyU16: 65_535,
      greenDutyU16: 16_448,
      blueDutyU16: 46_260,
      updateCount: 3,
    });

    expect(views.find((view) => view.componentId === "color")?.displayValue).toBe("1×1");
    expect(views.find((view) => view.componentId === "active")?.displayValue).toBe("点灯");
    expect(views.find((view) => view.componentId === "hex-color")?.displayValue).toBe("#ff40b4");
  });
});
