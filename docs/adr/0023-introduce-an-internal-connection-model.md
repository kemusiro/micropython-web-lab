# ADR 0023: 固定配線を内部Connection Modelへ移行する

- 状態: Accepted
- 日付: 2026-08-30

## 背景

Device API v1はデバイスが提供する論理ポートを定義するが、ポートをPico 2 WのどのGPIOやバスへ接続するかは
Device Modelの責任ではない。M11.4までの管理版は、Device Model生成、I2C接続、SPI選択、GPIO転送を
Workerへ個別に記述していた。この方式では複数デバイスの配線を一覧化、保存、競合検査できず、追加のたびに
専用分岐が増える。

BME280とSSD1331を同時利用する例では、I2C信号の共有とアドレス排他、SPI信号の共有と固有CS、D/C、RESET
GPIOを一つの構成として検証する必要がある。

## 決定

ホスト内部に版付き`ConnectionGraphV1`を追加し、管理版の全固定Deviceインスタンスとポート割り当てを
単一プリセットへ移す。接続検証はDevice Model生成前に行い、Device ID・版・全ポート、Board Profile、
エンドポイント種別、ピン、I2Cアドレス、SPI CS、資源競合を確認する。

I2CとSPIのcontroller信号ピンは同じcontroller内で共有する。I2Cアドレス、SPI CS、一般GPIO、ADC、PWM、
UARTは規則に従って排他制御する。SPIは複数ターゲットを持つ仮想バスとし、選択中のCSに対応するターゲット
だけへ転送する。同時選択はエラーにし、従来のCSなしSPIレジスタは1個のfallbackとして互換維持する。

管理版UIへ、同じグラフから生成する読み取り専用の接続一覧を追加する。Connection Modelはまだ
`@micropython-web-lab/device-api`へ含めず、ブラウザのプロジェクト保存形式も変更しない。編集可能な配線と
永続化は、利用不能なデバイス・ボードを含む移行方法を設計してから別段階で追加する。

ローカル未承認デバイスのM11.4 I2C0自動接続は、Managed Catalogの資源割当が完成するまで既存経路を保つ。
ローカルコードやパスを管理版Connection Graphへ追加しない。

## 結果

- Device APIの論理ポートとPico 2 W固有配線を分離したまま、複数デバイス構成を表現できる。
- 管理版の全固定配線を1か所でレビューでき、WorkerのSSD1331ピン分岐とI2C個別接続を削除できる。
- BME280とSSD1331を同一プログラムで利用し、測定結果をOLEDへ表示できる。
- I2C共有、SPI CS選択、GPIO競合をDevice Model生成前に検出できる。
- 現段階のUIは確認用であり、利用者が配線を変更できるとは表示しない。
- 将来の編集・保存では別の永続データ移行が必要になる。

## 関連文書

- `docs/connection-model-v1.md`
- `docs/device-api-v1.md`
- `docs/device-development.md`
- `docs/architecture.md`
- `docs/threat-model.md`
- `docs/adr/0017-introduce-the-pico-2-w-board-profile.md`
