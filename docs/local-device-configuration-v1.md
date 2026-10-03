# Local Device Configuration v1 設計

- 状態: Implemented Local Preview
- スキーマ版: `1`
- 対象: ローカル開発モード
- 対象ボード: `raspberry-pi-pico-2-w-v1@1`

## 1. 目的

複数の未承認Device API実装を、開発者のローカル環境だけで同時に読み込み、各インスタンスの論理ポートを
Pico 2 WのGPIO、ADC、I2C、SPI、UART、PWMへ明示的に接続できるようにする。

この構成は次を満たす。

- Device Definitionのパッケージと、ボード固有の配線を分離する。
- 同じDevice Definitionから独立した複数インスタンスを生成できる。
- 管理版プリセットを残した追加試験と、オンボード機能だけの空に近いボードからの試験を選べる。
- すべてのソース、マニフェスト、配線、資源競合を検証してからViteとWorkerを起動する。
- ローカルコード、絶対パス、構成内容を管理版成果物やブラウザ保存形式へ混入させない。
- Device API v1と管理版`ConnectionGraphV1`を破壊的に変更しない。

初版では、ブラウザ上の配線編集、動的な抜き差し、URL・npm・Gitからの取得、未信頼コードの隔離実行を
扱わない。

## 2. ファイルとコマンド

ローカル構成の既定ファイル名を`web-lab.local.json`とする。任意の場所に置けるが、ソースの相対パスは
構成ファイルがあるディレクトリを基準に解決する。

使用するコマンドは次のとおりである。

```sh
./scripts/use-node.sh pnpm check:devices -- ./web-lab.local.json
./scripts/use-node.sh pnpm dev:devices -- ./web-lab.local.json
```

`check:devices`はブラウザを起動せず、全Device packageの既存`check:device`相当検査と、合成した接続グラフの
検査を行う。`dev:devices`も同じ検査を先に行い、全件成功した場合だけloopback上で開発サーバーを起動する。

既存の次のコマンドは互換経路として維持する。

```sh
./scripts/use-node.sh pnpm dev:device -- ./my-device
```

これは管理版プリセットへ`instanceId: "local-device"`の単一I2C targetを追加するメモリ上の構成へ変換する。
I2C以外または複数インスタンスを使う場合は`dev:devices`を案内する。既存のI2Cテンプレートと作例は変更せず
実行できる。

## 3. 構成形式

構成は、ボード、基底プリセット、Device source、Device instanceを分けて保持する。BME280とSSD1331を
第三者パッケージとして同時試験する例を示す。

```json
{
  "schemaVersion": 1,
  "boardProfile": {
    "id": "raspberry-pi-pico-2-w-v1",
    "version": 1
  },
  "basePreset": "pico-2-w-board-only-v1",
  "sources": [
    {
      "sourceId": "bme280-development",
      "source": {
        "kind": "path",
        "directory": "../devices/ae-bme280"
      },
      "expected": {
        "deviceId": "org.example.ae-bme280",
        "deviceVersion": "0.1.0"
      }
    },
    {
      "sourceId": "ssd1331-development",
      "source": {
        "kind": "path",
        "directory": "../devices/qt095b-ssd1331"
      },
      "expected": {
        "deviceId": "org.example.qt095b-ssd1331",
        "deviceVersion": "0.1.0"
      }
    }
  ],
  "instances": [
    {
      "instanceId": "environment-sensor",
      "sourceId": "bme280-development",
      "ports": [
        {
          "portId": "i2c",
          "endpoint": {
            "kind": "i2c",
            "controller": 0,
            "address": 118
          }
        }
      ]
    },
    {
      "instanceId": "environment-display",
      "sourceId": "ssd1331-development",
      "ports": [
        {
          "portId": "spi",
          "endpoint": {
            "kind": "spi",
            "controller": 0,
            "selectPort": "cs",
            "activeLevel": 0
          }
        },
        {
          "portId": "cs",
          "endpoint": { "kind": "gpio", "pin": "GP5" }
        },
        {
          "portId": "dc",
          "endpoint": { "kind": "gpio", "pin": "GP2" }
        },
        {
          "portId": "reset",
          "endpoint": { "kind": "gpio", "pin": "GP3" }
        }
      ]
    }
  ]
}
```

