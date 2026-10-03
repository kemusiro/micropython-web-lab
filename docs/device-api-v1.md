# MicroPython Web Lab Device API v1 初版仕様

- 状態: Draft（リポジトリ内Preview）
- 対象リリース: Device API v1を初めて公開するリリース
- 基準日: 2026-08-29

## 1. この仕様の位置付け

この文書は、第三者がMicroPython Web Lab向けの仮想デバイスを開発するために、初版で公開すべき
契約を定める。リポジトリにはこの仕様へ適合するSDK、検証ツール、リファレンスデバイスを同梱しているが、
npmパッケージとしてのStable公開まではDraftとして扱う。

この仕様で「必須」と記載した要件は、管理版Web Labへデバイスを提案するための適合要件である。
「推奨」は互換性と保守性のために従うべき要件、「対象外」は初版が互換動作を保証しない機能を表す。

## 2. 目的

Device API v1は、次を目的とする。

- 第三者がWeb Lab本体の内部実装やDOMへ依存せず、仮想デバイスの状態遷移を実装できるようにする。
- 同じデバイスモデルを、承認済み管理版、開発者ローカル、第三者セルフホスト版で利用できるようにする。
- MicroPython側のコードを、可能な限りRaspberry Pi Pico 2 W実機と同じ`machine` APIで実行する。
- デバイスの動作モデル、ボードモデル、MicroPythonアダプター、表示UIを分離する。
- 公開APIの互換性と、管理版へ組み込むコードの安全性を別々に管理する。

Device API v1は、命令単位、クロック単位、電圧・電流などを再現する精密エミュレーターを目的としない。

## 3. 用語と責任分担

| 用語 | 意味 |
| --- | --- |
| Runtime Profile | MicroPythonの版、ビルド種別、利用可能なPythonモジュールを表す。初版は`micropython-1.28-restricted`だけを提供する。 |
| Board Profile | ピン、バス、内蔵デバイス、対応する`machine` APIを表す。初版は`raspberry-pi-pico-2-w-v1`だけを提供する。 |
| Device Model | 外付けデバイスの状態と、GPIO、ADC、I2C、SPI、UART、PWMに対する同期的な動作を実装する。 |
| Device UI | Device Modelの状態を表示し、許可された操作をDevice Modelへ渡す宣言的な画面定義である。 |
| Managed Catalog | 管理版Web Labへ組み込む、レビュー済みデバイスの固定一覧である。 |
| Local Catalog | 開発者のローカル環境だけで読み込む未承認デバイスの一覧である。 |

MicroPythonコードはDevice Modelを直接呼ばない。`machine.Pin`、`machine.ADC`、`machine.I2C`、
`machine.SPI`、`machine.UART`、`machine.PWM`などを
Board Profileが解決し、接続済みDevice Modelのポートへ処理を委譲する。

## 4. 初版の構成

```text
MicroPython v1.28 restricted runtime
    │ machine.Pin / ADC / I2C / SPI / UART / PWM
    ▼
Raspberry Pi Pico 2 W Board Profile v1
    │ negotiated device ports
    ▼
Device API v1
    ├─ GPIO observer
    ├─ GPIO driver
    ├─ ADC source
    ├─ I2C target
    ├─ SPI target
    ├─ UART peer
    └─ PWM observer
         ▼
Third-party Device Model
    │ flat serializable state + typed actions
    ▼
Declarative Device UI
```

公開Device APIとWorker通信プロトコルは別の契約とする。Device API v1のデバイスは、Web Lab内部の
通信プロトコルバージョンを参照してはならない。

## 5. 標準言語と配布形式

仮想デバイス実装の標準言語はTypeScriptとする。公開SDKはTypeScript型定義を含むES Modulesとして
提供し、生成されたJavaScriptをブラウザ内で実行する。公式仕様、リファレンス実装、テストは
TypeScriptを正本とする。

JavaScript実装もES Modulesとして受け入れられるが、公開SDKの`.d.ts`を利用して型検査に通す必要が
ある。MicroPython側のドライバーと作例はPython、デバイスマニフェストはJSONとする。

