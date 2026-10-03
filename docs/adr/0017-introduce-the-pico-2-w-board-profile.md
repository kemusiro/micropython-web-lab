# ADR 0017: Pico 2 Wの資源解決を内部Board Profileへ分離する

- 状態: Accepted
- 日付: 2026-08-29

## 背景

M10までの`machine`アダプターは、文字列のピンID、ADC 26、I2C Bus 0を個別に判定し、Workerが
仮想GPIOとI2Cバスを直接組み立てていた。この構造へSPI、UART、PWMと第三者デバイスを追加すると、
ボード固有のピン規則、Device API、UI、Workerプロトコルが再び結合する。

内部実装の互換性は維持する必要がない。一方、既存のREPL、`Pin("LED")`、GPIO 15ボタン、ADC 26、
I2Cレジスタデバイス、既存の内蔵LED作例は外部互換性として維持する必要がある。

## 決定

初版ボードの正規IDを`raspberry-pi-pico-2-w-v1`、版を`1`とし、`src/board`へ内部`BoardProfile`
境界を追加する。物理ピン、GPIO、GND、電源、制御ピン、アナログ基準、内部`WL_GPIO0`を区別する。

Board ProfileはDigital GPIO、ADC0、I2C0に加え、Device API v1で使用するSPI0、UART0、PWMの
初期ピン割り当てを解決する。`machine`アダプターはBoard Profileの検証後に仮想GPIOとバスへ接続する。
ピン、排他的バス、I2Cアドレスの競合は、Device Modelへ内部Board Profile型を渡さずホスト側の資源
レジストリで検出する。

保存値には正規Profile IDと版を記録する。既存のエディタ保存値にProfileがない場合と、旧形式の
`pico-2-w`はPico 2 W v1へ移行する互換入力として受け付ける。`pico-2-w`を新しい内部正規IDにはしない。

Board Profile APIは第2ボードとの差異を検証するまで公開しない。Device API、Runtime Profile、Worker
プロトコルとは独立した内部境界として扱う。

## 結果

- ボード固有のピン・バス検証をUIなしで単体テストできる。
- Device APIのモデルはボード内部型ではなく、交渉済みのDevice Portだけを受け取れる。
- 既存サンプルを変更せず、内部の資源IDと将来のボード切り替えを導入できる。
- 初版はPico 2 Wだけを選択でき、第2ボードの追加まではBoard Profileの公開互換性を保証しない。
- 実行中の同期Device Actionを一般化する共有入力領域はM11.2以降で実装する。

## 関連文書

- `docs/device-api-v1.md`
- `docs/architecture.md`
- `docs/adr/0016-define-a-curated-public-device-api.md`
