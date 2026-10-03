# ADR 0029: 機能ポート単位の接続エディターを追加する

- 状態: Accepted
- 日付: 2026-10-03

## 背景

管理版デバイスの配線は`ConnectionGraphV1`へ移行済みだが、画面では読み取り専用だった。利用者が
Picoと外部デバイスの接続を試すには、ソースや構成ファイルを編集せず、複数デバイスを1つのバスへ
接続できる画面が必要である。

一方、Web Labの目的は命令・クロック単位のMCUや電気回路シミュレーションではない。電源、GND、電圧、
抵抗、配線長、波形などを回路CADとして扱うと、Device APIの機能レベルモデルと責任が重複する。

## 決定

管理版`ConnectionGraphV1`を実行時配線の正本として維持し、HTMLとSVGだけでNode-RED風の接続
エディターを追加する。新しいUI依存パッケージは導入しない。

- 左側にPico 2 WのGPIO、ADC、I2C、SPI、UART、PWM機能ポートを表示する。
- 右側に管理版Deviceインスタンスを表示し、接続の有無と割り当て先をフォームで編集する。
- SVGの線はグラフから導出して表示し、線自体を永続データにしない。
- I2CとSPIは1つのcontroller端子から複数デバイスへ分岐できる。
- I2Cアドレス重複、GPIO占有、UART peer数などは既存resolverで適用前に検査する。
- 「配線を適用」で版付きデータをブラウザへ保存し、Workerを再生成する。
- ローカルDevice構成は構成ファイルを正本とし、ブラウザUIでは読み取り専用にする。

ブラウザ保存形式`connection-project:v1`は`schemaVersion`、`savedAt`、`ConnectionGraphV1`を持ち、
64 KiBを上限とする。不正データは削除せず管理版配線へフォールバックし、理由を表示する。Worker起動
プロトコルv11は省略可能な`connectionGraph`を追加し、Workerでも既存の検証と資源解決を行う。

## 精度境界

接続エディターはDevice Modelの論理ポートだけを扱う。LEDの電流制限抵抗、I2Cのプルアップ、電源、GND、
電圧、電流、配線長、ノイズ、信号波形はモデル化しない。必要な受動部品はデバイス側へ含まれる前提とする。

初期カタログは管理版に組み込まれたDeviceインスタンスに限定する。同一Device Definitionから任意個数の
インスタンスを生成する機能、第三者パッケージのブラウザ取り込み、線のドラッグ操作は次段階で検討する。

## 結果

- I2C0へI2CレジスタとBME280を同時接続するような共有バス構成を視覚的に確認できる。
- デバイスの切断、GPIO/PWM割り当て変更、検証、保存、Worker反映をブラウザ内で完結できる。
- 永続化するのは意味的な接続だけで、ノード座標や描画線は保存しない。
- 既存の機能レベル境界を保ち、完全な電子回路シミュレーターにはしない。

## 関連文書

- `docs/adr/0023-introduce-an-internal-connection-model.md`
- `docs/adr/0024-configure-multiple-local-devices-outside-device-packages.md`
- `docs/connection-model-v1.md`
- `docs/architecture.md`
- `docs/threat-model.md`