### 3.1 基底プリセット

初版は次の2値だけを受け付ける。

| 値 | 内容 | 用途 |
| --- | --- | --- |
| `pico-2-w-managed-v1` | 現在の管理版固定デバイスをすべて含む | 既存環境へ1個以上のデバイスを追加する互換試験 |
| `pico-2-w-board-only-v1` | Pico 2 WのオンボードLEDだけを含む | 外付けピンとバスを自由に割り当てる複数デバイス試験 |

プリセットは暗黙の既定値にせず必須とする。ただし旧`dev:device`互換経路だけは
`pico-2-w-managed-v1`を選ぶ。将来プリセットの内容を変更する場合は別IDを追加し、既存IDの意味を
書き換えない。

`board-only`では、接続先のないI2CとSPIは空のバス、UARTは受信データなし、GPIO/PWM出力は観測者なし
として安全に動作する。接続先がないことだけを理由に`machine` APIの生成を失敗させない。

### 3.2 Device source

`sources`はパッケージの読み込み元を表し、`instances`はそのパッケージから生成する独立したDevice Modelを
表す。1つのsourceを複数instanceから参照できる。ホストはinstanceごとに`create(context)`を1回呼び、
異なる`instanceId`と独立したライフサイクルを与える。

初版のsourceは`kind: "path"`だけとする。`directory`はDevice packageの`device.json`があるディレクトリで
あり、環境変数展開、`~`、glob、URL、npm package名、Git参照を受け付けない。シンボリックリンクを含めて
`realpath`で確定し、entrypointがそのディレクトリ内にあることを確認する。

`expected.deviceId`と`expected.deviceVersion`は必須とし、実際の`device.json`およびdefault exportの
マニフェストと完全一致させる。ローカル開発では成果物ハッシュを固定しないが、パスの取り違えや意図しない
版変更は起動前に検出する。

### 3.3 Device instanceとポート

`instanceId`は構成全体と基底プリセット内で一意にする。各instanceは参照先マニフェストが宣言する全ポートを
ちょうど1回接続し、未知のポートと未接続ポートを許可しない。endpointの意味は内部Connection Model v1と
同じである。

| endpoint | 必須情報 | 主な競合規則 |
| --- | --- | --- |
| `gpio` | `pin` | GPIOを排他的に使用する |
| `adc` | ADC対応`pin` | GPIOとADC channelを排他的に使用する |
| `i2c` | `controller`、7-bit `address` | 信号線を共有し、controller内のaddressを排他にする |
| `spi` | `controller`、`selectPort`、`activeLevel` | 信号線を共有し、CS用GPIOを排他にする |
| `uart` | `controller` | 初版はcontrollerごとに1 peerとする |
| `pwm` | `pin` | GPIOを排他的に使用する |

ローカルinstanceにSPI fallbackは公開しない。fallbackは従来の管理版SPIレジスタ互換だけに限定する。
`selectPort`は同じinstanceの`gpio-observer`を参照しなければならない。

I2C endpointのaddressは、生成した`I2cTargetPort.addresses`の唯一の値に一致させる。Device Manifestが
`defaultAddress`を宣言する場合は、その値にも一致させる。初版のConnection Modelは1ポート1アドレスである。
複数アドレスを持つデバイスはアドレスごとに別ポートを宣言する。配線だけでDevice Modelの内部アドレスを
変更する機能はDevice API v1へ追加しない。

### 3.4 上限

構成テキストはUTF-8で最大256 KiB、sourceは最大32件、instanceは基底プリセットと合わせて最大64件、
1 instanceのポートは最大32件とする。識別子、Semantic Versioning、ピン、アドレスなどは既存Device
ManifestとConnection Modelの検証規則を再利用する。未知フィールドは無視せず拒否する。

## 4. 読み込みと検証フロー

```text
web-lab.local.json
        │ strict parse / size / paths
        ▼
unique Device sources ── check:device相当 ── manifest + entrypoint
        │
        ▼
instances + base preset
        │ generate effective ConnectionGraphV1
        ▼
Board Profile resolution / capability / resource conflict validation
        │ all-or-nothing
        ▼
Vite virtual modules
        ├─ main thread: safe local metadata + connection overview
        └─ Worker: Device Definitions + effective graph
                           │ validate again
                           ▼
                    DeviceHost.create()
```