Device SDKの総称は「MicroPython Web Lab Device SDK」とし、公開予定パッケージ名は
`@micropython-web-lab/device-api`と`@micropython-web-lab/device-testkit`とする。正式な配布先はnpmの
公開Organizationスコープ、ソースの正本は本GitHubリポジトリとする。名前予約だけを目的とするnpm
Organizationは作成せず、Public Previewのリリース作業で名前の利用可否を再確認してから、Organization作成と
実用的なPreview版の公開を連続して行う。予定名を利用できない場合は、別の名前を新しい判断として記録する。

リポジトリ、SDK、適合テストキット、テンプレート、公式リファレンスデバイスはMIT Licenseとする。
公開対象パッケージはPublic Previewまで`private: true`を維持し、MIT Licenseへの変更をpublish許可や
互換性保証とは扱わない。公開方針と初版のモノレポ構成は
`docs/adr/0021-decide-device-sdk-publication-policy.md`を正とする。

## 6. デバイスパッケージ

初版の標準構成は次とする。

```text
example-device/
  ├─ device.json
  ├─ src/device.ts
  ├─ tests/device.test.ts
  ├─ examples/main.py
  ├─ README.md
  └─ LICENSE
```

管理版へ提案するデバイスは、実行時依存パッケージを持たず、Device APIだけを開発時依存にすることを
必須とする。依存パッケージが必要な場合は、Device API v1の通常審査とは別に、保守状況、ライセンス、
ブラウザ互換性、バンドルサイズ、攻撃面を審査する。

## 7. マニフェスト

`device.json`はUTF-8のJSONで、初版では64 KiB以下とする。未知のフィールド、重複する能力IDまたは
ポートID、不正な値を含むマニフェストは読み込まない。ポート数は1〜32とする。`entrypoint`は`./`から
始まるJavaScriptファイルへの相対パスとし、ディレクトリ遡及を許可しない。検証器は入力をコピーして
freezeし、呼び出し側による検証後の変更を反映しない。

```json
{
  "schemaVersion": 1,
  "id": "example.temperature-sensor",
  "version": "1.0.0",
  "deviceApiVersion": 1,
  "name": "Example Temperature Sensor",
  "description": "I2C temperature sensor for Device API examples",
  "license": "MIT",
  "entrypoint": "./dist/device.js",
  "requires": {
    "boardCapabilities": ["i2c-controller-v1"]
  },
  "ports": [
    {
      "id": "i2c",
      "kind": "i2c-target",
      "defaultAddress": 72
    }
  ]
}
```

### 7.1 識別子とバージョン

- `schemaVersion`はマニフェスト構造の版であり、初版は整数`1`とする。
- `id`は小文字の逆ドメイン形式または同等に衝突しにくい名前とし、一度公開した意味を再利用しない。
- `version`はデバイス実装のSemantic Versioningとする。
- `deviceApiVersion`は公開APIのメジャー版であり、初版は整数`1`とする。
- `license`はSPDXライセンス識別子とする。管理版への組み込み可否は別途ライセンス審査で決める。

承認状態、価格、購入状態、署名検証結果をデバイス自身のマニフェストへ持たせてはならない。これらは
Managed Catalogまたは将来の利用権管理層が決定する。

### 7.2 ポート種別

Device API v1は次のポートを定義する。方向はMicroPythonを実行するボード側から見た意味ではなく、
Device Modelが提供する振る舞いを明示した名称とする。

| `kind` | Device Modelの役割 | 代表例 |
| --- | --- | --- |
| `gpio-observer` | ボードが出力した0または1を観測する | LED、リレー |
| `gpio-driver` | ボードが入力として読む0または1を供給する | ボタン、デジタルセンサー |
| `adc-source` | ボードがADCとして読む0〜65,535の整数を供給する | 可変抵抗、アナログセンサー |
| `i2c-target` | 7-bitアドレスで同期的なI2Cターゲット動作を提供する | センサー、表示器、メモリ |
| `spi-target` | ボードからの全二重SPI転送に対して同じ長さの受信バイト列を返す | 表示器、メモリ、SPIセンサー |
| `uart-peer` | ボードが送信したバイト列を受け取り、ボードの受信キューへバイト列を供給する | GPS、シリアルセンサー、モデム |
| `pwm-observer` | ボードが出力するPWMの有効状態、周波数、デューティ比、反転設定を観測する | 調光LED、ブザー、サーボ |

