import { describe, expect, it } from "vitest";

import {
  DEVICE_PANEL_ORDER_STORAGE_KEY,
  loadDevicePanelOrder,
  reconcileDevicePanelOrder,
  saveDevicePanelOrder,
  updateVisibleDevicePanelOrder,
  type DevicePanelOrderStorage,
} from "./device-panel-order";

class MemoryStorage implements DevicePanelOrderStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("device panel order", () => {
  it("stores and restores a versioned unique order", () => {
    const storage = new MemoryStorage();
    saveDevicePanelOrder(storage, ["sensor", "display", "led"]);

    expect(loadDevicePanelOrder(storage)).toEqual(["sensor", "display", "led"]);
    expect(JSON.parse(storage.values.get(DEVICE_PANEL_ORDER_STORAGE_KEY)!)).toEqual({
      schemaVersion: 1,
      instanceIds: ["sensor", "display", "led"],
    });
  });

  it("rejects malformed, duplicate, and unsupported stored orders", () => {
    const storage = new MemoryStorage();
    for (const value of [
      "not-json",
      JSON.stringify({ schemaVersion: 2, instanceIds: ["sensor"] }),
      JSON.stringify({ schemaVersion: 1, instanceIds: ["sensor", "sensor"] }),
    ]) {
      storage.values.set(DEVICE_PANEL_ORDER_STORAGE_KEY, value);
      expect(loadDevicePanelOrder(storage)).toEqual([]);
    }
  });

  it("keeps hidden devices in their saved slots while visible cards move", () => {
    const preferred = ["led", "hidden-sensor", "button", "display"];
    expect(updateVisibleDevicePanelOrder(preferred, ["display", "led", "button"])).toEqual([
      "display",
      "hidden-sensor",
      "led",
      "button",
    ]);
    expect(reconcileDevicePanelOrder(["led"], ["led", "button", "display"])).toEqual([
      "led",
      "button",
      "display",
    ]);
  });
});
