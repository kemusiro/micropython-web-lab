# ADR 0014: GPIO 26の仮想ADCを版付き共有入力としてモデル化する

- 状態: Superseded by ADR 0018
- 日付: 2026-08-29

## 背景

M8ではGPIO 15のデジタルボタン入力を`SharedArrayBuffer`で同期共有した。光、温度、距離などの
センサーを将来追加するには、連続値をMicroPython実行中に変更できるアナログ入力の基盤が必要である。

MicroPython v1.28.0の`machine.ADC.read_u16()`は0〜65,535へスケールした整数を返す。RP2では
GPIO 26がADC0に対応し、`ADC(Pin(26))`またはADCチャンネルから利用できる。M9では実機の電気特性を
再現せず、このAPIと値域を機能レベルで合わせる。

M8の共有入力は32ビット整数1個だけで、レイアウト識別子を持たなかった。スロットを増やす前に、
Workerが想定と異なる形式を受け入れない版管理が必要である。

## 決定

共有入力を32ビット整数3スロット、合計12バイトのレイアウトv1へ更新する。

| スロット | 内容 | 値域・初期値 |
| --- | --- | --- |
| 0 | レイアウトバージョン | `1` |
| 1 | GPIO 15ボタン | 0または1、初期値1 |
| 2 | GPIO 26アナログ入力 | 0〜65,535、初期値32,768 |

生成側はスロット0を初期化し、Workerはバイト長とレイアウトバージョンを検証する。起動メッセージの
意味が変わるため、Worker通信プロトコルをバージョン6へ更新する。

`machine`モジュールへ最小`ADC`ファクトリーと`read_u16()`を追加する。M9で受け付ける入力源は
GPIO番号26、`Pin(26)`、RP2のADCチャンネル0だけとする。他の入力源は暗黙に0を返さずエラーにする。

仮想GPIOモデルはデジタルGPIOとADCの状態へ共通の順序番号を付ける。ADC状態は
`kind: "adc-channel"`、GPIO番号、0〜65,535の値を持ち、既存の`device-state`メッセージでUIへ返す。
メインスレッドのスライダーは共有領域の正本であり、Worker再生成後も同じページ内では値を維持する。

## 結果

- 実行中のMicroPythonから、UIで変化する連続値を同期的に読み取れる。
- GPIO 26の可変抵抗を、将来のアナログセンサー入力の基準実装として利用できる。
- 共有入力の長さと版が一致しない場合は、ランタイム起動を安全に失敗させる。
- `read_uv()`、ADCBlock、減衰、サンプリング時間、ノイズ、量子化、校正、GPIO 27〜29は対象外とする。
- オプションコンテンツの形式はM9では拡張せず、ADC作例との連携は別途判断する。

## 関連文書

- `docs/architecture.md`
- `docs/threat-model.md`
- `docs/adr/0013-share-synchronous-virtual-input-state.md`
- https://docs.micropython.org/en/v1.28.0/library/machine.ADC.html
- https://docs.micropython.org/en/v1.28.0/rp2/quickref.html#adc-analog-to-digital-conversion