デバイスは複数のポートを持てる。接続時に各ポートをBoard Profile上のピンまたはバスへ割り当てる。
同じcontrollerのI2C信号とSPI信号は共有できるが、I2Cアドレス、SPI CS、排他的GPIOなどの競合、
未対応機能、不正なアドレスを実行前に拒否する。管理版の内部実装は`ConnectionGraphV1`として分離するが、
この接続形式はPublic Preview前のDevice SDK契約には含めない。

## 8. TypeScript API

以下はDevice API v1が公開する契約の概念形である。実装上の正本は`packages/device-api`の型定義と
JSON Schemaである。命名の軽微な調整は可能だが、Stable公開後の破壊的変更はDevice API v2で行う。

```ts
export type DigitalValue = 0 | 1;
export type DeviceStateValue = string | number | boolean | null;
export type DeviceState = Readonly<Record<string, DeviceStateValue>>;

export interface DeviceAction {
  readonly controlId: string;
  readonly value: DeviceStateValue;
}

export interface DeviceLimits {
  readonly maxI2cTransferBytes: number;
  readonly maxSpiTransferBytes: number;
  readonly maxUartTransferBytes: number;
  readonly maxUartBufferedBytes: number;
  readonly maxStateBytes: number;
}

export interface DeviceBoardContext {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly capabilities: readonly string[];
}

export interface DeviceClock {
  monotonicMilliseconds(): number;
}

export interface DeviceContext {
  readonly instanceId: string;
  readonly board: DeviceBoardContext;
  readonly limits: DeviceLimits;
  readonly clock?: DeviceClock;
  emitState(state: DeviceState): void;
}

export interface DeviceDefinition {
  readonly manifest: DeviceManifestV1;
  create(context: DeviceContext): DeviceModel;
}

export interface DeviceModel {
  readonly ports: Readonly<Record<string, DevicePort>>;
  reset(): void;
  handleAction?(action: DeviceAction): void;
  dispose?(): void;
}
```

### 8.1 単調増加時計

`DeviceContext.clock`は、捕捉待ち、周期出力、ポーリング信号など、経過時間に依存するDevice Model向けの
単調増加時計である。既存のDevice Modelと旧テストホストを壊さないよう省略可能な追加とし、Web Labの
Device Hostは常に提供する。Device API v1のメジャー版は変更しない。

`monotonicMilliseconds()`は0以上の有限なミリ秒値を返し、同じDevice Hostの存続中に後退してはならない。
これは日時、UTC、タイムゾーン、タイマー登録、コールバックを提供せず、DOM、ネットワーク、Worker APIへ
到達する権限も与えない。値は実数を許可し、Device Modelが必要な分解能へ丸める。

時間依存モデルはポート操作またはDevice Actionの同期境界で時計を読み、経過した状態を決定論的に評価する。
WorkerのJavaScriptタイマーだけへ依存してはならず、読み取りが長時間なかった期間のイベントを無制限に
蓄積しない。時計がない旧ホスト上で動かす必要があるモデルは、安全な静止状態へフォールバックする。
テストでは`@micropython-web-lab/device-testkit`の`ManualDeviceClock`を使い、壁時計を待たずに時間を進める。

### 8.2 ポートAPI

```ts
export interface GpioObserverPort {
  readonly kind: "gpio-observer";
  write(value: DigitalValue): void;
}

export interface GpioDriverPort {
  readonly kind: "gpio-driver";
  read(): DigitalValue;
}

export interface AdcSourcePort {
  readonly kind: "adc-source";
  readU16(): number;
}

export interface I2cTargetPort {
  readonly kind: "i2c-target";
  readonly addresses: readonly number[];
  read(byteCount: number): Uint8Array;
  write(data: Uint8Array): void;
  readMemory(memoryAddress: number, byteCount: number): Uint8Array;
  writeMemory(memoryAddress: number, data: Uint8Array): void;
}

export interface SpiConfiguration {
  readonly baudrate: number;
  readonly polarity: 0 | 1;
  readonly phase: 0 | 1;
  readonly firstBit: "msb" | "lsb";
  readonly bits: 8;
}

export interface SpiTargetPort {
  readonly kind: "spi-target";
  configure(configuration: SpiConfiguration): void;
  transfer(writeData: Uint8Array): Uint8Array;
}

export interface UartConfiguration {
  readonly baudrate: number;
  readonly bits: 8;
  readonly parity: "none" | "even" | "odd";
  readonly stop: 1 | 2;
}

export interface UartPeerPort {
  readonly kind: "uart-peer";
  configure(configuration: UartConfiguration): void;
  writeFromBoard(data: Uint8Array): number;
  availableToBoard(): number;
  readForBoard(maxBytes: number): Uint8Array;
}

export interface PwmSignal {
  readonly enabled: boolean;
  readonly frequencyHz: number;
  readonly dutyU16: number;
  readonly inverted: boolean;
}

export interface PwmObserverPort {
  readonly kind: "pwm-observer";
  update(signal: PwmSignal): void;
}

export type DevicePort =
  | GpioObserverPort
  | GpioDriverPort
  | AdcSourcePort
  | I2cTargetPort
  | SpiTargetPort
  | UartPeerPort
  | PwmObserverPort;
```

