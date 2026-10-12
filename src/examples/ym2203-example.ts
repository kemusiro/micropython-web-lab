/** Register-level reference retained for the standalone feasibility page. */
export const YM2203_REGISTER_EXAMPLE_SOURCE = `from machine import I2C, Pin
from time import sleep_ms

i2c = I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000)
ADDR = 0x44

# ド レ ミ ファ ソ ファ ミ レ ド（C4〜G4）
MELODY = (261.63, 293.66, 329.63, 349.23, 392.00,
          349.23, 329.63, 293.66, 261.63)
STEP_MS = 300
NOTE_MS = 250
DURATION_MS = 3000

def reg(r, v):
    i2c.writeto_mem(ADDR, r, bytes((v,)))

def fm_voice():
    # FMチャンネル1の音色。4オペレーター、アルゴリズム4。
    for slot, level in zip((0, 4, 8, 12), (40, 40, 20, 24)):
        reg(0x30 + slot, 1)
        reg(0x40 + slot, level)
        reg(0x50 + slot, 31)
        reg(0x60 + slot, 10)
        reg(0x70 + slot, 2)
        reg(0x80 + slot, 0x47)
    reg(0xB0, 4)

def reserve_melody(source):
    # 9音を予約。1イベント = 時刻low, 時刻high, レジスタ, 値。
    packet = bytearray((1,))
    def at(ms, r, v):
        packet.extend((ms & 255, ms >> 8, r, v))

    for n, hz in enumerate(MELODY):
        ms = n * STEP_MS
        if source == "FM":
            # 4 MHz、既定プリスケーラー、block 4。
            fnum = round(hz * (1 << 21) / (4_000_000 / 72) / 16)
            at(ms, 0xA4, (4 << 3) | (fnum >> 8))
            at(ms, 0xA0, fnum & 255)
            at(ms, 0x28, 0xF0)  # FMキーオン
            at(ms + NOTE_MS, 0x28, 0)  # FMキーオフ
        else:
            period = round(125_000 / hz)
            at(ms, 0x00, period & 255)
            at(ms, 0x01, period >> 8)
            at(ms, 0x08, 11)  # SSG Aの音量
            at(ms + NOTE_MS, 0x08, 0)  # SSG消音

    i2c.writeto(ADDR, packet)
    i2c.writeto(ADDR, bytes((2, DURATION_MS & 255, DURATION_MS >> 8)))

# 1. FMだけで演奏（SSGは初期化状態のまま消音）。
i2c.writeto(ADDR, b"\\x03")  # 発音停止・初期化
i2c.writeto(ADDR, bytes((4, 50)))  # 内蔵アンプ音量50%
fm_voice()
print("FMのみ: ドレミファソファミレド")
reserve_melody("FM")
sleep_ms(DURATION_MS + 200)  # FMの演奏終了を待つ

# 2. 初期化してFMの余韻を消し、SSGだけで同じ旋律を演奏。
i2c.writeto(ADDR, b"\\x03")
reg(0x07, 0x3E)  # SSG Aトーンのみ。B/Cとノイズは無効。
print("SSGのみ: ドレミファソファミレド")
reserve_melody("SSG")
sleep_ms(500)
print("Python終了後も、SSGの予約演奏は最後まで続きます")`;

/** The normal workspace installs the editable driver file alongside this sample. */
export const YM2203_EXAMPLE_SOURCE = `from machine import I2C, Pin
from time import sleep_ms
from web_lab_ym2203_v1 import YM2203

sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))
# MIDIノート番号: ド レ ミ ファ ソ ファ ミ レ ド
MELODY = (60, 62, 64, 65, 67, 65, 64, 62, 60)

sound.reset()
sound.volume(50)
sound.fm_tone("soft")  # "soft", "bright", "bell" から選択
print("FMのみ: ドレミファソファミレド")
duration = sound.reserve(MELODY, source="fm")
sleep_ms(duration + 200)

sound.reset()  # FMの余韻を消してSSGだけに切り替える
print("SSGのみ: ドレミファソファミレド")
sound.reserve(MELODY, source="ssg")
sleep_ms(500)
print("Python終了後も、SSGの予約演奏は最後まで続きます")`;

