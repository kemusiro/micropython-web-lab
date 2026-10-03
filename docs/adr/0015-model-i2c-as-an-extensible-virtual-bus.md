# ADR 0015: I2Cを拡張可能な仮想バスとデバイスに分離する

- 状態: Accepted
- 日付: 2026-08-29

## 背景

GPIOとADCだけでは、実機で一般的なセンサー、表示器、メモリなどの周辺機器を扱えない。I2C対応を
特定製品の画面実装として始めると、`machine.I2C`、バス、デバイスの動作、DOMが密結合し、別の
センサーや複合サンプルへ再利用しにくくなる。

MicroPython v1.28.0のハードウェアI2Cは、バスIDと任意のSCL、SDA、周波数で初期化し、7-bit
アドレスのスキャン、通常転送、メモリ転送を提供する。RP2のI2C(0)は既定でSCL=GPIO 9、
SDA=GPIO 8を使う。M10では電気的なバスエミュレーションではなく、Python作例を実行できる
機能レベルの互換性を目標とする。

## 決定

DOM非依存の`VirtualI2cBus`と`VirtualI2cDevice`境界を導入する。初期構成はBus 0だけを持ち、
アドレス`0x50`へ256バイトの汎用レジスタデバイスを接続する。特定製品名や物理特性は付与せず、
将来のデバイスは同じ境界へ別モデルとして追加する。

`machine.I2C`は`scan()`、`readfrom()`、`writeto()`、`readfrom_mem()`、`writeto_mem()`を
提供する。1回の転送は256バイト、メモリアドレスは8-bitに制限し、未接続アドレス、未対応Bus、
不正な値を暗黙に成功させない。戻り値はWASM境界でMicroPythonの`list`と`bytes`へ明示変換する。

トランザクション状態は操作、Bus ID、アドレス、レジスタアドレス、バイト数、バス内の順序番号だけを
プロトコルバージョン7でメインスレッドへ通知する。利用者データは状態通知、ログ、DOMへ複製しない。
Worker再生成時には仮想デバイスのレジスタ内容も破棄する。

## 結果

- I2Cデバイスの状態遷移をUIなしで単体テストできる。
- Pythonコードは実機と同じ基本APIでスキャンとレジスタ転送を試せる。
- センサーや表示器を追加するとき、I2CアダプターとUIを作り直さずデバイスモデルを追加できる。
- M10はBus 1、SoftI2C、精密タイミング、IRQ、実製品固有動作、16-bitメモリアドレスを扱わない。
- 課金対象となる将来のデバイスも、利用権判定をMicroPythonへ直接公開せず、この境界の外側で設計する。

## 関連文書

- `docs/architecture.md`
- `docs/threat-model.md`
- https://docs.micropython.org/en/v1.28.0/library/machine.I2C.html
- https://docs.micropython.org/en/v1.28.0/rp2/quickref.html#hardware-i2c-bus