すべてのポート処理は同期的でなければならない。Promise、バックグラウンドタイマー、実時間精度を
Device API v1の動作契約に含めない。初期管理版では、I2Cアドレスを`0x08`〜`0x77`、メモリアドレスを
8-bit、I2CとSPIの1回の転送を最大256バイトとする。`spi-target.transfer()`は入力と同じ長さの
`Uint8Array`を返さなければならない。`configure()`は8-bit、クロック極性・位相、ビット順、要求
ボーレートを通知するが、初版は転送時間と電気波形を再現しない。SPIのチップセレクトは暗黙にポートへ
含めず、デバイスの`gpio-observer`を任意のCSピンへ接続する。

UARTは`writeFromBoard()`の1回の入力と`readForBoard()`の1回の出力を最大256バイト、ボードへ供給する
受信待ちデータを1デバイス当たり最大4,096バイトとする。キューが上限を超える動作は黙って古いデータを
捨てず、デバイスまたはホストが拒否して診断できるようにする。`availableToBoard()`と
`readForBoard()`は同じ状態を参照し、戻り値は要求された`maxBytes`以下とする。データがない読み取りは
空の`Uint8Array`を返す。`configure()`はボーレート、8データビット、パリティ、ストップビットを通知
するが、初版は伝送時間を再現しない。

PWMの`frequencyHz`は正の有限数、`dutyU16`は0〜65,535の整数とする。`enabled`が`false`の間も最後に
設定した値を保持できるが、出力中とはみなさない。すべてのポートはホストが示す`DeviceLimits`を超える
要求を拒否する。

## 9. 状態とUI

Device ModelとDevice UIは同じオブジェクトを共有しない。Device Modelは`emitState()`で状態の
スナップショットを発行し、ホストが検証、順序番号付与、UI反映を行う。

Device API v1の状態は、キーが文字列、値が文字列、有限数、真偽値、`null`のいずれかである平坦な
オブジェクトに限定する。関数、DOMノード、TypedArray、循環参照、入れ子オブジェクトを状態へ含めない。
初期管理版ではJSON直列化後16 KiB以下とし、I2C、SPI、UARTの転送データ本体、ユーザーのPythonソース、
秘密情報を表示用状態へ自動複製しない。デバイスが必要な場合は、上限内の件数、最新値、要約など、
表示目的を説明できる派生状態だけを明示的に発行する。

UIは初版で次の宣言的部品だけを提供する。

- 状態テキスト
- 0または1を表すインジケーター
- 押している間だけ有効になるボタン
- 最小値、最大値、刻み幅を持つ数値スライダー
- 最大256文字の短いテキスト入力

管理版ホストはSSD1331の評価用に、最大16,384ピクセルの`rgb332-base64`だけを描画する試験的な
`pixel-display`を固定UIとして持つ。これはDevice SDK v1の公開UI契約ではなく、第三者マニフェストから
指定できない。公開部品へ昇格するか、独立Renderer APIとするかは、状態帯域と更新頻度を評価して別途決める。

UI操作は`DeviceAction`としてモデルへ渡す。デバイス実装へDOM、CSSセレクター、イベントオブジェクト、
任意HTMLを渡さない。表示器など専用描画が必要な部品は、状態容量と描画境界を個別に設計してDevice API
v1の後方互換な追加または次期APIとする。

管理版のDevice ModelはMicroPythonと同じDedicated Worker内で実行する。メインスレッドのUI操作は
ホストが型と上限を検証し、版付きの共有入力領域または上限付き共有キューへ反映する。MicroPythonの
同期ポート読み取り時に、ホストが未適用の操作をDevice Modelへ渡してから値を返す。Device Model自身へ
`SharedArrayBuffer`、`Atomics`、Workerメッセージを公開しない。