検証順序は次のとおりとする。

1. 構成のサイズ、JSON構造、版、未知フィールド、件数上限を検査する。
2. source pathを構成ファイル基準で解決し、重複source ID、実体、entrypoint境界を検査する。
3. unique sourceごとにDevice Manifest、依存禁止、ソース禁止API、適合テストを検査する。
4. expected ID・版と、ファイルおよびexportされたマニフェストを照合する。
5. base presetとinstanceから有効なDevice Definition mapと`ConnectionGraphV1`を生成する。
6. Board Profile能力、全ポート、endpoint種別、ピン、バス、アドレス、CS、資源競合を解決する。
7. 全件成功した場合だけViteを起動する。1件でも失敗した場合は部分構成で起動しない。
8. WorkerでもDevice Model生成前にID・版と接続グラフを再検証する。

同一sourceを複数instanceが参照する場合、source検査とモジュールimportは1回、`create(context)`はinstanceごとに
行う。instanceとポートの順序は構成ファイルの順序を維持し、エラーとUI表示を再現可能にする。

## 5. 実行時構成

Viteは次の2種類の仮想モジュールを生成する。

- Worker用: 検証済みentrypointの静的import、instanceとsourceの対応、有効な接続グラフ
- main thread用: instance ID、表示名、Device ID・版、ローカル／管理版の区分、接続一覧だけ

main threadへDevice DefinitionやローカルJavaScriptをimportしない。ローカル絶対パスは画面、ブラウザ保存、
Workerメッセージへ渡さない。Vite開発サーバー内部ではローカルモジュールを配信するため、開発サーバーは
loopbackだけで待ち受け、ネットワーク公開オプションを初版では受け付けない。

Workerは基底プリセットを前提とする固定instance参照を持たないようにする。ボタン、ADC、BME280などの
管理版共有入力アダプターは、該当instanceが有効な場合だけ登録する。空のI2C/SPI/UART/PWM接続にも対応する。

Device Model生成中に例外が発生した場合は、既に生成したモデルを逆順で`dispose()`し、MicroPythonを起動せず
構成エラーを表示する。ソフトリセットは全モデルの`reset()`、Worker再生成は同じ検証済み構成から全モデルを
再生成する。構成ファイル、マニフェスト、ポート構造の変更は開発サーバー再起動を必要とし、初版ではhot plug
または接続グラフのHMRを行わない。

## 6. UIと診断

ローカル画面は「ローカル開発モード・未承認コード」を常時表示し、source数とinstance数を示す。接続一覧は
管理版とローカルを区別し、各instanceについて表示名、Device ID・版、source ID、解決済みピン・バスを
読み取り専用で表示する。絶対パスは表示しない。

構成エラーは最低限、次の区分とJSON pathまたはinstance／portを示す。

- `LOCAL_CONFIG_INVALID`: 構造、版、上限、未知フィールド
- `LOCAL_SOURCE_INVALID`: path、manifest、entrypoint、期待ID・版、適合検査
- `LOCAL_CONNECTION_INVALID`: 未接続ポート、種別、未対応ピン・バス
- `LOCAL_RESOURCE_CONFLICT`: GPIO、I2C address、SPI CS、UARTなどの競合と双方のowner
- `LOCAL_DEVICE_CREATE_FAILED`: Device Model生成時の例外

CLIは起動前エラーを標準エラーへ出して非0終了する。Workerで再検出したエラーは、端末文字列へ混ぜず版付き
制御メッセージでmain threadへ送り、MicroPythonを実行可能と表示しない。

第三者向けDevice UIは本設計に含めない。初版のローカル複数構成では、安全なマニフェスト情報、接続一覧、
Device API v1の状態診断を提供し、任意HTML・CSS・Canvas・イベント処理を読み込まない。

## 7. 信頼境界

ローカル複数構成はセキュリティサンドボックスではない。`check:devices`は各entrypointをNode.jsへimportし、
ブラウザ実行では同じコードをDedicated Workerへ組み込む。静的禁止語検査は難読化、間接参照、ビルド済み
コードの悪意ある処理を完全には防げない。開発者が内容と取得元を確認できるコードだけを対象とする。

