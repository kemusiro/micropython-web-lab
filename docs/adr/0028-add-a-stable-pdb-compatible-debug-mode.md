# ADR 0028: 安定版ベースのpdb互換デバッグ実行を追加する

- 状態: Accepted
- 日付: 2026-10-01

## 背景

実機向けMicroPythonの一般的な配布物にはCPythonの`pdb`に相当する対話デバッガが含まれず、
初学者は`print()`の追加と再実行へ依存しやすい。MicroPython v1.28.0には任意ビルド機能として
`sys.settrace()`があるが、既定では無効である。また、この版のframe objectには`f_locals`と
`sys._getframe()`がなく、CPythonの`bdb`／`pdb`をそのまま移植できない。

WebAssemblyがPythonコードを実行中はDedicated Workerのメッセージループへ制御を返さない。
したがって、ブレーク中のコマンドを通常の`postMessage()`だけで渡すことはできない。

## 決定

通常実行と利用者が明示的に選ぶ「デバッグ実行」を分離する。固定済みの公式MicroPython
v1.28.0へ未採用の上流パッチは追加せず、variantで`MICROPY_PY_SYS_SETTRACE=1`だけを有効にする。

デバッグ実行では、Worker起動時にWeb Lab管理の`pdb`モジュールを登録し、エディタソースを
`main.py`としてコンパイルしてトレース下で実行する。最初の実行行で停止し、次のコマンドを提供する。

- `help`、`where`、`list`、`up`、`down`
- `break`、`clear`
- グローバル式を対象とする`p`／`pp`と`!`
- `step`、`next`、`return`、`continue`
- Worker再生成として扱う`quit`

実行制御の`step`、`next`、`return`、`continue`、`quit`は、pdbコマンド入力に加えてGUIボタンからも
同じコマンド経路へ送信する。

モジュールAPIとして`Pdb`、`set_trace()`、`run()`、`runeval()`、`runcall()`を公開する。
`pdb.set_trace()`はデバッグ実行中だけ有効とし、通常実行で使用した場合は明示的な
`RuntimeError`にする。デバッグ実行では開始前からトレースを設定するため、v1.28.0に
`sys._getframe()`がなくても次の行で停止できる。

メインスレッドから停止中のWorkerへコマンドを渡すため、4,096 UTF-8バイトを上限とする
単一コマンド用`SharedArrayBuffer`を使用する。制御領域にはformat marker、version、状態、長さを
持たせる。Workerは待機状態を設定して`debugger-paused`を送信した後、`Atomics.wait()`で待つ。
メインスレッドはコマンドを書き込み、`Atomics.notify()`で再開させる。

プロトコルバージョン10は`execute.mode`、デバッガ共有領域、`debugger-paused`、
`debugger-resumed`を追加する。デバッガ待機時間は10秒の実行時間へ含めないが、再開前後の
実動時間は累積する。出力100,000文字の上限は待機中も維持する。

## 制約

- v1.28.0のframe objectから関数ローカル変数を取得できないため、`p`、`pp`、`!`は
  `f_globals`だけを評価する。`args`は制約を表示する。
- ステップ対象はエディタからコンパイルした`main.py`に限定し、ランタイム内部や登録済み
  JavaScriptモジュールへは入らない。
- `quit`はトレースコールバックから例外を投げず、Workerを破棄して再生成する。この版の
  `sys.settrace`はトレースコールバックの例外後に安全に再利用できる保証がないためである。
- `SharedArrayBuffer`を利用できない非分離環境ではデバッグ実行を無効にし、通常実行とREPLは維持する。

## 結果

- 通常実行は従来どおり`runPython()`を使い、常時トレースによる性能低下を受けない。
- Web Lab上でCPython `pdb`に近いコマンド体系を学習でき、コード中の`pdb.set_trace()`も
  デバッグ実行で利用できる。
- 完全なCPython互換を名乗らず、ローカル変数参照などの差分をUIと文書で明示する。
- 将来、必要機能が安定版MicroPythonへ取り込まれた場合は、固定リリース更新時に
  `f_locals`、通常実行中の即時`set_trace()`、より広い`bdb`互換性を再評価する。

## 関連文書

- `docs/adr/0001-run-micropython-in-web-worker.md`
- `docs/adr/0010-build-a-restricted-micropython-runtime.md`
- `docs/adr/0011-enforce-runtime-resource-limits-outside-the-worker.md`
- `docs/architecture.md`
- `docs/threat-model.md`