共有入力を利用できないブラウザでは、出力観測だけを行うデバイスは継続利用できるが、実行中のPythonへ
同期入力するUI部品を無効にし、必要なクロスオリジン分離を画面へ表示する。単一値の入力は最新値と単調
増加する版、UARTなど順序が必要な入力は容量上限と読み書き位置を持つキューとして扱う。キューあふれを
暗黙にデータ欠落として処理しない。

## 10. Raspberry Pi Pico 2 W Board Profile v1

初版で選択できるボードはRaspberry Pi Pico 2 Wだけとする。プロファイルIDは
`raspberry-pi-pico-2-w-v1`とし、RP2350ベースのPico 2 Wとしてピン名と内蔵デバイスを解決する。
無線モデルのオンボードLEDはGP25ではなく無線チップ側の`WL_GPIO0`であり、`Pin("LED")`をこの
内蔵LEDへ割り当てる。

Board Profile v1はPico 2 Wの完全なMCUエミュレーションを意味しない。Device API v1公開時に必須と
する機能レベルのシミュレーション範囲は次とする。

| 機能 | 初版の範囲 |
| --- | --- |
| Digital GPIO | 外部へ公開されたGP0〜GP22、GP26〜GP28と`LED`別名。入出力、値、基本プル指定を扱う。 |
| ADC | GP26／ADC0の`read_u16()`。0〜65,535へ正規化した値を返す。 |
| I2C | I2C0、既定SDA=GP8、SCL=GP9、7-bitアドレス、基本転送と8-bitメモリ転送。 |
| SPI | SPI0、SCK=GP6、MOSI=GP7、MISO=GP4、8-bit転送。`polarity`、`phase`、MSB／LSB、`read()`、`readinto()`、`write()`、`write_readinto()`を扱う。CSは`Pin`で個別に操作する。 |
| UART | UART0、TX=GP0、RX=GP1、8データビット、パリティなし・偶数・奇数、1または2ストップビット。`any()`、`read()`、`readinto()`、`readline()`、`write()`、`deinit()`を上限付き受信キューで扱う。 |
| PWM | 外部GPIOに対する`PWM(Pin)`、`init()`、`deinit()`、`freq()`、`duty_u16()`、`duty_ns()`、`invert`。Device Modelへ正規化した周波数と16-bitデューティ比を通知する。 |
| Built-in device | `WL_GPIO0`へ接続したオンボードLED。 |

Board Profileは物理ピン番号、GPIO番号、電源ピン、GND、特殊ピンを区別し、存在しないGPIOや競合する
割り当てを拒否する。初版はボード選択欄とプロジェクト形式に`boardProfile`を保持するが、受け付ける
値はこの1種類だけとする。

管理版は内部Connection Modelから固定配線を解決し、同じグラフを読み取り専用UIへ表示する。現段階では
接続グラフをプロジェクトへ保存せず、利用者による配線編集も提供しない。詳細は
`docs/connection-model-v1.md`を参照する。

SPIの`read()`は送信フィル値、`readinto()`は受信先、`write_readinto()`は同じ長さの送受信バッファを
Device APIの全二重転送へ正規化する。UARTの読み取りは、その時点で受信キューにあるデータだけを返し、
空ならMicroPython APIから`None`を返す。`timeout`と`timeout_char`は設定として受け付けられるが、
初版は壁時計時間を待機せず、再現可能な非ブロッキング動作として扱う。PWMの`duty_ns()`は現在の
周波数を使って0〜65,535へ正規化し、波形そのものは生成しない。

次は初版の対象外である。

- I2C1、SoftI2C、SPI1、SoftSPI、UART1、PIO、IRQ、Timer、RTC、WDT
- SPIの8-bit以外のワード長、複数ターゲットを自動選択するCS、UARTのIRQ・フロー制御・反転・break・実時間timeout、PWMの共有ジェネレーター結合
- GP27、GP28、内部温度センサー、VSYSのADC入力
- Wi-Fi、Bluetooth、`network`、CYW43439内部SPI
- CPUコア、クロック、RAM、Flash、DMA、USBの精密なモデル
- 電圧、電流、プル抵抗値、通信波形、ノイズ、故障、実時間タイミング

