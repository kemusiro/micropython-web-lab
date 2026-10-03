# AE-BME280 I2Cデバイスモデル

## 対象

秋月電子通商の「BME280使用 温湿度・気圧センサーモジュールキット」`AE-BME280`、販売コード
`109421`を、Device API v1のI2C targetサンプルとして実装する。

- [秋月電子 商品ページ](https://akizukidenshi.com/catalog/g/g109421/)
- [秋月電子 AE-BME280マニュアル](https://akizukidenshi.com/goodsaffix/AE-BME280_manu_v1.1.pdf)
- [Bosch Sensortec BME280データシート](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf)

秋月電子のマニュアルでは、I2CアドレスはSDOをGNDへ接続した場合`0x76`、VDDへ接続した場合`0x77`で
ある。Web Lab管理版のConnection Graphは初期例として`0x76`をI2C0へ接続する。Pico 2 W初版Board
ProfileのI2C0ピンはSDA=GP8、SCL=GP9である。

## 実装する動作

`src/devices/bme280.ts`は次のBME280レジスタ動作を提供する。

- `0xD0`: チップID`0x60`
- `0x88`〜`0xA1`、`0xE1`〜`0xE7`: 読み取り専用の補正係数
- `0xE0`: `0xB6`によるソフトリセット
- `0xF2`、`0xF4`、`0xF5`: 湿度、測定、設定制御
- `0xF3`: 測定状態
- `0xF7`〜`0xFE`: 20-bit気圧、20-bit温度、16-bit湿度の生データ

補正係数と生データはBoschの整数補正式を使うMicroPython作例から温度、相対湿度、気圧を取得できる
ように決定論的に生成する。Device UIでは温度`-40`〜`85`℃、湿度`0`〜`100`%RH、気圧`300`〜
`1100`hPaを整数単位で変更できる。値は版付き共有入力を経由し、次のI2C操作の直前にWorker内の
Device Modelへ反映する。

画面の「BME280温湿度・気圧」作例は、チップIDと補正係数を読み、Boschの整数補正式で3測定値を表示する。
「BME280＋SSD1331」作例では、同じI2C0上の測定結果をSPI0接続のSSD1331へ描画し、複数デバイスを
Connection Graphの配線どおりに同時利用できることを検証する。

## 意図的な制限

これは機能レベルモデルであり、次は再現しない。

- センサー個体ごとに異なる実際の工場補正値
- 測定待ち時間、standby時間、IIRフィルターとoversamplingによる応答差
- `status.measuring`と`status.im_update`の実時間変化
- ノイズ、自己発熱、経時変化、結露、電源・配線異常
- SPI接続、アドレス選択を変更する画面操作
- 実機の0.01℃、0.008%RH、0.18Pa相当の入力分解能

ソフトリセットは制御レジスタを初期化するが、周囲環境を表すUI入力値は変えない。Workerの完全再生成では
UI入力値から再同期する。
