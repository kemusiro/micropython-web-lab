# アーキテクチャ

## 目的と範囲

MicroPython Web Labは、利用者が入力したMicroPythonコードをブラウザ内で実行し、Raspberry Pi Pico 2 Wと
外付けデバイスの機能レベルの動作を試せる静的Webアプリケーションである。命令単位、クロック単位、
電気特性を再現するエミュレーターではない。

実行基盤、UI、仮想ボード、Device Model、接続設定を分離し、応答しない利用者コードから画面を復旧できる
ことを設計の中心に置く。信頼境界と既知の制約は[脅威モデル](threat-model.md)を参照する。

## 全体構成

```text
browser main thread
├─ editor / REPL / debugger UI
├─ connection editor / device panels
├─ project storage
├─ RuntimeClient
│    ├─ versioned control messages
│    ├─ execution and output limits
│    └─ Worker lifecycle
└─ bounded SharedArrayBuffer inputs
             │
             ▼
Dedicated Web Worker
├─ restricted MicroPython WebAssembly
├─ allowlisted machine module
├─ debugger bridge
├─ Board Profile / Connection Graph
└─ Device Host / Device Models
```

Webサーバーは静的ファイルを配信するだけで、利用者のPythonコードをサーバー側では実行しない。
MicroPythonとDevice ModelはDedicated Web Worker内で動作し、DOMを直接操作しない。

## 実行環境とWorker境界

MicroPythonは固定した公式リリースとEmscripten版から、制限付きvariantとしてビルドする。汎用JavaScriptへ
到達する`js`、`jsffi`、JavaScript hookと、任意ネットワークに使えるモジュールは公開しない。Web Labが
登録する`machine`とデバッガ用モジュールだけを明示的な橋として扱う。

メインスレッドの`RuntimeClient`はWorkerを使い捨て可能な実行単位として管理する。停止、実行時間超過、
出力量超過、予期しないWorkerエラーではWorkerを破棄して再生成する。エディタ内容や接続設定の正本を
Worker内だけに置かないため、実行状態を失っても画面全体を再読み込みせず復旧できる。

UIとWorkerの通信には、版と型を持つ制御メッセージを使用する。REPLの標準入出力は制御状態と分離し、
未知のメッセージ、不正な値、古いWorkerからの応答をメインスレッドで拒否する。

## 同期入力

MicroPythonが同期的なPythonコードを実行している間、Workerの通常のメッセージループは入力イベントを
処理できない。ボタン、ADC、UARTなど、実行中にも変更する必要がある許可済み入力は、版付きかつ上限付きの
`SharedArrayBuffer`を介して共有する。

共有領域は名前、値域、形式版、容量を起動時に検証する。PythonコードとDevice Modelには共有バッファ自体を
渡さず、Device Hostが検証済みのスカラー値、キュー、Device Actionへ変換する。共有メモリを利用できない
環境では同期入力とデバッグ実行を無効にし、通常のREPLと出力観測は可能な範囲で維持する。

## 仮想ボード、接続、デバイス

Board ProfileはPico 2 Wのピン、ADC、I2C、SPI、UART、PWMなどの資源を解決する。Device Modelは特定の
DOMやボード実装へ依存せず、論理ポートを通してGPIO、ADC、バス、PWMの同期動作を提供する。

`ConnectionGraphV1`はDevice ModelのポートとBoard Profile上のピン・バスを対応付ける。接続グラフは
Device Model生成前に検証し、未対応ピン、GPIO競合、I2Cアドレス重複、SPI CS競合などを拒否する。I2Cのように
同一controllerへ複数デバイスを接続できる資源は、共有信号とデバイス固有資源を分けて検査する。形式の詳細は
[接続モデル仕様](connection-model-v1.md)を参照する。

