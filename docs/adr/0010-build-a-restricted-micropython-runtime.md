# ADR 0010: MicroPythonを固定ソースから制限付きでビルドする

- 状態: Accepted
- 日付: 2026-08-26

## 背景

M6.1までは公式npmパッケージのPyScript向けWASM成果物を使用していた。この成果物は
MicroPythonの`js`モジュールからWorkerのJavaScript環境へ到達できる。利用者のPythonコードを
信頼しない公開サービスでは、Dedicated WorkerだけではDOM、通信API、同一オリジン資源を守る境界に
ならない。

一方、仮想デバイスはMicroPythonの同期APIからJavaScript実装を呼び出す必要がある。JavaScript連携を
すべて失うのではなく、Web Labが選んだ狭い機能だけを登録できる境界が必要である。

## 決定

MicroPython v1.28.0の公式リリースを、コミット
`e0e9fbb17ed6fd06bb76e266ae554784c9c80804`とアーカイブSHA-256で固定する。Emscripten
6.0.6も固定し、`scripts/build-micropython.sh`で再現可能なWASM成果物を生成する。入力値は
`runtime/micropython/versions.env`、生成物SHA-256は
`runtime/micropython/artifacts.sha256`を正とする。

カスタムvariant `web-lab-restricted`では、次を適用する。

- `MICROPY_PY_JS`、`MICROPY_PY_JSFFI`、JavaScript hookを無効にする。
- frozen manifestを空にし、意図しない同梱Pythonモジュールを増やさない。
- WASMメモリの自動拡張を有効にせず、Web LabからPythonヒープを1 MiBで初期化する。
- `socket`と`network`を利用できないことを成果物の回帰テストで確認する。
- Web Labが`registerJsModule()`で登録する`machine`だけをPython/JavaScript間の許可された橋とする。

上流v1.28.0とEmscripten 6.0.6の組み合わせでは、分割ヒープを無効にした場合に未使用変数が
`-Werror`となる。上流全体の警告を抑制せず、該当カウンターを分割ヒープ設定で条件コンパイルする
最小パッチを`runtime/micropython/patches`で管理する。

生成した`.mjs`と`.wasm`は、公開サイトのビルドが上流取得やEmscriptenに依存しないようGitで追跡
する。ランタイムのreadyメッセージにはソース版、コミット、variantを含め、UIから実際のビルドを
確認できるようにする。

## 結果

- 汎用JavaScript連携と任意ネットワーク用モジュールをPythonから直接利用できなくなる。
- 仮想デバイスは明示的に登録したAPIとして引き続き実装できる。
- 上流版、ツール版、パッチ、成果物の対応をレビューできる。
- MicroPython更新時は固定値、パッチ適用可否、機能遮断テスト、ライセンスを一緒に確認する必要がある。
- この決定だけで完全な隔離を証明するものではなく、CSP、配信ヘッダー、CPU・出力制限は別途必要である。

## 関連文書

- `docs/threat-model.md`
- `docs/adr/0001-run-micropython-in-web-worker.md`
- `docs/architecture.md`
- `runtime/micropython/LICENSE`
