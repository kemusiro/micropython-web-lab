# GT-502MGG-N UART GPSデバイスモデル

## 対象

秋月電子通商の「GPS受信機 GT-502MGG-N」、販売コード`117980`を、Device API v1の
UART peerサンプルとして実装する。搭載チップはMediaTek MT3333であり、実機はNMEA 0183の測位文を
UARTから出力する。

- [秋月電子 商品ページ](https://akizukidenshi.com/catalog/g/g117980/)
- [YIC GT-502GG／GT-502MGGデータシート](https://akizukidenshi.com/goodsaffix/GT-502MGG.pdf)

管理版Connection GraphはPico 2 WのUART0へ次のように固定接続する。電源線は配線一覧の説明には含めるが、
シミュレーションのConnection Graphでは電気特性を扱わない。

| GT-502MGG-N信号 | Pico 2 W | 用途 |
| --- | --- | --- |
| TXD | GP1（UART0 RX） | GPSからPicoへのNMEA出力 |
| RXD | GP0（UART0 TX） | PicoからGPSへのコマンド入力 |
| PPS | GP14（GPIO入力） | ポーリング式1PPS出力 |
| GND | GND | 共通GND |
| VCC | 3V3 | 電源（シミュレーションでは電気特性を扱わない） |

実機の既定通信条件に合わせ、作例では9600 bps、8 data bits、parityなし、1 stop bitを使う。

## 実装する動作

モデル`org.micropython-web-lab.gt-502mgg-n` version `0.2.0`はDevice API v1の`uart-peer`と
`gpio-driver`を各1ポート提供する。起動またはリセット後は3秒間`acquiring`となり、GGAの測位品質を`0`、
使用衛星数を`00`、RMCの状態を`V`として出力する。3秒経過後は`fixed`へ遷移し、測位品質`1`、使用衛星数
`08`、RMC状態`A`となる。これは教材で状態遷移を確認するための短縮した決定論的捕捉時間であり、実機の
TTFFを再現する値ではない。

UARTを9600 bpsで初期化すると、現在の測位位置を表す次のNMEA文を1 Hzで受信キューへ生成する。

- `GNGGA`: 測位品質、衛星数、緯度、経度、高度
- `GNRMC`: 有効状態、緯度、経度、速度、方位、日付

各文はCRLFで終端し、NMEAのXORチェックサムを付与する。UTCは固定起点から1秒ずつ進めるためテストを
再現できる。初期位置は東京駅付近とし、Device UIの「緯度,経度,高度(m)」入力から任意の位置へ変更できる。
画面の「GT-502MGG-N GPS」作例は捕捉完了までGGA/RMCを読み、チェックサム、連続するUTC秒、緯度、経度、
高度を検証する。

Device Modelは省略可能な公開`DeviceContext.clock`を同期UART操作時に読む。経過したすべての秒をキューへ
積まず、現在秒の最新GGA/RMCへ置き換える。飛ばした周期と未読置換数はDevice Stateへ記録する。これにより
ブラウザのタイマー抑制や長時間未読でキューを無制限に増やさない。時計を提供しない旧ホストでは経過時間0の
捕捉中状態に留まる。

捕捉後のPPSは、各1秒区間の先頭100 msだけHighとなる機能レベル信号である。MicroPythonから
`Pin(14, Pin.IN).value()`を繰り返し読み、LowからHighへの変化を観測する。`Pin.irq()`は現在の仮想
`machine`実装に含まれない。

管理版UART0にはConnection Model v1の1 peer規則があるため、従来のUARTエコーデバイスとGPSを同時には
接続しない。既存の115200 bps UARTエコー作例を壊さないため、GPSモデルは115200 bps時に受信データを
そのまま返す互換モードを持つ。このモードは実機GT-502MGG-Nの仕様を表すものではなく、将来サンプルの
移行方法を用意した後に廃止を検討する。

## 意図的な制限

これは機能レベルモデルであり、次は再現しない。

- 実機のTTFF、衛星ごとの捕捉、衛星軌道、受信感度、測位誤差、アンテナ特性
- UARTを読み取らない間も非同期にイベントを配送するスケジューラー
- PPSの電気特性、実機精度、ジッター、`Pin.irq()`による割り込み
- GLL、GSA、GSV、VTGなど、作例で使わないNMEA文
- PMTKコマンドによるボーレート、出力周期、文種などの変更
- 移動速度、進行方位、高度以外の測位状態を変更するUI
- 電源電圧、消費電流、UART電圧レベル、未接続、誤配線などの電気的異常

各同期操作では最新秒のGGA/RMC各1文だけを生成し、UART受信キューにはDevice API v1の上限を適用する。