Device UIは許可リスト方式の宣言的な部品から固定DOMを生成する。Device ModelへDOM、ストレージ、
任意ネットワーク、汎用JavaScriptブリッジを渡さない。UI表示用の状態とシミュレーション状態は別の値として
扱い、状態通知には順序番号と容量上限を持たせる。第三者Device Model向けの契約は
[Device API v1仕様](device-api-v1.md)を参照する。

## エディタ、REPL、デバッグ

コードエディタは複数タブを扱い、ブラウザ内の版付き保存形式へ下書きを保存する。仮想デバイスのサンプルは
既存コードを上書きせず、新しいタブとして追加する。

REPLは出力画面モデルと不可視のブラウザ入力要素を分ける。MicroPython側を入力・履歴の正本とし、
ブラウザは確定した文字と制御キーだけをWorkerへ送る。応答しない実行中の停止は、MicroPythonの協調動作に
依存せずWorker再生成として扱う。

デバッグ実行は通常実行と明示的に分ける。安定版MicroPythonで利用できる`sys.settrace()`を用い、pdbに近い
コマンドとGUI操作を同じコマンド経路へ送る。停止位置と上限付きグローバル変数スナップショットをUIへ表示し、
デバッグ停止中は実行中ソースとの対応を保つ。

## ローカルDevice開発

ローカル開発経路は、開発者が信頼するDevice packageを検査後にWorkerへ静的に組み込む。通常ビルドでは
ローカルパスとコードを含めない。複数デバイス構成は、source、期待するDevice ID・版、全ポート接続を
宣言したローカル設定として起動前にまとめて検証する。形式と信頼境界は
[Local Device Configuration v1](local-device-configuration-v1.md)を参照する。

ローカルコードをNode.jsやWorkerで実行する仕組みはセキュリティサンドボックスではない。出所を確認できる
コードだけを対象とし、管理版へ組み込むデバイスとは別の経路として表示する。具体的な手順は
[Device開発ガイド](device-development.md)を参照する。

## オプションコンテンツ境界

通常版のUIは、将来のオプションコンテンツを接続できる小さなno-op境界だけを参照する。公開対象外の
コンテンツ、出典情報、UI、テストを通常バンドルと公開リポジトリへ含めない。将来コンテンツを公開する場合は、
公開許可、形式検証、完全性確認、実行前の利用者操作を別の変更として設計する。

## 配信

本番配信ではCSP、COOP、COEP、CORP、Permissions Policyなどを適用し、WASMとWorkerに必要な権限だけを
許可する。開発サーバー固有のWebSocketやインラインstyle許可を本番へ持ち込まない。設定と確認方法は
[静的配信の準備](deployment.md)を参照する。

## 主な設計判断

- [ADR 0001: MicroPythonをDedicated Web Worker内で実行する](adr/0001-run-micropython-in-web-worker.md)
- [ADR 0009: REPL表示と入力状態を分離する](adr/0009-accept-input-inside-the-repl-terminal.md)
- [ADR 0010: MicroPythonを固定ソースから制限付きでビルドする](adr/0010-build-a-restricted-micropython-runtime.md)
- [ADR 0011: 実行資源の上限をWorker外から強制する](adr/0011-enforce-runtime-resource-limits-outside-the-worker.md)
- [ADR 0012: 同一オリジン中心の制限付き配信ポリシーを適用する](adr/0012-serve-the-lab-with-a-restrictive-security-policy.md)
- [ADR 0028: 安定版ベースのpdb互換デバッグ実行を追加する](adr/0028-add-a-stable-pdb-compatible-debug-mode.md)
- [ADR 0030: 小さな型付きカタログでUIを多言語化する](adr/0030-localize-the-ui-with-a-small-typed-catalog.md)
- [ADR 0031: ビューポートへ追従するワークベンチを使う](adr/0031-use-a-viewport-responsive-workbench.md)
- [ADR 0032: 停止位置と上限付きグローバル変数を表示する](adr/0032-show-debug-location-and-bounded-globals.md)
