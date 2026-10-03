# ADR 0025: 管理版UART0へGT-502MGG-N GPS機能モデルを接続する

- 状態: Accepted
- 日付: 2026-08-30
- 後続決定: ADR 0026で単調増加時計、衛星捕捉、1 Hz NMEA、ポーリング式PPSを追加

## 背景

秋月電子販売コード117980は、YIC `GT-502MGG-N`（MT3333搭載）の先バラ線GPS受信機である。実機は
UART 9600 bpsを既定とし、1 HzでNMEA 0183を出力し、別線に1PPSを出力する。Device API v1はUART peerを
表現できるため、外付けUARTデバイスの具体例として適している。

管理版Pico 2 WのUART0は、TX=GP0、RX=GP1を1 peerだけが排他的に利用する。従来は最小リファレンスの
UARTエコーデバイスが接続されており、GPSを同時接続することはConnection Model v1の規則に反する。
また、既存ブラウザ試験と利用者の作例は115200 bpsで`echo`を送受信する。

## 決定

管理版UART0の接続先を`gt-502mgg-n`へ置き換える。機能モデルは実機既定の9600 bpsで、固定UTC時刻を持つ
チェックサム付き`GNGGA`と`GNRMC`を同期的に生成する。画面から緯度、経度、高度を指定すると、共有入力の
版を介してDevice Modelへ値を渡し、次のUART読み取り前に新しいNMEAスナップショットを生成する。

既存サンプルの外部挙動を維持するため、115200 bpsだけは受信機へ書いたバイト列をそのまま返す互換モードと
する。この挙動は実機仕様ではなく移行用であり、UIでも「互換UART受信文字列」と明示する。UARTエコーの
リファレンス定義と単体テストはSDK検証用に残すが、管理版Connection Graphには接続しない。

初回モデルは次を対象外とする。

- 実時間タイマーによる1 Hzの連続出力
- PPS線と`machine.Pin`による1PPS観測
- GLL、GSA、GSV、VTGおよび複数GNSSトーカーの完全な再現
- PMTKコマンドによるボーレート、更新周期、出力文の変更
- 衛星軌道、捕捉時間、受信感度、測位誤差の物理シミュレーション

## 結果

- UART Device APIの同期契約だけで、MicroPythonからNMEA読み取りと解析を学習できる。
- UI状態、共有入力、Device Model、MicroPython UARTの境界を維持できる。
- UART0は引き続き1 peerであり、GPSと他のUARTデバイスを同時接続するには別Board Profileまたは配線変更が
  必要である。
- 115200 bps互換モードを将来廃止する場合は、既存作例の移行と非推奨期間を先に定義する必要がある。
- 1PPSを追加する場合は、UARTポートとは別の`gpio-driver`ポートと固定配線をDevice Manifest、Connection
  Model、UI、テストへ同時に追加する。

## 根拠資料

- [秋月電子 GT-502MGG-N（販売コード117980）](https://akizukidenshi.com/catalog/g/g117980/)
- [YIC GT-502GG / GT-502MGG Datasheet](https://akizukidenshi.com/goodsaffix/GT-502MGG.pdf)

## 関連文書

- `docs/connection-model-v1.md`
- `docs/device-api-v1.md`
- `docs/threat-model.md`
- `docs/adr/0018-generalize-synchronous-device-inputs.md`
- `docs/adr/0023-introduce-an-internal-connection-model.md`
