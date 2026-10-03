# ADR 0024: 複数ローカルデバイスのソースと配線をDevice package外で構成する

- 状態: Accepted
- 日付: 2026-08-30

## 背景

M11.4のローカル開発経路は、1個のDevice package directoryを受け取り、`local-device`としてI2C0へ自動接続
する。単一I2C targetの開発には使えるが、複数デバイス、GPIO、ADC、SPI、UART、PWMの配線を表現できない。
管理版はADR 0023で固定配線を`ConnectionGraphV1`へ移行したため、ローカル環境も同じ競合検査と実行時接続を
再利用できる。

Device packageのマニフェストへPico 2 W固有のピンや共同利用デバイスを記述すると、再利用性が失われる。
一方、内部Connection Graphへローカルpathを直接追加すると、コード出典、Device instance、配線、管理版の
信頼境界が混ざり、管理版成果物へ環境固有情報が入る危険がある。

## 検討した選択肢

### 1. CLIへ複数directoryを列挙し、ポートを自動接続する

短いコマンドで開始できるが、CSやGPIOを推測する必要があり、競合解決が非決定的になる。同一Device Definition
の複数instanceと再現可能な配線を表現しにくいため採用しない。

### 2. `device.json`へボード固有配線を追加する

1 packageだけなら分かりやすいが、Device ModelとBoard Profileの責任が混ざる。同じデバイスを別のピン、
別のボード、別の共同構成で利用しにくいため採用しない。

### 3. 内部`ConnectionGraphV1`へローカルpathを追加する

形式は1つになるが、ホストだけが扱うコード出典を純粋な接続モデルへ混入させる。管理版グラフのレビューと
配布境界も弱くなるため採用しない。

### 4. ローカル専用構成でsourceとinstanceを分け、内部グラフへ変換する

Device package、コード出典、instance、配線の責任を分離し、既存Device APIとConnection Modelを再利用できる。
追加の構成形式と移行管理が必要になるが、厳格な検証器とJSON Schemaを用意できるため採用する。

### 5. 管理版ブラウザからURLやnpm packageを動的importする

未承認コードを管理版オリジンで実行することになり、現在のレビュー済み静的ビルド境界を破るため採用しない。

## 決定

ローカル専用の`web-lab.local.json`を導入し、`sources`で検証対象のDevice package pathと期待ID・版、
`instances`でsource参照と全ポートの接続を宣言する。source pathは構成ファイル基準で解決する。初版はpath
sourceだけを扱い、リモート取得、環境変数、globを許可しない。

接続は内部`ConnectionGraphV1`へ変換し、管理版と同じBoard Profile、ポート整合、I2C address、SPI CS、GPIO、
ADC、UART、PWMの資源検査を行う。構成、全source、全接続が成功した場合だけ起動する。

基底プリセットは、現在の管理版構成を含む`pico-2-w-managed-v1`と、オンボードLEDだけを含む
`pico-2-w-board-only-v1`を明示的に選ぶ。これにより既存環境への追加試験と、既存BME280などとの競合を
避けた自由な配線試験を両立する。

新しい`dev:devices`と`check:devices`を複数構成の正規経路とする。旧`dev:device`は単一I2C targetを管理版へ
追加する構成への変換として維持し、既存サンプルを壊さない。

ローカル構成は管理版ビルド、公開Device SDK、ブラウザ保存形式へ含めない。Viteのローカル仮想モジュールは
Worker用definition bundleとmain thread用の安全なmetadataに分ける。開発サーバーはloopbackだけで公開する。
ローカルコードは信頼済みとはみなさず画面へ常時表示するが、安全なサンドボックスとも表示しない。

## 結果

- Device packageをボード固有配線から独立させたまま、複数の第三者Device Modelを同時に試験できる。
- 同じsourceから複数の独立instanceを生成できる。
- 管理版へのoverlayとboard-only構成を選び、資源競合を起動前に診断できる。
- Device API v1と管理版Connection Graphの公開範囲を変更しない。
- WorkerとUIの固定managed instance前提を除き、任意presetと空バスを扱えるようになった。
- 構成形式、CLI、JSON Schema、複数ポート統合テストという追加保守対象が生じる。
- ローカルコードのNode importとWorker実行は隔離ではなく、開発者が信頼できるコードだけを対象とする。

## 移行

初回実装では旧`dev:device`とローカルI2C統合テストを残し、その内部だけを単一instance構成への変換に
置き換えた。複数構成の正規経路は`dev:devices`とし、BME280相当I2C targetとSSD1331相当SPI target、
Worker再生成、管理版非混入を自動検証する。全ポートを同時利用する第三者fixtureはLocal Preview期間に
追加する。

Local Previewと第三者パイロット中はスキーマをStableな公開契約としない。破壊的変更が必要な場合は
`schemaVersion`を上げ、旧構成を黙って読み替えず、明示的な診断または変換手順を提供する。

## 関連文書

- `docs/local-device-configuration-v1.md`
- `docs/connection-model-v1.md`
- `docs/device-development.md`
- `docs/device-api-v1.md`
- `docs/threat-model.md`
- `docs/adr/0023-introduce-an-internal-connection-model.md`
