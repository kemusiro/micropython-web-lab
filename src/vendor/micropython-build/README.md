# Restricted MicroPython build

このディレクトリの`micropython.mjs`と`micropython.wasm`は生成物である。直接編集せず、
リポジトリルートで次を実行して更新する。

```sh
./scripts/build-micropython.sh
```

入力の版、アーカイブSHA-256、ツールチェーン版は
`runtime/micropython/versions.env`、機能差分は`runtime/micropython/variant`、上流への
最小変更は`runtime/micropython/patches`を正とする。

この生成物はMicroPython v1.28.0のWebAssemblyポートを基にしている。`js`、`jsffi`、
任意ネットワーク用モジュールを公開せず、Web Labが明示的に登録する`machine`モジュールだけを
PythonとJavaScriptのデバイス境界として使用する。M12では安定版の任意ビルド機能
`sys.settrace()`も有効にし、Web Labが登録する上限付きデバッガコマンド境界をデバッグ実行時だけ
使用する。

MicroPythonはMIT Licenseで配布される。ライセンス本文と第三者コードの概要は
`runtime/micropython/LICENSE`を参照する。

## 出典と再現性

| 項目 | 固定値・正本 |
| --- | --- |
| MicroPython | v1.28.0、commit `e0e9fbb17ed6fd06bb76e266ae554784c9c80804` |
| 上流ソース | `https://github.com/micropython/micropython/archive/refs/tags/v1.28.0.tar.gz` |
| ソース、LICENSE、生成物SHA-256 | [`runtime/micropython/versions.env`](../../../runtime/micropython/versions.env)と[`artifacts.sha256`](../../../runtime/micropython/artifacts.sha256) |
| ビルドツール | Emscripten 6.0.6 |
| Web Lab固有差分 | [`mpconfigvariant.h`](../../../runtime/micropython/variant/mpconfigvariant.h)、[`mpconfigvariant.mk`](../../../runtime/micropython/variant/mpconfigvariant.mk)、[`0001-guard-external-call-depth.patch`](../../../runtime/micropython/patches/0001-guard-external-call-depth.patch) |

`./scripts/build-micropython.sh`は上流タグアーカイブとLICENSEのSHA-256を検証してからビルドする。
`./scripts/use-node.sh node scripts/verify-micropython-runtime.mjs`は生成物ハッシュ、実行時の版、
`sys.settrace()`、禁止モジュール、許可された`machine`ブリッジを検証する。第三者ライセンスの一覧は
[`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md)を参照する。

## 永続ファイルと固定ヒープGC

ADR 0035でMEMFSを容量制限付きの`/project`領域として利用する。固定ヒープGCの
レジスタ走査に必要なAsyncifyを上流standard variantと同様に有効にする。
`0002-await-asyncify-execution.patch`は上流api.jsに`runPythonAwaitable()`を追加し、
非同期ccallの完了までコードと結果のバッファを保持する。WorkerはこのAPIと
上流の`replProcessCharWithAsyncify()`を使用し、GC中も入力を直列処理する。
更新時は両パッチを再適用し、`test:runtime`の反復割り当て・GC検証も実行する。
`micropython.d.mts`はこのリポジトリで管理するAPI宣言であり、WASMビルドの生成対象ではない。