/** Original six-channel arrangement, separate from the FM/SSG comparison. */
export const YM2203_SCORE_EXAMPLE_SOURCE = `from machine import I2C, Pin
from time import sleep_ms
from web_lab_ym2203_score_v1 import YM2203

sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))
sound.reset()
sound.volume(35)
sound.fm_tone("soft", channel=0)
sound.fm_tone("bell", channel=1)
sound.fm_tone("soft", channel=2)

# 全トラックは同じ時刻から開始。MIDI番号、Noneは休符。
tracks = (
    {"source": "fm", "channel": 0,  # メロディ
     "notes": (72, 74, 76, 77, 79, 77, 76, 74, 72)},
    {"source": "fm", "channel": 1,  # ハーモニー
     "notes": (64, 69, 71, 64), "step_ms": 600, "gate_ms": 500},
    {"source": "fm", "channel": 2,  # 低音の伴奏
     "notes": (48, 53, 55, 48), "step_ms": 600, "gate_ms": 500},
    {"source": "ssg", "channel": 0,  # 分散和音
     "notes": (60, 64, 67, 64, 65, 69, 72, 69,
               67, 71, 74, 71, 60, 64, 67, 64),
     "step_ms": 150, "gate_ms": 120, "ssg_volume": 8},
    {"source": "ssg", "channel": 1,  # 短い拍のアクセント
     "notes": (72, None, 72, None) * 4,
     "step_ms": 150, "gate_ms": 60, "ssg_volume": 6},
    {"source": "ssg", "channel": 2,  # ベース
     "notes": (36, None, 41, None, 43, None, 36, None), "ssg_volume": 9},
)
print("FM＋SSG合奏: メロディ・伴奏・ベース（6ch）")
duration = sound.reserve_score(tracks)
print("予約演奏:", duration, "ms")
sleep_ms(500)
print("Python終了後も、6chの予約演奏は最後まで続きます")`;

/** Explicit patch settings, followed by shared SSG envelope/noise controls. */
export const YM2203_TONE_EXAMPLE_SOURCE = `from machine import I2C, Pin
from time import sleep_ms
from web_lab_ym2203_tone_v1 import YM2203

sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))
sound.reset()
sound.volume(30)

# OP1, OP2, OP3, OP4の順。省略した項目には既定値が入る。
# total_levelは大きいほど小さな音、multipleは周波数倍率。
operators = (
    {"multiple": 1, "total_level": 40, "attack": 31, "release": 8},
    {"multiple": 1, "total_level": 20, "attack": 31, "release": 8},
    {"multiple": 2, "total_level": 40, "attack": 31, "release": 8},
    {"multiple": 1, "total_level": 20, "attack": 31, "release": 8},
)
for algorithm, feedback in ((4, 0), (4, 5), (7, 0)):
    print("FM音色: algorithm =", algorithm, "feedback =", feedback)
    sound.fm_patch(operators, algorithm=algorithm, feedback=feedback)
    sound.fm_note(72)  # C5。接続とフィードバックの音の差を比較。
    sleep_ms(600)
    sound.fm_off()
    sleep_ms(100)

sound.reset()
print("SSG: トーン＋エンベロープ")
sound.ssg_envelope(period=5000, shape=10)  # 繰り返す下降・上昇
sound.ssg_sound(72, envelope=True)
sleep_ms(1200)
sound.ssg_off()

print("SSG: ノイズのみ")
sound.ssg_noise(period=12)  # ノイズ発生器は全SSGチャンネルで共通
sound.ssg_sound(tone=False, noise=True, volume=9)
sleep_ms(900)
sound.ssg_off()

print("SSG: トーン＋ノイズ")
sound.ssg_sound(60, tone=True, noise=True, volume=9)
sleep_ms(900)
sound.reset()
print("音色設定サンプル完了")`;
