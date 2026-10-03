# ADR 0001: MicroPythonをDedicated Web Worker内で実行する

- 状態: Accepted
- 日付: 2026-08-24

## 背景

MicroPythonの公式WebAssemblyポートはブラウザで動作するが、長時間実行されるPython
コードは、その実行コンテキストを占有する。ブラウザでは実行中のコードへの割り込みが
利用できない場合があり、無限ループから確実に戻る仕組みが必要である。

## 決定

MicroPython WebAssemblyはDedicated Web Worker内で実行する。メインスレッドはUIと
Workerのライフサイクルを担当する。応答しないコードは `Worker.terminate()` で実行環境
ごと停止し、必要に応じて新しいWorkerを生成する。

## 結果

- Pythonコードが無限ループしても、メイン画面は操作可能なままになる。
- 停止はMicroPythonの協調動作に依存しない。
- Worker内の状態は停止時に失われるため、永続化対象はWorker外で管理する必要がある。
- DOMやメインスレッド固有APIをMicroPythonへ直接公開しない境界を作れる。
- Worker起動とWASMロードのコストが再起動ごとに発生する。
