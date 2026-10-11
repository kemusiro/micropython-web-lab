import { expect, it } from "vitest";
import { defaultYmPatch, patchPython, patchPreviewPython, patchHeldPython, validateYmPatch } from "./ym2203-patch";

it("keeps independent operator settings and defaults for separate editing sessions", () => {
  const first = defaultYmPatch(), second = defaultYmPatch();
  first.operators[0]!.multiple = 7;
  expect(second.operators[0]!.multiple).toBe(1);
  expect(first.operators[1]!.multiple).toBe(1);
  expect(patchPython(first)).toContain('"multiple": 7');
});
it("rejects malformed parameters before generating executable preview or export code", () => {
  const changes = [
    { channel: 3 }, { note: 117 }, { note: -1 }, { volume: 101 }, { volume: NaN },
    { algorithm: 8 }, { feedback: -1 }, { operators: [] }, { noisePeriod: 0 },
    { envelopePeriod: 65536 }, { shape: 16 }, { source: "ssg" as const, tone: false, noise: false },
    { source: "ssg" as const, note: 22 },
  ];
  for (const change of changes) {
    const patch = { ...defaultYmPatch(), ...change };
    expect(() => patchPython(patch)).toThrow(); expect(() => patchPreviewPython(patch)).toThrow();
    expect(() => patchHeldPython(patch)).toThrow(); expect(() => patchHeldPython(patch, true)).toThrow();
  }
  const fractional = defaultYmPatch(); fractional.operators[3]!.attack = 1.5;
  expect(() => validateYmPatch(fractional)).toThrow(/OP4 AR/);
});
it("uses bounded reservations for auditions and emits noise-only Python without a MIDI pitch", () => {
  const patch = defaultYmPatch(); patch.source = "ssg"; patch.tone = false; patch.noise = true; patch.envelope = true;
  expect(patchPython(patch)).toContain("sound.ssg_sound(None, channel=0, volume=11, tone=False, noise=True, envelope=True)");
  const source = patchPreviewPython(patch);
  expect(source).toContain("bytes((2, 220, 5,))");
  expect(source).not.toContain("import YM2203");
  expect(source).not.toContain("sleep");
});

it("renews held keys with one bounded unchanged register write and no reset or retrigger", () => {
  const patch = defaultYmPatch(); patch.channel = 2;
  const start = patchHeldPython(patch);
  expect(start).toContain("bytes((3,))");
  expect(start).toContain("242,"); // All four FM operators, channel 2.
  const renew = patchHeldPython(patch, true);
  expect(renew.match(/writeto/g)).toHaveLength(1);
  expect(renew).toContain("bytes((0, 162,");
  expect(renew).not.toContain("bytes((3,");
  patch.source = "ssg"; patch.envelope = true; patch.tone = false; patch.noise = true;
  expect(patchHeldPython(patch, true)).toContain("bytes((0, 10, 16,))");
});
