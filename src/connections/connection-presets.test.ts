import { describe, expect, it } from "vitest";

import {
  BOARD_ONLY_PICO_2_W_PRESET_ID,
  MANAGED_PICO_2_W_PRESET_ID,
  createConnectionPreset,
  mergeConnectionGraphs,
} from "./connection-presets";
import { validateConnectionGraph } from "./connection-model";

describe("connection presets", () => {
  it("provides stable managed and board-only preset contents", () => {
    const managed = createConnectionPreset(MANAGED_PICO_2_W_PRESET_ID);
    const boardOnly = createConnectionPreset(BOARD_ONLY_PICO_2_W_PRESET_ID);

    expect(managed.graph.devices).toHaveLength(10);
    expect(managed.definitions.size).toBe(10);
    expect(managed.graph.devices.at(-1)?.instanceId).toBe("ostamc5a31a-vv");
    expect(boardOnly.graph.devices.map((device) => device.instanceId)).toEqual([
      "built-in-led",
    ]);
    expect([...boardOnly.definitions.keys()]).toEqual(["built-in-led"]);
  });

  it("merges local instances without changing either source graph", () => {
    const base = createConnectionPreset(BOARD_ONLY_PICO_2_W_PRESET_ID).graph;
    const local = validateConnectionGraph({
      schemaVersion: 1,
      boardProfile: base.boardProfile,
      devices: [
        {
          instanceId: "local-led",
          deviceId: "org.example.local-led",
          deviceVersion: "0.1.0",
          ports: [{ portId: "output", endpoint: { kind: "gpio", pin: "GP20" } }],
        },
      ],
    });

    const merged = mergeConnectionGraphs(base, local);

    expect(merged.devices.map((device) => device.instanceId)).toEqual([
      "built-in-led",
      "local-led",
    ]);
    expect(base.devices).toHaveLength(1);
    expect(local.devices).toHaveLength(1);
  });
});