これらを後から追加しても既存の必須メソッドと意味を変えない場合、Device API v1の後方互換な拡張と
する。別ボードの追加だけを理由にDevice API v2へ上げない。

## 11. 将来のボード切り替え

Device API v1のデバイスは、特定ボードIDではなく`digital-gpio-v1`、`adc-input-v1`、
`i2c-controller-v1`、`spi-controller-v1`、`uart-controller-v1`、`pwm-output-v1`など、
ボード側に必要な能力を原則として要求する。Device Modelが提供する
`gpio-observer`や`i2c-target`などのポート種別とは区別する。ボード固有のデバイスだけが明示的な
Board Profileを要求できる。

Board Profile APIは初版ではWeb Lab内部の試験的境界とし、公開APIとして固定しない。第2のボードを
実装してPico 2 Wとの差異を検証した後、Device APIとは独立した`boardApiVersion`を持つ公開仕様に
する。この手順により、将来M5StackやESP32系ボードを追加しても、対応能力を満たすDevice API v1の
外付けデバイスを再利用できる。

## 12. 配布モード

### 12.1 管理版Web Lab

管理版はManaged Catalogに固定された承認済みデバイスだけをビルド時に組み込む。ブラウザで任意URL、
npmパッケージ名、Gitリポジトリを入力してデバイスを動的に読み込む機能は提供しない。

Managed Catalogは少なくとも、デバイスID、版、出典リポジトリ、固定Gitコミット、成果物SHA-256、
承認状態、失効状態を持つ。承認状態はデバイスマニフェストの自己申告では決定しない。

### 12.2 ローカル開発版

公開SDKとテンプレートは、第三者がローカルパスのデバイスを読み込んでWeb Lab上で試験できる
コマンドを提供する。想定する操作は次である。

```sh
pnpm create micropython-web-lab-device my-device
cd my-device
pnpm test
pnpm dev
```

またはWeb Lab本体の開発環境から次の形式で読み込む。

```sh
pnpm dev:device -- ../my-device
```

リポジトリのローカル開発経路では、後者を`pnpm dev:device -- <device-directory>`として実装する。先に1コマンド検査を
実行し、検証済みエントリポイントをDedicated Workerへ組み込む。デバイスパスはプロセス環境だけで渡し、
ローカルカタログ設定や管理版成果物へ保存しない。画面へ「ローカル開発モード」「未承認デバイス」と
常時表示し、ローカルコードを承認済みとして表示しない。単一Device互換経路で自動接続するローカルポートは
I2C Bus 0のtargetである。複数のローカルDevice packageと全ポート配線は、Local Previewの
`web-lab.local.json`と`dev:devices`で扱う。詳細は`docs/device-development.md`を参照し、構成仕様は
`docs/local-device-configuration-v1.md`を正とする。
このローカル構成形式はDevice API v1の公開契約やブラウザ保存形式には含めない。

### 12.3 セルフホスト版

第三者は公開SDKを使った独自Web Labを自分のドメインで静的配信できる。管理版とは異なるビルド種別と
カタログ出典を画面に表示し、MicroPython、Raspberry Pi、管理版Web Labの承認を受けたものと誤認させない。

## 13. 管理版への承認

管理版への追加はGitHub Pull Requestで提案する。自動検査と管理者レビューでは次を確認する。

1. マニフェストのJSON Schema検証とID重複検査
2. TypeScript型検査、format、lint、単体テスト
3. Device API適合テストとPico 2 W接続検査
4. `reset()`後の初期状態と、同じ操作列・転送列に対する再現可能な状態遷移
5. 未知の操作、不正値、未接続ポート、転送上限に対する安全な失敗
6. MicroPython作例によるブラウザ統合テストとWorker再生成
7. DOM、ネットワーク、ストレージ、動的コード実行など禁止機能の使用有無
8. 実行時依存、バンドルサイズ、ライセンス、著作権表示、再配布条件
9. README、Python作例、接続方法、実機との差異と既知の制約
10. 固定コミットと生成成果物ハッシュ

CI合格は承認を意味しない。管理者は、保守可能性、教育上の価値、重複、セキュリティ、ライセンスを
確認して採否を決める。不具合や脆弱性が判明したデバイスはManaged Catalogで失効できるようにする。

## 14. セキュリティ境界

TypeScriptの型検査はセキュリティサンドボックスではない。Device API v1は能力を明示的に渡す方式とし、
デバイス実装へ次を公開しない。

