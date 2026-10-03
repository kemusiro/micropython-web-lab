# Device API v1 ローカル開発ガイド

## 現在の位置付け

このガイドはリポジトリに同梱するローカルDevice開発機能を対象とする。SDKと適合テストキットは
MIT Licenseだが、`private: true`を維持しており、まだnpmでは配布していない。予定パッケージ名は
`@micropython-web-lab/device-api`と`@micropython-web-lab/device-testkit`である。npm Organizationは
Public Previewのリリース作業まで作成せず、公開時に名前の利用可否を再確認する。

初版の仮想ボードはRaspberry Pi Pico 2 Wである。適合テストキットはGPIO observer/driver、ADC、I2C、
SPI、UART、PWMの7ポート契約をDOMなしで検査する。単一I2C targetの互換経路に加え、複数デバイスと
全ポートの接続先を指定するLocal Device Configuration v1をLocal Previewとして実装している。
管理版の承認済み固定デバイスとローカル未承認デバイスは、別々のsource情報から内部Connection Modelへ
変換する。ローカルpathを管理版グラフや通常buildへ保存しないことで、信頼境界を維持する。

## テンプレートの構成

`templates/device/i2c-register`には次を含む。

- `device.json`: Device API v1マニフェスト
- `src/device.ts`: DOMやUIフレームワークに依存しない同期Device Model
- `tests/device.test.ts`: 適合テストとモデル単体テスト
- `examples/main.py`: MicroPython側の実行例
- `LICENSE`: テンプレートへ適用するMIT License

リポジトリの固定Node.js環境で、SDK、テストキット、テンプレート、マニフェスト、モデル、Python作例を
まとめて検証する。

```sh
./scripts/use-node.sh pnpm verify:device-template
```

別ディレクトリのデバイスは、先にデバイス自身のTypeScriptをJavaScriptへビルドしてから検査する。

```sh
./scripts/use-node.sh pnpm build:sdk
./scripts/use-node.sh pnpm check:device -- ../my-device
```

検査は未知マニフェスト項目、Pico 2 W能力、宣言と実装のポート、同期API、状態と転送の上限、実行時依存、
禁止APIの単純な静的検査、`machine`を使うPython作例を確認する。静的検査は難読化や間接参照を完全には
検出せず、セキュリティサンドボックスではない。

## 時間依存モデルのテスト

`DeviceContext.clock`は省略可能な単調増加時計であり、Web LabのDevice Hostは常に提供する。周期センサーや
捕捉待ちを実装する場合は、壁時計や`setInterval()`をモデルから直接使わず、ポート操作またはActionの同期
境界で`context.clock?.monotonicMilliseconds()`を読む。時計がない旧ホストでは安全な静止状態を返す。

適合テストキットの`ManualDeviceClock`は、テストを待機させず決定論的に時間を進められる。

```ts
const clock = new ManualDeviceClock();
const context = { /* instanceId、board、limits、emitState */ clock };
const model = definition.create(context);
clock.advance(1_000);
```

長時間アクセスされなかった周期出力は無制限にキューへ蓄積せず、最新状態の採用、上限付き蓄積、または
明示的な取りこぼしカウンターのいずれかを仕様化する。

## Web Labでの実行

テンプレートをビルドした後、次を実行する。

```sh
./scripts/use-node.sh pnpm dev:device -- templates/device/i2c-register
```

このコマンドは最初に`check:device`を実行し、成功したエントリポイントだけをViteの仮想モジュールとして
Dedicated Workerへ組み込む。デバイスパスは子プロセスの環境変数にだけ渡し、設定ファイルへ保存しない。
通常の`pnpm build`では仮想モジュールが常に空となり、ローカルコードとパスは成果物へ入らない。

ローカル画面には「ローカル開発モード · 未承認デバイス」とID、名称を常時表示する。I2Cテンプレートは
`0x48`、管理版のリファレンスデバイスは`0x50`として同時に利用できる。

## 複数デバイス構成（Local Preview）

複数の第三者Device packageを同時に読み込み、GPIO、ADC、I2C、SPI、UART、PWMへ配線する正規経路として、
`web-lab.local.json`と`check:devices`／`dev:devices`を使用する。Device packageにはボード固有配線を
持たせず、ローカル構成がsource path、期待Device ID・版、instance、全ポート接続を宣言する。

管理版プリセットへ追加するモードと、Pico 2 Wのオンボード機能だけから開始するモードを分ける。全sourceと
合成Connection Graphが起動前検査を通過した場合だけ開発サーバーを起動し、部分的な構成では実行しない。
形式、検証順序、CLI、UI、信頼境界、移行方法は`docs/local-device-configuration-v1.md`を正とし、判断は
`docs/adr/0024-configure-multiple-local-devices-outside-device-packages.md`を参照する。

リポジトリ同梱のBME280相当I2C targetとSSD1331相当SPI targetを同時に検査・実行する例は次のとおりである。

```sh
./scripts/use-node.sh pnpm check:devices -- fixtures/local-devices/bme280-ssd1331/web-lab.local.json
./scripts/use-node.sh pnpm dev:devices -- fixtures/local-devices/bme280-ssd1331/web-lab.local.json
```

開発サーバーはloopbackだけで待ち受ける。構成、source、期待ID・版、全ポート、Board Profile、資源競合の
いずれかが不正な場合は、Viteを起動せず構成全体を拒否する。構成ファイルのJSON Schemaは
`schemas/local-device-configuration-v1.schema.json`にある。

## 信頼境界

`dev:device`はデバイス側の`install`、`prepare`などのパッケージスクリプトを実行せず、実行時依存も許可
しない。一方、適合検査はビルド済みエントリポイントをNode.jsへimportし、ローカル実行は同じコードを
ブラウザWorkerへ組み込む。このため、出所不明のデバイスを安全に試す仕組みではない。取得元とコードを
確認できる、自分が信頼するデバイスだけに実行する。

管理版はこのローカル経路を使用せず、固定カタログとPull Requestレビューを通したデバイスだけを
静的に組み込む。
