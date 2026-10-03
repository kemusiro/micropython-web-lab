# ADR 0018: 同期Device入力を版付き単一値と上限付きキューへ一般化する

- 状態: Accepted
- 日付: 2026-08-30

## 背景

M8とM9では、GPIO 15のボタンとGPIO 26のADC値を、固定12バイトの`SharedArrayBuffer`で
メインスレッドからWorkerへ同期共有した。この方式により、MicroPythonが同期ループを実行中でも
入力を変更できるが、デバイスを追加するたびにスロット番号、バイト長、専用クラスを変更する必要がある。

Device API v1では第三者デバイスの操作値に加え、UARTのように順序を失ってはならない入力も扱う。
通常の`postMessage`は、MicroPython実行中にWorkerのイベントループが処理できないため、この経路を
置き換えられない。一方、共有メモリ自体をDevice Modelへ公開すると、公開APIとセキュリティ境界が
共有レイアウトへ依存してしまう。

## 決定

固定スロットの`SharedGpioInputs`を、名前付きチャンネルを持つ`SharedDeviceInputs`へ置き換える。
共有レイアウトv1は次の2種類を扱う。

- 32ビット整数の単一値。各値は独立した単調増加版を持ち、許可値域をレイアウトで検証する。
- バイトキュー。単一Producer／単一Consumerのリングバッファとし、読み書き順序番号を持つ。

キュー容量は1チャンネル最大4,096バイトとする。容量を超える書き込みは全体を拒否し、古いデータも
新しいデータも暗黙に捨てない。UARTの1回のDevice API転送は従来どおり最大256バイトとする。

Worker起動プロトコルをv8へ更新し、`start.deviceInputs`で共有バッファとレイアウト記述を一緒に渡す。
Workerは形式マーカー、共有形式版、レイアウト版、チャンネル数、レイアウト指紋、バイト長を検証する。
一致しないバッファはDevice Modelを生成する前に拒否する。

共有メモリはメインスレッドとDevice Hostの内部アダプターだけが扱う。Device Modelには検証済みの
`DeviceAction`またはポート値だけを渡し、`SharedArrayBuffer`、`Atomics`、Workerメッセージを公開しない。
GPIO 15とADC 26は版付き単一値へ移行する。UART入力はホスト側アダプターが共有キューとDevice Modelの
受信データを決定的な優先順で統合し、合計上限を超える場合は診断可能なエラーにする。

## 結果

- デバイス追加時に固定バイト位置を増やさず、検証済みレイアウトへ名前付き入力を追加できる。
- Workerは単一値の未適用版だけをDevice Actionへ反映できる。
- UARTなどの順序付き入力は、あふれによる暗黙のデータ欠落を起こさない。
- Device Modelと公開Device APIは共有メモリ形式から独立する。
- M8の4バイト形式とM9の12バイト形式は内部互換性を維持せず、プロトコルv8で明示的に拒否する。
- `SharedArrayBuffer`を利用できない環境では、同期入力を無効にしてランタイムと出力観測を継続する。

## 関連文書

- `docs/device-api-v1.md`
- `docs/architecture.md`
- `docs/threat-model.md`
- `docs/adr/0013-share-synchronous-virtual-input-state.md`
- `docs/adr/0014-model-virtual-adc-as-a-shared-input.md`
