# OSTAMC5A31A-VV PWM RGB LEDデバイスモデル

## 対象

秋月電子通商の「抵抗内蔵5mm砲弾型フルカラーLED 3V〜15V用 カソードコモン」、型番
`OSTAMC5A31A-VV`、販売コード`117578`を、Device API v1の複数PWMサンプルとして実装する。

- [秋月電子 商品ページ](https://akizukidenshi.com/catalog/g/g117578/)
- [OptoSupply OSTAMC5A31A-VVデータシート](https://akizukidenshi.com/goodsaffix/OSTAMC5A31A-VV.pdf)

実物は赤、緑、青のLEDと各電流制限抵抗を5 mmパッケージへ内蔵したカソードコモン4端子LEDである。
データシートの端子は1=緑アノード、2=青アノード、3=共通カソード、4=赤アノードである。3〜15 Vに
対応し、9 V時の代表電流は赤7.5 mA、緑・青8.0 mAである。

## 固定配線

管理版Connection Graphは、既存GP16 PWMインジケーターを残したまま次のように接続する。

| LED端子 | Pico 2 W | 用途 |
| --- | --- | --- |
| 4: 赤アノード | GP18 PWM | 赤の明るさ |
| 1: 緑アノード | GP20 PWM | 緑の明るさ |
| 2: 青アノード | GP22 PWM | 青の明るさ |
| 3: 共通カソード | GND | 共通帰路 |

内蔵抵抗を前提とするため外付け抵抗は作例に含めない。Web Labは電気回路を計算しないため、3.3 V駆動時の
実電流、電圧降下、ピンの駆動能力を保証するものではない。

## Device APIとMicroPython作例

モデル`org.micropython-web-lab.ostamc5a31a-vv`は赤、緑、青の`pwm-observer`を1個ずつ提供する。
各ポートは正規化されたPWMの有効状態、反転、周波数、`dutyU16`を受け取る。カソードコモンなので通常は
active-highとし、有効なデューティ比を0〜255へ丸めて`#RRGGBB`を合成する。反転PWMではデューティ比を
反転してから色へ変換する。

UIは正確な`#RRGGBB`、各色の16-bitデューティ比、更新回数を表示する。視覚プレビューは既存の上限付き
`pixel-display`を1×1 RGB332として再利用するため、Canvas表示色には量子化が入る。Device ModelはDOM、
Canvas、CSSへ依存しない。

「OSTAMC5A31A-VV RGB LED」作例は`PWM(Pin(18))`、`PWM(Pin(20))`、`PWM(Pin(22))`を1 kHzで開き、
赤、緑、青、白を順番に表示した後、最終色`#ff40b4`を設定する。

## 意図的な制限

- PWM波形、立ち上がり、立ち下がり、ジッター、GPIO電圧、電流を再現しない。
- RGB各素子の光度差、波長、指向性、人間の知覚、ガンマ補正、個体差を色計算へ含めない。
- PWM sliceの共有周波数、位相、カウンター、周波数量子化を再現しない。
- LEDの発熱、最大損失、寿命、焼損、誤配線、共通カソードの未接続を再現しない。
- PWM周期ごとの状態通知は行わず、MicroPythonが設定を変更した時だけ状態を更新する。
