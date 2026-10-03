# ADR 0016: 公開Device APIと承認済み・ローカル配布経路を分離する

- 状態: Accepted
- 日付: 2026-08-29

## 背景

個別の仮想デバイスを第三者が開発できる公開APIが必要である。一方、管理版Web Labが任意の第三者
JavaScriptを動的に読み込むと、制限付きMicroPythonから除外したDOM、ネットワーク、ストレージなどへの
経路をデバイス拡張から再導入する可能性がある。

初版のMicroPython側ハードウェアモデルはRaspberry Pi Pico 2 Wとする。将来は別ボードへ切り替えられる
必要があるが、1種類の実装だけを根拠にBoard Profile APIを公開仕様として固定すると、Pico固有の都合を
汎用契約へ持ち込むおそれがある。

## 決定

Device API v1の標準開発言語をTypeScript、実行形式をES Modules、マニフェストをJSON、MicroPython側
ドライバーをPythonとする。公開Device APIはWorker通信プロトコルとBoard Profile実装から分離する。

初版は`raspberry-pi-pico-2-w-v1`だけを選択可能にする。Device Modelは原則としてボード名ではなく、
GPIO observer、GPIO driver、ADC source、I2C target、SPI target、UART peer、PWM observerの能力を
要求する。Board Profile APIは第2のボードを
実装して差異を確認するまで内部の試験的境界とし、Device APIとは独立して版管理する。

管理版Web LabはGitHub Pull Requestでレビューし、Managed Catalogへ固定したデバイスだけをビルド時に
組み込む。任意URLやパッケージを管理版ブラウザから動的に読み込まない。第三者は公開SDKとテンプレートを
使い、ローカル開発モードで未承認デバイスを試験できる。第三者が独自に静的ビルドを配信するセルフホストも
許容するが、管理版の承認済みビルドと区別して表示する。

Device UIは宣言的な許可済み部品に限定し、デバイス実装へDOM、任意ネットワーク、ストレージ、汎用
JavaScriptブリッジを渡さない。TypeScript型検査だけを安全性の根拠とせず、固定ソース、適合テスト、
ライセンス確認、管理者レビューを承認条件とする。

公開する初版仕様と公開条件の正本を`docs/device-api-v1.md`とする。

## 結果

- 第三者は管理版内部へ依存せず、同じAPIでローカル開発とPull Request提案を行える。
- 管理版の利用者は、レビュー済み・固定済みデバイスだけを読み込む。
- 未承認デバイスの公開は管理版オリジンと分離され、承認状態を自己申告できない。
- Device API v1を保ったまま、後からBoard Profileと対応ボードを追加できる。
- 初版では承認済みデバイスとMicroPythonを同じWorkerで実行するため、デバイス単位の障害分離は残課題となる。
- 動的な有料デバイス、署名付きパッケージ、未承認コードのサンドボックス実行は別途設計する。

## 関連文書

- `docs/device-api-v1.md`
- `docs/architecture.md`
- `docs/threat-model.md`
- `docs/adr/0015-model-i2c-as-an-extensible-virtual-bus.md`
