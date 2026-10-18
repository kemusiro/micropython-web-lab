import { describe, expect, it } from "vitest";
import { categoryDefinitions, createTemplateCopy, MANAGED_EXPERIMENT_RUNTIME, templateDefinitions } from "./catalog";
import { resolveConnectionGraph } from "../connections/connection-model";
import { createManagedDeviceDefinitions } from "../connections/connection-presets";
import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { YM_INSTANCE } from "../audio/ym2203-protocol";
import { createYm2203PrototypeDefinition } from "../devices/ym2203-prototype";

describe("bundled experiment catalog", () => {
  it("uses overlapping categories and leaves unavailable subjects without runnable placeholders", () => {
    expect(categoryDefinitions).toHaveLength(5);
    expect(templateDefinitions.filter(t => t.categories.includes("physical")).map(t => t.id)).toEqual(["one-axis-arm"]);
    expect(templateDefinitions.filter(t => t.categories.includes("books"))).toHaveLength(0);
    expect(templateDefinitions.find(t => t.id === "button-led")!.categories).toEqual(["devices", "learn"]);
  });
  it("creates independent copies with stable content hashes across locales", async () => {
    const first = await createTemplateCopy("button-led", "ja");
    const second = await createTemplateCopy("button-led", "en");
    expect(first.id).not.toBe(second.id);
    expect(first.origin).toEqual(second.origin);
    expect(first.title).not.toBe(second.title);
    expect(first.runtimeRef).toEqual(MANAGED_EXPERIMENT_RUNTIME);
    second.editor.tabs[0] = { ...second.editor.tabs[0]!, source: "changed copy" };
    expect(first.editor.tabs[0]!.source).toContain("finally:");
  });
  it.each(templateDefinitions.map(template => template.id))("prepares complete, resolvable contents for %s", async id => {
    const record = await createTemplateCopy(id, "ja");
    if (id === "one-axis-arm") {
      expect(record.environment).toEqual({ kind: "model", model: { id: "one-axis-arm", version: "1.0.0" } });
      expect(record.view.id).toBe("arm-v1"); expect(record.initialConditions.arm?.payloadMassKg).toBe(0.15);
      expect(record.editor.tabs[0]!.source).toContain("experiment.step()"); return;
    }
    if (record.environment.kind !== "board") throw new Error("Expected board");
    const graph = record.environment.connectionGraph;
    const definitions = new Map(createManagedDeviceDefinitions());
    definitions.set(YM_INSTANCE, createYm2203PrototypeDefinition(() => { throw new Error("Not executed in catalog validation"); }));
    expect(() => resolveConnectionGraph(graph, RASPBERRY_PI_PICO_2_W_BOARD_PROFILE, definitions)).not.toThrow();
    const main = record.filesystem.entries.find(entry => entry.path === "main.py");
    expect(main?.kind === "file" && new TextDecoder().decode(main.data)).toBe(record.editor.tabs[0]!.source);
    if (id === "ym2203") expect(record.filesystem.entries.some(entry => entry.path === "lib/web_lab_ym2203_score_v1.py")).toBe(true);
  });
});
