import { describe, expect, it } from "vitest";

import {
  createDeviceAction,
  createDeviceUiStateViews,
  validateDeviceUiDefinition,
} from "./device-ui";

const VALID_UI = {
  version: 1,
  title: "Example device",
  description: "Declarative UI",
  components: [
    { id: "status", kind: "state-text", label: "Value", stateKey: "value", format: "integer" },
    {
      id: "indicator",
      kind: "digital-indicator",
      label: "Output",
      stateKey: "enabled",
      onLabel: "On",
      offLabel: "Off",
    },
    { id: "press", kind: "momentary-button", label: "Press", controlId: "pressed" },
    {
      id: "level",
      kind: "number-slider",
      label: "Level",
      controlId: "value",
      stateKey: "value",
      minimum: 0,
      maximum: 100,
      step: 5,
    },
    {
      id: "send",
      kind: "text-input",
      label: "Text",
      controlId: "receiveText",
      maximumLength: 32,
      submitLabel: "Send",
    },
    {
      id: "display",
      kind: "pixel-display",
      label: "Display",
      stateKey: "framebuffer",
      width: 2,
      height: 1,
      encoding: "rgb332-base64",
    },
  ],
} as const;

describe("Device UI declaration", () => {
  it("validates and freezes only allowlisted declarative components", () => {
    const definition = validateDeviceUiDefinition(VALID_UI);

    expect(definition.components).toHaveLength(6);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.components)).toBe(true);
  });

  it("accepts a device without UI components", () => {
    expect(
      validateDeviceUiDefinition({ version: 1, title: "Headless device", components: [] }),
    ).toEqual({ version: 1, title: "Headless device", components: [] });
  });

  it("rejects unknown components, fields, duplicate ids, and unsafe text limits", () => {
    expect(() =>
      validateDeviceUiDefinition({
        version: 1,
        title: "Unsafe",
        components: [{ id: "html", kind: "html", label: "HTML", source: "<script>" }],
      }),
    ).toThrow("Unsupported Device UI component kind");
    expect(() =>
      validateDeviceUiDefinition({ ...VALID_UI, script: "alert(1)" }),
    ).toThrow("unsupported field script");
    expect(() =>
      validateDeviceUiDefinition({
        version: 1,
        title: "Duplicate",
        components: [VALID_UI.components[0], VALID_UI.components[0]],
      }),
    ).toThrow("Duplicate");
    expect(() =>
      validateDeviceUiDefinition({
        version: 1,
        title: "Long text",
        components: [
          {
            id: "text",
            kind: "text-input",
            label: "Text",
            controlId: "text",
            maximumLength: 257,
            submitLabel: "Send",
          },
        ],
      }),
    ).toThrow("1 to 256");
  });

  it("creates typed actions without passing UI events", () => {
    const definition = validateDeviceUiDefinition(VALID_UI);

    expect(createDeviceAction(definition, "press", true)).toEqual({
      controlId: "pressed",
      value: true,
    });
    expect(createDeviceAction(definition, "level", 35)).toEqual({
      controlId: "value",
      value: 35,
    });
    expect(createDeviceAction(definition, "send", "hello")).toEqual({
      controlId: "receiveText",
      value: "hello",
    });
    expect(() => createDeviceAction(definition, "level", 33)).toThrow("step");
    expect(() => createDeviceAction(definition, "status", 1)).toThrow("not interactive");
    expect(() => createDeviceAction(definition, "display", "4AM=")).toThrow("not interactive");
    expect(() => createDeviceAction(definition, "send", "x".repeat(33))).toThrow(
      "at most 32",
    );
  });

  it("creates detached one-way views and reports missing or invalid state keys", () => {
    const definition = validateDeviceUiDefinition(VALID_UI);
    const state = { value: 35, enabled: 1, framebuffer: "4AM=" };
    const views = createDeviceUiStateViews(definition, state);

    state.value = 40;
    expect(views).toEqual([
      {
        componentId: "status",
        kind: "state-text",
        value: 35,
        displayValue: "35",
      },
      {
        componentId: "indicator",
        kind: "digital-indicator",
        value: 1,
        active: true,
        displayValue: "On",
      },
      {
        componentId: "level",
        kind: "number-slider",
        value: 35,
        displayValue: "35",
      },
      {
        componentId: "display",
        kind: "pixel-display",
        value: "4AM=",
        displayValue: "2×1",
      },
    ]);

    const invalidViews = createDeviceUiStateViews(definition, { value: "wrong" });
    expect(invalidViews.find((view) => view.componentId === "indicator")?.error).toContain(
      "状態キー enabled",
    );
    expect(invalidViews.find((view) => view.componentId === "level")?.error).toContain(
      "数値ではありません",
    );
  });

  it("rejects oversized or malformed pixel displays", () => {
    expect(() =>
      validateDeviceUiDefinition({
        version: 1,
        title: "Oversized",
        components: [
          {
            id: "display",
            kind: "pixel-display",
            label: "Display",
            stateKey: "framebuffer",
            width: 200,
            height: 100,
            encoding: "rgb332-base64",
          },
        ],
      }),
    ).toThrow("at most 16384 pixels");

    const definition = validateDeviceUiDefinition(VALID_UI);
    expect(
      createDeviceUiStateViews(definition, {
        value: 0,
        enabled: false,
        framebuffer: "AAAA",
      }).find((view) => view.componentId === "display")?.error,
    ).toContain("RGB332");
  });
});
