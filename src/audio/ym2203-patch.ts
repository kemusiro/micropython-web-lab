export const OP_FIELDS = [
  { key: "multiple", label: "MULT", ja: "周波数倍率（0は0.5倍）", en: "Frequency multiple (0 means 0.5)", max: 15 },
  { key: "total_level", label: "TL", ja: "減衰値（小さいほど大きな音）", en: "Attenuation (lower is louder)", max: 127 },
  { key: "attack", label: "AR", ja: "アタック・レート", en: "Attack rate", max: 31 },
  { key: "decay", label: "DR", ja: "ディケイ・レート", en: "Decay rate", max: 31 },
  { key: "sustain_rate", label: "SR", ja: "サステイン中の減衰レート", en: "Sustain rate", max: 31 },
  { key: "sustain_level", label: "SL", ja: "サステイン・レベルの減衰値", en: "Sustain attenuation level", max: 15 },
  { key: "release", label: "RR", ja: "リリース・レート", en: "Release rate", max: 15 },
  { key: "detune", label: "DT", ja: "デチューン・レジスタ値", en: "Detune register value", max: 7 },
  { key: "key_scale", label: "KS", ja: "キー・スケール", en: "Key scale", max: 3 },
  { key: "ssg_eg", label: "SSG-EG", ja: "FM特殊エンベロープ（bit3が有効）", en: "FM special envelope (bit 3 enables)", max: 15 },
] as const;
export type OperatorField = typeof OP_FIELDS[number]["key"];
export type OperatorPatch = Record<OperatorField, number>;
export interface YmPatch {
  source: "fm" | "ssg"; channel: number; note: number; volume: number;
  algorithm: number; feedback: number; operators: OperatorPatch[];
  tone: boolean; noise: boolean; envelope: boolean;
  noisePeriod: number; envelopePeriod: number; shape: number; ssgVolume: number;
}
// Connections, not external artwork; OP4 always contributes to the output.
export const FM_ALGORITHMS = [
  { edges: [[0, 1], [1, 2], [2, 3]], carriers: [3], positions: [[45, 95], [145, 95], [245, 95], [345, 95]] },
  { edges: [[0, 2], [1, 2], [2, 3]], carriers: [3], positions: [[45, 50], [45, 140], [180, 95], [310, 95]] },
  { edges: [[1, 2], [0, 3], [2, 3]], carriers: [3], positions: [[180, 45], [45, 140], [180, 140], [310, 95]] },
  { edges: [[0, 1], [1, 3], [2, 3]], carriers: [3], positions: [[45, 45], [180, 45], [180, 140], [310, 95]] },
  { edges: [[0, 1], [2, 3]], carriers: [1, 3], positions: [[45, 50], [190, 50], [45, 140], [190, 140]] },
  { edges: [[0, 1], [0, 2], [0, 3]], carriers: [1, 2, 3], positions: [[45, 95], [190, 40], [190, 95], [190, 150]] },
  { edges: [[0, 1]], carriers: [1, 2, 3], positions: [[45, 40], [190, 40], [190, 95], [190, 150]] },
  { edges: [], carriers: [0, 1, 2, 3], positions: [[190, 45], [190, 95], [190, 145], [190, 195]] },
] as const;
export function defaultYmPatch(): YmPatch {
  return { source: "fm", channel: 0, note: 72, volume: 30, algorithm: 4, feedback: 0,
    operators: [40, 20, 40, 20].map(total_level => ({ multiple: 1, total_level, attack: 31, decay: 10,
      sustain_rate: 2, sustain_level: 4, release: 7, detune: 0, key_scale: 0, ssg_eg: 0 })),
    tone: true, noise: false, envelope: false, noisePeriod: 12, envelopePeriod: 5000, shape: 10, ssgVolume: 11 };
}
function integer(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name}: ${min}–${max}`);
}
export function validateYmPatch(patch: YmPatch): void {
  if (patch.source !== "fm" && patch.source !== "ssg") throw new TypeError("Source: FM / SSG");
  integer(patch.channel, 0, 2, "Channel"); integer(patch.volume, 0, 100, "Volume");
  integer(patch.note, patch.source === "ssg" && patch.tone ? 23 : 0, patch.source === "fm" ? 116 : 127, "MIDI");
  integer(patch.algorithm, 0, 7, "Algorithm"); integer(patch.feedback, 0, 7, "Feedback");
  if (patch.operators.length !== 4) throw new RangeError("OP1–OP4");
  for (const [index, op] of patch.operators.entries()) {
    for (const field of OP_FIELDS) integer(op[field.key], 0, field.max, `OP${index + 1} ${field.label}`);
  }
  for (const key of ["tone", "noise", "envelope"] as const) if (typeof patch[key] !== "boolean") throw new TypeError(key);
  if (patch.source === "ssg" && !patch.tone && !patch.noise) throw new RangeError("SSG: Tone / Noise");
  integer(patch.noisePeriod, 1, 31, "Noise"); integer(patch.envelopePeriod, 1, 65535, "Envelope");
  integer(patch.shape, 0, 15, "Shape"); integer(patch.ssgVolume, 0, 15, "SSG volume");
}
export function patchSetupPairs(p: YmPatch): number[] {
  validateYmPatch(p);
  const pairs: number[] = [];
  if (p.source === "fm") {
    pairs.push(0x28, p.channel);
    for (const [i, op] of p.operators.entries()) {
      const offset = p.channel + [0, 8, 4, 12][i]!;
      pairs.push(0x30 + offset, op.detune << 4 | op.multiple, 0x40 + offset, op.total_level,
        0x50 + offset, op.key_scale << 6 | op.attack, 0x60 + offset, op.decay,
        0x70 + offset, op.sustain_rate, 0x80 + offset, op.sustain_level << 4 | op.release, 0x90 + offset, op.ssg_eg);
    }
    pairs.push(0xB0 + p.channel, p.feedback << 3 | p.algorithm);
  } else {
    pairs.push(6, p.noisePeriod, 11, p.envelopePeriod & 255, 12, p.envelopePeriod >> 8, 13, p.shape);
    const mask = (1 << p.channel) | (1 << (p.channel + 3));
    const disabled = (p.tone ? 0 : 1 << p.channel) | (p.noise ? 0 : 1 << (p.channel + 3));
    pairs.push(7, (0x3F & ~mask) | disabled);
  }
  return pairs;
}
const bool = (value: boolean) => value ? "True" : "False";
const bus = "I2C(0, scl=Pin(9), sda=Pin(8))";
export function patchPython(p: YmPatch): string {
  validateYmPatch(p);
  const lines = ["from machine import I2C, Pin", "from web_lab_ym2203_tone_v1 import YM2203", ...(p.source === "ssg" ? ["from time import sleep_ms"] : []),
    "", `sound = YM2203(${bus})`, "sound.reset()", `sound.volume(${p.volume})`];
  if (p.source === "fm") {
    lines.push("", "# OP1, OP2, OP3, OP4", "operators = (");
    for (const op of p.operators) lines.push(`    {${OP_FIELDS.map(f => `"${f.key}": ${op[f.key]}`).join(", ")}},`);
    lines.push(")", `sound.fm_patch(operators, algorithm=${p.algorithm}, feedback=${p.feedback}, channel=${p.channel})`,
      `sound.reserve((${p.note},), channel=${p.channel}, step_ms=1200, gate_ms=1000, tail_ms=300)`);
  } else {
    lines.push("", `sound.ssg_noise(${p.noisePeriod})`, `sound.ssg_envelope(${p.envelopePeriod}, ${p.shape})`,
      `sound.ssg_sound(${p.tone ? p.note : "None"}, channel=${p.channel}, volume=${p.ssgVolume}, tone=${bool(p.tone)}, noise=${bool(p.noise)}, envelope=${bool(p.envelope)})`,
      "sleep_ms(1000)", "sound.reset()");
  }
  return lines.join("\n") + "\n";
}
function pitchPairs(p: YmPatch): number[] {
  const hz = 440 * 2 ** ((p.note - 69) / 12);
  if (p.source === "fm") {
    for (let block = 0; block < 8; block++) {
      const fnum = Math.round(hz * 2 ** 21 / (4_000_000 / 72) / 2 ** block);
      if (fnum >= 1 && fnum <= 2047) return [0xA4 + p.channel, block << 3 | fnum >> 8, 0xA0 + p.channel, fnum & 255];
    }
  } else if (p.tone) {
    const period = Math.round(125_000 / hz); return [2 * p.channel, period & 255, 2 * p.channel + 1, period >> 8];
  }
  return [];
}
function packetsPython(packets: number[][]): string {
  return ["from machine import I2C, Pin", `_ym_bus = ${bus}`, ...packets.map(packet => `_ym_bus.writeto(0x44, bytes((${packet.join(", ")},)))`), "del _ym_bus", ""].join("\n");
}
/** A bounded audition goes through machine.I2C; no project library is installed. */
export function patchPreviewPython(p: YmPatch): string {
  const setup = patchSetupPairs(p);
  const events: number[] = [];
  const at = (ms: number, reg: number, value: number) => events.push(ms & 255, ms >> 8, reg, value);
  const pitch = pitchPairs(p);
  for (let i = 0; i < pitch.length; i += 2) at(0, pitch[i]!, pitch[i + 1]!);
  if (p.source === "fm") {
    at(0, 0x28, 0xF0 | p.channel); at(1000, 0x28, p.channel);
  } else {
    at(0, 8 + p.channel, p.envelope ? 16 : p.ssgVolume); at(1000, 8 + p.channel, 0);
  }
  return packetsPython([[3], [4, p.volume], [0, ...setup], [1, ...events], [2, 220, 5]]);
}
/** Held key, refreshed by the host only while the editor owns continuous audition. */
export function patchHeldPython(p: YmPatch, renew = false): string {
  validateYmPatch(p);
  const pitch = pitchPairs(p);
  const voice = p.source === "fm" ? [0x28, 0xF0 | p.channel] : [8 + p.channel, p.envelope ? 16 : p.ssgVolume];
  if (renew) {
    // Preserve key/envelope phase. A0/SSG volume is rewritten unchanged to renew the deadline.
    const pair = p.source === "fm" ? pitch.slice(-2) : voice;
    return packetsPython([[0, ...pair]]);
  }
  return packetsPython([[3], [4, p.volume], [0, ...patchSetupPairs(p)], [0, ...pitch, ...voice]]);
}