- DOM、`window`、`document`
- `fetch`、XMLHttpRequest、WebSocket、任意ネットワーク
- localStorage、IndexedDB、Cookie、認証情報
- Worker、`postMessage`、SharedArrayBufferそのもの
- MicroPythonインスタンス、汎用JavaScriptブリッジ
- `eval`、`Function`、動的モジュールURL、追加WebAssembly
- Node.js組み込みモジュールとビルドホストのファイルシステム

管理版はレビュー済みソースを固定して静的ビルドする。未承認コードを管理版オリジンへ動的に読み込まない。
ローカル版では開発者自身のコードを信頼するが、第三者から取得した未承認パッケージの実行は一般的な
ソフトウェア実行と同じ危険を伴うことを表示する。

デバイスモデルが例外、無限ループ、大量状態更新を起こした場合は、Workerを破棄して復旧する。初版では
承認済みデバイスとMicroPythonが同じWorker内で動くため、デバイスごとの完全な障害分離は保証しない。
未承認コードを管理版で動的に安全実行する仕組みは、別Worker、同期通信、署名、利用権管理を含めて
将来設計する。

## 15. 互換性規則

- SDKパッケージはSemantic Versioningを使用する。
- `deviceApiVersion`は破壊的変更でだけ増やす。
- 新しい任意フィールド、ポート種別、UI部品は既存デバイスを壊さない場合にv1へ追加できる。
- 必須メソッドの削除、引数や戻り値の意味変更、同期APIの非同期化はDevice API v2とする。
- Device API、Board Profile、Runtime Profile、マニフェストスキーマ、Workerプロトコルの版を混同しない。
- v1ホストは未対応の`deviceApiVersion`、必須能力、ポート種別を持つデバイスを読み込まない。

## 16. Device API v1公開条件

次が揃うまで、この文書の状態はDraftとする。

- 公開TypeScript型定義とマニフェストJSON Schema
- デバイス開発テンプレートとローカル開発コマンド
- DOM非依存の適合テストキット
- LED、ボタン、ADC、I2Cレジスタ、SPIレジスタ、UARTエコー、PWMインジケーターのリファレンス実装
- 公開API利用例として、補正レジスタとMicroPython作例を備えたAE-BME280 I2Cモデル
- 公開SPI／GPIOポート利用例として、RGB565作例を備えたQT095B SSD1331モデル
- Pico 2 W Board Profileによるピン・バス検証
- Managed Catalogと固定成果物の検証処理
- 少なくとも1件のMicroPythonブラウザ統合テスト
- 公開APIの利用手順、セキュリティ制約、ライセンス方針
- 脅威モデルとADRの更新

公開条件を満たした変更で状態をStableへ更新し、以後はこの互換性規則に従う。

## 17. 参照資料

- [MicroPython v1.28.0 machine API](https://docs.micropython.org/en/v1.28.0/library/machine.html)
- [MicroPython v1.28.0 machine.SPI](https://docs.micropython.org/en/v1.28.0/library/machine.SPI.html)
- [MicroPython v1.28.0 machine.UART](https://docs.micropython.org/en/v1.28.0/library/machine.UART.html)
- [MicroPython v1.28.0 machine.PWM](https://docs.micropython.org/en/v1.28.0/library/machine.PWM.html)
- [MicroPython v1.28.0 RP2 quick reference](https://docs.micropython.org/en/v1.28.0/rp2/quickref.html)
- [Raspberry Pi Pico-series boards](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html)
- [Raspberry Pi Pico 2 W datasheet](https://datasheets.raspberrypi.com/picow/pico-2-w-datasheet.pdf)
- [秋月電子 AE-BME280](https://akizukidenshi.com/catalog/g/g109421/)
- [Bosch Sensortec BME280 data sheet](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf)
- [秋月電子 QT095B SSD1331 RGB OLED](https://akizukidenshi.com/catalog/g/g114435/)
- [Solomon Systech SSD1331 Rev 1.2 data sheet](https://akizukidenshi.com/goodsaffix/ssd1331.pdf)
- `docs/architecture.md`
- `docs/threat-model.md`
- `docs/adr/0015-model-i2c-as-an-extensible-virtual-bus.md`
- `docs/adr/0017-introduce-the-pico-2-w-board-profile.md`
- `docs/adr/0021-decide-device-sdk-publication-policy.md`
