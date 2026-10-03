# ADR 0013: 仮想入力をメインスレッドとWorkerで同期共有する

- 状態: Superseded by ADR 0018
- 日付: 2026-08-29

## 背景

仮想ボタンはメインスレッドのUIで操作し、MicroPythonの同期APIである`Pin.value()`から読み取る。
通常の`postMessage`だけでは、MicroPythonが`while button.value():`のようなコードを実行している間、
WorkerのJavaScriptイベントループが新しい入力メッセージを処理できない。そのため、ボタン待ちの
Pythonコードを入力操作で進められない。

M7.2でページをクロスオリジン分離したため、対応ブラウザでは`SharedArrayBuffer`と`Atomics`を
利用できる。ただし、共有メモリを汎用デバイスAPIとして公開すると、状態の所有権と安全性が曖昧に
なるため、用途と形式を限定する必要がある。

## 決定

メインスレッドとDedicated Workerの間に、仮想GPIO入力専用の`SharedArrayBuffer`を1個だけ設ける。
M8形式は32ビット整数1スロットで、GPIO 15の仮想ボタンだけを割り当てる。メインスレッドは
`Atomics.store()`、Workerの仮想GPIOモデルは`Atomics.load()`で値を扱う。

ボタンはプルアップされたアクティブLow入力としてモデル化し、離しているときは1（HIGH）、押して
いる間は0（LOW）とする。`machine.Pin`には`PULL_UP`と`PULL_DOWN`定数を追加するが、M8で電気的に
モデル化するプル抵抗はGPIO 15の既定プルアップだけである。

共有領域はプロトコルバージョン5の`start.inputStateBuffer`でWorkerへ渡す。Workerは長さを検証して
から、仮想GPIOモデルへピン値を読む関数だけを注入する。`machine`モジュールやPythonコードには
共有バッファ自体を公開しない。WorkerからUIへの状態通知は、従来どおり順序付き`device-state`
メッセージを使用する。

クロスオリジン分離または`SharedArrayBuffer`を利用できない環境では、ランタイムと出力GPIOは起動を
継続し、仮想ボタンだけを無効として理由を表示する。

## 結果

- MicroPythonが同期ループを実行中でも、メインスレッドを止めずにボタン入力を変更できる。
- 共有形式は許可済み入力スロットだけに限定され、DOM、ストレージ、認証情報は共有しない。
- 新しい入力デバイスを追加する場合は、安定したスロット割り当て、初期値、再起動時の扱いを設計する。
- `SharedArrayBuffer`を利用するため、COOPとCOEPを含むM7.2の配信ヘッダーは機能要件にもなる。
- IRQ、チャタリング、電圧、精密な時刻、実ボード固有の内部プル抵抗は本ADRの対象外とする。

## 関連文書

- `docs/architecture.md`
- `docs/threat-model.md`
- `docs/adr/0005-model-virtual-gpio-behind-machine-pin.md`
- `docs/adr/0012-serve-the-lab-with-a-restrictive-security-policy.md`
- `docs/adr/0014-model-virtual-adc-as-a-shared-input.md`
