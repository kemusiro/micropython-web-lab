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

空のREPL主プロンプトでCtrl+Dを入力した場合は、WASMの終了要求を`repl-reset`制御イベントへ変換し、
Workerを再生成する。Python変数とWorker内の状態は失うが、エディタ・配線設定と共有入力領域は保持する。
ボタンの押下状態は従来の再起動と同様に解除する。複数行入力の完了にはリセットを発生させない。

標準出力・標準エラーはWorker内で改行または4,096文字までまとめ、制御イベントの前と入力処理の終了時にも
転送する。1入力メッセージまたは1スクリプトあたり合計100,000文字を超えると、`output-limit`を一度通知して
以降の出力を破棄する。メインスレッドの実行時間・出力量制限も維持し、端末のDOM描画はフレームごとにまとめる。
詳細と通信版の移行は[ADR 0033](adr/0033-recover-repl-reset-and-output-floods.md)を参照する。

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

## ワークスペースの表示境界

ワークスペースはファイルツリー・サンプル、エディタ・REPL、仮想デバイスの3列で構成する。
構成・配線の専用ビューへの移動はCSSとDOMの表示だけを変更し、エディタ、REPL、接続エディター、
RuntimeClientを再生成しない。配線の適用によるWorker再生成は従来の経路を利用する。
ファイル・エディタ・接続設定の保存形式、Worker通信、Device APIの契約はこの配置変更では変えない。

中央と右の幅の保存比率はファイルペインを除く領域に適用する。配線エディターは、専用ビューの
スクロール領域を基準にPico端子表の追随と結線端点の表示を計算する。デバイスカードの
折りたたみは表示用の状態だけであり、モデルの実行と状態通知を止めない。

## エディタ、REPL、デバッグ

コードエディタは複数タブを扱い、ブラウザ内の版付き保存形式へ下書きを保存する。仮想デバイスのサンプルは
既存コードを上書きせず、パスを持たない「無題」タブとして追加する。すべてのタブの自動保存は復元用の
下書きだけを更新し、ファイル本体へ反映しない。実行はバッファを渡し、importとopenは保存済みファイルを
使う。ZIP出力でもバッファをファイルへ反映しない。明示的な保存時に、ファイルとタブの紐づけを
同じIndexedDBトランザクションで保存し、成功後に画面とWorker側のファイル一覧を更新する。
既存の初期・旧形式ワークスペースの取り込み時だけ、従来のファイル名割り当てを維持する。保存形式は変更しない。

ファイル操作はツリーの選択と操作ごとの入力ダイアログを使う。名前変更は同じ親の中で行い、
ディレクトリ作成は選択中のディレクトリへ追加し、ファイル選択時はその親へ追加する。
移動は既存のディレクトリから移動先を選び、名前を保ったままProjectFiles.renameで子孫とタブのパスを
更新する。移動元自身とその子孫は候補から除き、実行時にも移動先と同名項目の有無を確認する。
ファイルツリー内のファイルはHTMLのドラッグ＆ドロップでもディレクトリ行またはルートへ移動できる。
ドラッグ元はツリーの表示状態で保持し、外部のドロップデータだけで移動を開始しない。ドロップ時は
「移動」ボタンと同じ処理を使い、実行中や保存中はドラッグを解除して移動を無効にする。
`/project`は選択できるが名前変更・移動・削除できない。
ファイルと空ディレクトリは直接削除し、空でないディレクトリだけ子孫を含む削除の確認を求める。
ProjectFilesの再帰削除は明示指定時だけ有効とし、通常のremoveは空でないディレクトリを拒否する。
変更はファイルと開いているタブをまとめて永続化してから反映する。新規ファイル操作はパスのない無題タブを開く。

タブの未保存表示と閉じる確認は、保存に成功したファイル内容との比較で判定する。ProjectWorkspaceは
IndexedDBへ書き込み中のファイルと、最後に保存できたファイルを分けて保持し、保存失敗で未保存表示を
消さない。テキストエリアの改行正規化は変更とみなさない。無題タブは空でも確認し、下書きを自動保存しても
ファイル未保存の状態を維持する。名前のあるタブも下書きの退避では未保存表示を消さない。
変更を破棄して閉じる場合は下書きだけを除去し、ファイル本体を維持する。IndexedDBのfilesystemとtabsを
分けて復元し、新しいlocalStorage退避記録もtabsだけに適用する。初回の旧形式取り込み以外で下書きを
ファイルへ昇格させない。保存形式は変更しない。

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
