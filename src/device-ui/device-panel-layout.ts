import type { DeviceUiDefinition } from "./device-ui";

export type DevicePanelSize = "1x1" | "1x2" | "2x2";

export interface DevicePanelSpan {
  readonly columns: 1 | 2;
  readonly rows: 1 | 2;
  readonly label: "1×1" | "1×2" | "2×2";
}

const PANEL_SPANS: Readonly<Record<DevicePanelSize, DevicePanelSpan>> = Object.freeze({
  "1x1": Object.freeze({ columns: 1, rows: 1, label: "1×1" }),
  "1x2": Object.freeze({ columns: 1, rows: 2, label: "1×2" }),
  "2x2": Object.freeze({ columns: 2, rows: 2, label: "2×2" }),
});

export function devicePanelSize(definition: DeviceUiDefinition): DevicePanelSize {
  const needsWideWorkspace = definition.components.some(
    (component) =>
      component.kind === "text-input" ||
      (component.kind === "pixel-display" && component.width * component.height > 64),
  );
  if (needsWideWorkspace) {
    return "2x2";
  }
  if (definition.components.length >= 5) {
    return "1x2";
  }
  return "1x1";
}

export function devicePanelSpan(size: DevicePanelSize): DevicePanelSpan {
  return PANEL_SPANS[size];
}
