# Connection Model v1（Internal Experimental）

- 状態: Internal Experimental
- スキーマ版: `1`
- 対象ボード: `raspberry-pi-pico-2-w-v1@1`

## 目的

Connection Modelは、Device Modelが宣言する論理ポートを、Board Profile上のGPIO、ADC、I2C、SPI、UART、
PWMへ割り当てるホスト内部の接続グラフである。Device API v1の同期ポート契約と、ボード固有のピン番号を
分離し、Workerへ固定配線を直接記述しない。

管理版の初期値は`src/connections/managed-connection-graph.ts`である。通常ビルドでは接続エディターから
管理版Deviceの有効／無効と割り当て先を変更し、有効なグラフをブラウザへ保存できる。ローカルDevice構成は
構成ファイルを正本とするため読み取り専用で表示する。

## 構造

接続グラフは、スキーマ版、Board Profile、デバイスインスタンス列を持つ。各インスタンスはDevice IDと版を
固定し、マニフェストで宣言された全ポートをちょうど1回割り当てる。

```json
{
  "schemaVersion": 1,
  "boardProfile": { "id": "raspberry-pi-pico-2-w-v1", "version": 1 },
  "devices": [
    {
      "instanceId": "ae-bme280-0x76",
      "deviceId": "org.micropython-web-lab.ae-bme280",
      "deviceVersion": "0.1.0",
      "ports": [
        {
          "portId": "i2c",
          "endpoint": { "kind": "i2c", "controller": 0, "address": 118 }
        }
      ]
    }
  ]
}
```

エンドポイント種別は次のとおりである。

| エンドポイント | 対応Deviceポート | 接続情報 |
| --- | --- | --- |
| `gpio` | `gpio-observer`、`gpio-driver` | GPIO名 |
| `adc` | `adc-source` | ADC対応GPIO名 |
| `i2c` | `i2c-target` | controller ID、7-bitアドレス |
| `spi` | `spi-target` | controller ID、同一デバイスのCSポートと有効レベル、または既定fallback |
| `uart` | `uart-peer` | controller ID |
| `pwm` | `pwm-observer` | GPIO名 |

## 資源規則

- I2CのSDA/SCLは同じcontroller上の複数ターゲットで共有する。
- 同じI2C controller上で7-bitアドレスを重複させない。
- SPIのSCK/MOSI/MISOは同じcontroller上の複数ターゲットで共有する。
- SPIの通常ターゲットは同一デバイスの`gpio-observer`をCSとして参照し、CS GPIOは排他的に確保する。
- 従来のCSなしSPIレジスタ作例は、controllerごとに最大1個のfallbackターゲットとして維持する。
- 複数CSが同時に有効になったSPI転送は、暗黙に応答を合成せずエラーにする。
- UART controllerは初版で1 peerだけへ接続する。
- GPIO、ADC、PWM、UART信号ピン、I2C/SPI信号ピンの意図しない重複を起動前に拒否する。
- Device ID、版、ポートID、ポート種別、I2C既定アドレスが実際のDevice Definitionと一致しない場合は
  Device Modelを生成しない。

## 管理版プリセット

BME280とSSD1331は同じPico 2 Wへ次のように同時接続する。

| デバイス | 接続 |
| --- | --- |
| AE-BME280 | I2C0、SDA=GP8、SCL=GP9、アドレス`0x76` |
| QT095B SSD1331 | SPI0、SCK=GP6、MOSI=GP7、MISO=GP4、CS=GP5、D/C=GP2、RESET=GP3 |
| GT-502MGG-N GPS | UART0、Pico TX=GP0→GPS RXD、Pico RX=GP1←GPS TXD、9600 bps、PPS=GP14 |
| OSTAMC5A31A-VV RGB LED | PWM赤=GP18、PWM緑=GP20、PWM青=GP22、共通カソード=GND |

MicroPython側は同じプログラム内で`I2C(0)`と`SPI(0)`を生成できる。「BME280＋SSD1331」作例は、
BME280の補正値を使って温度、湿度、気圧を読み取り、その数値をRGB565フレームとしてSSD1331へ送る。

UART0は初版の1 peer規則によりGT-502MGG-Nだけへ接続する。PPSは`gpio-driver`としてGP14へ接続し、
`Pin(14, Pin.IN).value()`からポーリングする。9600 bpsのGGA/RMCは公開単調増加時計を同期的に評価して
1 Hzで更新する。従来の115200 bps UARTエコー作例はモデル内の互換モードで維持する。判断と時間境界は
ADR 0025および0026を参照する。

既存PWM作例用のGP16インジケーターは維持し、RGB LEDは未使用だったGP18、GP20、GP22へ別インスタンス
として接続する。3色はカソードコモンのためPWM High側で発光する。各PWMの周波数共有やGPIOの電気特性は
現在のConnection Modelで再現しない。判断はADR 0027を参照する。

## ブラウザ編集と保存

`connection-project:v1`は`ConnectionGraphV1`に保存日時と保存形式の版を付けたブラウザ内形式である。
保存容量は64 KiBを上限とし、読み込み時とWorker起動時の両方で形式と資源競合を検査する。不正または
非互換な保存データは自動削除せず、管理版グラフへフォールバックして理由を表示する。

接続エディターはノードとSVG配線を表示するが、ノード座標や線の制御点は保存しない。I2C0は同じバス端子
から複数ターゲットへ分岐し、各ターゲットの7-bitアドレスはDevice Definitionと照合する。

## 現在の制限と移行方針

- Connection Modelは公開Device SDKに含めない。
- 初期カタログは管理版に組み込んだDeviceインスタンスに限定する。
- 同じDevice Definitionから任意個数のインスタンスを追加する機能と線のドラッグ操作は未対応である。
- 電源、GND、プル抵抗、電圧、配線長、電気的誤配線は扱わない。
- 旧`dev:device`のローカル未承認デバイスは互換変換によってI2C0へ接続し、管理版グラフの正本へ混入させない。

複数ローカルデバイスをsourceと配線から起動するLocal Device Configuration v1はLocal Previewとして
実装している。ローカルpathをこのグラフへ直接保存せず、専用構成を検証してから有効な内部グラフへ変換する。詳細は
`docs/local-device-configuration-v1.md`とADR 0024を参照する。

将来の保存形式更新では、存在しないDevice版、利用できないBoard Profile、非互換な接続をデータを失わず
表示する。Board Profile APIの公開とConnection Modelの公開は、Device API v1とは独立して判断する。
