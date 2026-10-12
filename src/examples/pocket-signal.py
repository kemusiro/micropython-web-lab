# Pocket Signal / ポケット・シグナル — all 64 steps (11.52 s + 0.5 s tail).
# Music / instrument data: RetroFM Pocket, CC0-1.0.
# Generator adaptation: Copyright (c) 2026 Keitark, MIT License.
# Source: https://github.com/Keitark/RetroFM-Pocket
# Revision: 1a6f7e9ac0d8bd7ad0a52219a0700f981be9aebb
# Full MIT notice below travels with saved/exported copies of this sample.
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
from machine import I2C, Pin
from web_lab_ym2203_tone_v1 import YM2203

sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))

# 譜面は原曲のMIDI番号。1行が8音、1音ごとの間隔は180 ms。
MELODY = (
    69, 72, 76, 71, 74, 77, 72, 68,
    67, 71, 74, 78, 76, 72, 69, 64,
    65, 69, 72, 76, 74, 70, 67, 62,
    64, 68, 71, 74, 72, 69, 67, 71,
    81, 76, 72, 79, 74, 71, 77, 72,
    79, 74, 71, 76, 72, 69, 74, 67,
    77, 72, 69, 76, 70, 67, 74, 65,
    76, 71, 68, 74, 69, 67, 72, 69,
)
ROOTS = (45, 43, 41, 40, 45, 43, 41, 40)
CHORD_TONES = (52, 50, 48, 47, 52, 50, 48, 47)
STEP_MS = 180
GATE_MS = 150
TAIL_MS = 500
# Noneなら1回。24時間の繰り返しは 24 * 60 * 60 * 1000 を指定。
REPEAT_MS = None

# 元の周波数テーブルを保持（通常ドライバーの丸め直しを避ける）。
FNUMS = (617, 654, 693, 734, 778, 824, 873, 925, 980, 1038, 1100, 1165)
# 上流はレジスタ順0,4,8,12。fm_patchは論理OP順0,8,4,12。
MULTIPLIERS = ((1, 2, 3, 4), (1, 1, 2, 1), (1, 2, 2, 3))
LEVELS = ((8, 20, 30, 40), (12, 32, 40, 48), (18, 24, 36, 44))

sound.reset()
sound.volume(20)  # アプリの出力に合わせたアンプ調整。音色TLは原曲値。
sound.write_register(0x22, 0)
sound.write_register(0x27, 0)
sound.write_register(7, 0x3F)  # 原曲はFMのみ。SSGは消音。
for channel in range(3):
    operators = tuple({
        "multiple": MULTIPLIERS[channel][slot],
        "total_level": LEVELS[channel][slot],
        "attack": 31, "decay": 8, "sustain_rate": 4,
        "sustain_level": 2, "release": 6,
        "detune": 0, "key_scale": 0, "ssg_eg": 0,
    } for slot in (0, 2, 1, 3))
    sound.fm_patch(operators, algorithm=7, feedback=0, channel=channel)

# 一度に予約して音源側で演奏する。sleepの精度には依存しない。
events = []
def at(ms, register, value):
    events.append((ms, register, value))

for step, lead in enumerate(MELODY):
    ms = step * STEP_MS
    phrase = step // 8
    for channel in range(3):
        at(ms, 0x28, channel)
    notes = (lead, ROOTS[phrase],
             CHORD_TONES[phrase] + (7 if step % 4 >= 2 else 0))
    for channel, note in enumerate(notes):
        block = note // 12 - 1
        fnum = FNUMS[note % 12]
        at(ms, 0xA4 + channel, (block << 3) | (fnum >> 8))
        at(ms, 0xA0 + channel, fnum & 255)
        at(ms, 0x28, 0xF0 | channel)
    for channel in range(3):
        at(ms + GATE_MS, 0x28, channel)

period = len(MELODY) * STEP_MS + TAIL_MS
duration = period if REPEAT_MS is None else REPEAT_MS
if type(duration) is not int or not period <= duration <= 0xFFFFFFFF or len(events) > 131071:
    raise ValueError("Song exceeds the module reservation limits")
for start in range(0, len(events), 63):
    packet = bytearray((1,))
    for ms, register, value in events[start:start + 63]:
        packet.extend((ms & 255, ms >> 8, register, value))
    sound.i2c.writeto(sound.address, packet)
def u32(value):
    return bytes((value & 255, (value >> 8) & 255, (value >> 16) & 255, value >> 24))
packet = b"\x06" + u32(duration)
if REPEAT_MS is not None:
    packet += u32(period)
sound.i2c.writeto(sound.address, packet)
print("Pocket Signal / ポケット・シグナル（全曲・FM 3ch）")
print("RetroFM Pocket · CC0-1.0 · 予約演奏:", duration, "ms")
