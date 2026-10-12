/** Project-authored sequences; no external music is embedded. */
export type YmSampleKind = "comparison" | "mml" | "bin" | "score" | "tone" | "pocket-signal";
export const YM2203_MML_EXAMPLE_SOURCE = `from machine import I2C, Pin
from web_lab_ym2203_mml_v1 import YM2203

sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))
sound.reset()
sound.volume(35)
sound.fm_tone("soft")
# C4 = o4c。l4は四分音符、rは休符、q7は音符長の7/8を発音。
tracks = (
    {"source": "fm", "channel": 0, "mml": "t120 o4 l4 q7 c d e f g f e d c2"},
    {"source": "ssg", "channel": 0, "ssg_volume": 8,
     "mml": "t120 o3 l8 q6 c e g e f a >c< a g b >d< b c e g e c2"},
)
# Noneは1回。24時間繰り返す場合は24 * 60 * 60 * 1000。
REPEAT_MS = None
duration = sound.reserve_mml(tracks, repeat_ms=REPEAT_MS)
print("MML予約演奏:", duration, "ms")
# Python終了後も音源側で演奏。画面の停止ボタンで中断できます。
`;
export const YM2203_BIN_EXAMPLE_SOURCE = `from machine import I2C, Pin
from web_lab_ym2203_v1 import YM2203
from web_lab_ym2203_bin_v1 import YM2203BinPlayer

sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))
player = YM2203BinPlayer(sound)
# 同梱のオリジナル発声データ。取り込んだ楽曲のパスに変更できます。
DATA_FILE = "samples/ym2203-demo.bin"
REPEAT_MS = None  # 24時間: 24 * 60 * 60 * 1000
print("BIN情報:", player.inspect(DATA_FILE))
duration = player.play(DATA_FILE, repeat_ms=REPEAT_MS, volume=30)
print("BIN予約演奏:", duration, "ms")
# 任意の時点でplayer.stop()、または画面の停止ボタンで中断。
`;
export const YM2203_DEMO_BIN_PATH = "samples/ym2203-demo.bin";
/** WYM1 contains all patch and note writes needed after a chip reset. */
export function ym2203DemoBin(): Uint8Array {
  const events: [number, number, number][] = [];
  const add = (ms: number, reg: number, value: number) => events.push([ms, reg, value]);
  for (const [index, slot] of [0, 4, 8, 12].entries()) {
    for (const [reg, value] of [[0x30, 1], [0x40, [40, 40, 20, 24][index]!], [0x50, 31], [0x60, 10], [0x70, 2], [0x80, 0x47]]) add(0, reg! + slot, value!);
  }
  add(0, 0xB0, 4); add(0, 7, 0x3E);
  for (const [index, note] of [60, 62, 64, 65, 67, 65, 64, 62, 60].entries()) {
    const hz = 440 * 2 ** ((note - 69) / 12);
    const fnum = Math.round(hz * 2 ** 21 / (4_000_000 / 72) / 16);
    const period = Math.round(125_000 / hz), ms = index * 300;
    add(ms, 0xA4, 32 | fnum >> 8); add(ms, 0xA0, fnum & 255); add(ms, 0x28, 0xF0);
    add(ms, 0, period & 255); add(ms, 1, period >> 8); add(ms, 8, 8);
    add(ms + 250, 0x28, 0); add(ms + 250, 8, 0);
  }
  const bytes = new Uint8Array(16 + events.length * 6);
  bytes.set([87, 89, 77, 49]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, events.length, true); view.setUint32(8, 3000, true); view.setUint32(12, 4_000_000, true);
  events.forEach(([ms, reg, value], i) => { view.setUint32(16 + i * 6, ms, true); bytes[20 + i * 6] = reg; bytes[21 + i * 6] = value; });
  return bytes;
}