- package managerのinstall、prepare、postinstallなどを実行しない。
- runtime dependencyを許可しない。
- sourceは明示したローカルディレクトリだけとし、リモート取得しない。
- Viteのfilesystem allowlistは検証済みsource directoryだけへ広げる。
- 通常の`pnpm build`ではローカル仮想モジュールを空にし、ローカルID、パス、コードの混入を検査する。
- 管理版オリジンはこの構成を読み込まず、ブラウザから任意パスやURLを指定できない。
- Device State、転送量、instance数、Worker実行時間、出力量の既存上限を維持する。

`web-lab.local.json`は秘密情報を持つ形式ではない。トークン、認証情報、ネットワーク接続先、環境変数展開を
追加しない。共有する場合は相対pathとexpected ID・版だけを用いる。

## 8. 検証状況と追加テスト

現在の自動検証は、構成形式、プリセット合成、期待ID・版不一致、管理版との資源競合、通常buildへの
非混入、旧単一I2C経路を対象とする。BME280相当I2C targetとSSD1331相当SPI targetの同時実行、再起動後の
配線復元、未承認表示と接続一覧はブラウザ統合テストで確認する。

次の項目はLocal Preview期間に追加する検証候補であり、未実施項目をStable機能とは扱わない。

### 構成検証

- 正常な複数source、同一sourceの複数instance、2つのbase preset
- 未知フィールド、上限超過、重複ID、不正path、entrypoint逸脱、期待ID・版不一致
- 未接続・未知・重複ポート、endpoint種別不一致、Board Profile能力不足
- GPIO競合、I2C address競合、SPI CS競合・不正参照、UART重複

### 実行時統合

- BME280相当I2C targetとSSD1331相当SPI targetを同一ローカル構成で実行する。
- 同一I2C busの異なるaddressと、同一SPI busの異なるCSを同時利用する。
- GPIO、ADC、UART、PWMを含む2個以上の第三者Device Modelを同時利用する。
- 停止、ソフトリセット、完全リセット、Worker自動再生成後に同じ接続が復元される。
- 生成途中の例外で部分的なDevice Modelが残らない。
- 旧`dev:device` I2Cテンプレートが従来どおり動作する。

### 配布境界

- 管理版buildにローカルentrypoint、絶対path、local ID、構成ファイル内容が含まれない。
- main thread bundleへDevice Definitionが入らない。
- loopback以外でローカル開発サーバーを起動できない。

## 9. 実装状況

1. Local Device ConfigurationのTypeScript型、厳格な検証器、JSON Schema、構成単体テストを追加した。
2. `check:devices`と`dev:devices`を追加し、unique source検査と有効接続グラフ生成を実装した。
3. Vite仮想モジュールを複数definitionと安全なmetadataに分け、Workerを任意preset対応へ変更した。
4. 全Device APIポートを`ConnectedDeviceRuntime`経由で接続し、空バスと生成失敗のcleanupを実装した。
5. ローカル接続一覧、構造化診断、BME280＋SSD1331相当fixtureとブラウザ統合テストを追加した。全ポートを
   同時に使う第三者fixtureはLocal Preview期間の追加検証とする。
6. 旧`dev:device`を互換変換へ移し、READMEと開発ガイドを更新した。

Public Preview前に最低1件の外部Device implementationをこの構成で試し、形式を確定する。確定前は
Local Previewと表示し、公開Device SDKやブラウザのプロジェクト保存形式として互換性を保証しない。

## 10. 対象外と将来拡張

- ブラウザ上の配線編集とプロジェクト保存
- Device packageのnpm、Git、URL解決と自動取得
- 未承認コードを管理版で実行する機能
- 動的な追加・削除、hot plug、接続グラフHMR
- 第三者向け任意Device UIまたは高帯域表示Renderer
- 電源、GND、電圧、プル抵抗、波形、配線長、電気的誤配線
- 複数Board Profile、I2C1、SPI1、UART1、SoftI2C、SoftSPI
- 配線値からDevice Modelの内部設定やI2C addressを変更する汎用parameter API

これらはDevice API、Board Profile API、永続データ、コード隔離の各版と独立して判断する。
