# ADR 0027: 管理版へ3チャンネルPWM RGB LEDを追加する

- 状態: Accepted
- 日付: 2026-08-30

## 背景

管理版にはGP16へ接続した単一PWMインジケーターがあり、PWMの周波数とデューティ比を確認できる。一方、
実際の複合デバイスで複数PWMを同時に扱う例はない。秋月電子販売コード117578の`OSTAMC5A31A-VV`は、
赤、緑、青と3個の抵抗を内蔵したカソードコモンRGB LEDであり、3系統のPWMを学ぶ例に適している。

既存のGP16作例とUIは外部挙動として維持する必要がある。表示のために任意Canvas APIをDevice Modelへ
公開したり、新しい公開Device UI部品を導入したりすることも避ける。

## 決定

`ostamc5a31a-vv`を既存PWMインジケーターとは別の管理版Device instanceとして追加し、赤、緑、青の
`pwm-observer`をGP18、GP20、GP22へ接続する。共通カソードはGNDとし、active-highの有効デューティ比を
8-bit RGBへ線形変換する。正確な合成値は`colorHex`、プレビューは既存内部`pixel-display`の1×1 RGB332を
使う。既存GP16のDefinition、Connection、UI、E2Eは変更しない。

モデルはPWM設定変更だけを処理し、PWM周期ごとのイベントを生成しない。電流、電圧、波形、光度差、
ガンマ補正、PWM slice共有は機能レベルモデルの対象外とする。

## 結果

- 既存PWMサンプルを壊さず、3チャンネルの色合成をMicroPythonから学習できる。
- Device API v1、Device UI v1、Connection Graph v1の形式を変更しない。
- GP18、GP20、GP22は管理版でRGB LEDが占有し、他のデバイスを同じPWMピンへ接続できない。
- 将来PWM slice共有を再現する場合は、Board Profileと`machine.PWM`の周波数競合を同時に設計する必要がある。

## 関連文書

- `docs/device-api-v1.md`
- `docs/connection-model-v1.md`
- `docs/devices/ostamc5a31a-vv.md`
- `docs/threat-model.md`
- `docs/adr/0016-define-a-curated-public-device-api.md`
- `docs/adr/0023-introduce-an-internal-connection-model.md`
