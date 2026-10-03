import { describe, expect, it } from "vitest";

import { devicePanelSize, devicePanelSpan } from "./device-panel-layout";
import type { DeviceUiDefinition } from "./device-ui";

function definition(
  components: DeviceUiDefinition["components"],
): DeviceUiDefinition {
  return { version: 1, title: "test", components };
}

describe("device panel layout", () => {
  it("uses a compact cell for simple controls", () => {
    expect(
      devicePanelSize(
        definition([
          {
            id: "output",
            kind: "digital-indicator",
            label: "output",
            stateKey: "enabled",
            onLabel: "on",
            offLabel: "off",
          },
        ]),
      ),
    ).toBe("1x1");
  });

  it("uses a tall cell for devices with many compact readings", () => {
    expect(
      devicePanelSize(
        definition(
          Array.from({ length: 5 }, (_, index) => ({
            id: `value-${index}`,
            kind: "state-text" as const,
            label: `value ${index}`,
            stateKey: `value${index}`,
          })),
        ),
      ),
    ).toBe("1x2");
  });

  it("uses a wide workspace for text entry and visual displays", () => {
    expect(
      devicePanelSize(
        definition([
          {
            id: "command",
            kind: "text-input",
            label: "command",
            controlId: "command",
            maximumLength: 32,
            submitLabel: "send",
          },
        ]),
      ),
    ).toBe("2x2");
    expect(
      devicePanelSize(
        definition([
          {
            id: "display",
            kind: "pixel-display",
            label: "display",
            stateKey: "framebuffer",
            width: 96,
            height: 64,
            encoding: "rgb332-base64",
          },
        ]),
      ),
    ).toBe("2x2");
    expect(devicePanelSpan("2x2")).toEqual({ columns: 2, rows: 2, label: "2×2" });
  });
});
