# MicroPython Web Lab

**日本語** | [English](README.en.md)

MicroPython Web Labは、ブラウザ内のDedicated Web WorkerでMicroPythonを実行する、非公式の開発・学習環境です。
MicroPythonプロジェクト、MicroPython.org、Raspberry Pi Ltd、記載するデバイスメーカーの公式プロジェクト
ではなく、各社との提携や承認を示すものではありません。

Raspberry Pi is a trademark of Raspberry Pi Ltd.

## はじめて使うとき

保存済みコードのないブラウザでは「はじめの実験」を表示します。「実行」で内蔵LEDを点滅させ、
`interval_ms = 500`の500を200へ変えて再実行すると、コードの変更と結果を体験できます。
配線編集やデバイス一覧は「ワークスペースを開く」から利用できます。停止・エラー確認・再起動は
実験画面でも操作できます。エディタからはEscを押してからTabでフォーカスを移動できます。

次の「ボタンを試す」では、実行後8秒間、仮想の押しボタンを押す・離す操作を繰り返せます。
状態が変わるたび、出力・REPLに`Button: pressed`または`Button: released`を表示します。
終了後も「スクリプトを実行」で再度試せます。

画面を切り替えても、編集内容、Pythonの実行状態、配線設定は保持します。選んだ画面はブラウザ内に
独立した表示設定として保存します。従来の保存済みコードがある場合とローカルDevice開発モードは、
ワークスペースを既定とします。「はじめの実験」を開き直すと専用のサンプルタブを用意し、既存の
コードを置き換えません。実験の案内は再読み込みで最初の段階へ戻り、編集内容は保持します。
保存形式が不正な場合はワークスペースで既存のエラーを表示します。

## 主な機能

- ブラウザ上のMicroPython REPL
- 複数タブ対応コードエディタと通常実行・デバッグ実行
- 停止、Ctrl+Dによるリセット、Worker再生成、実行時間と出力量の制限
- Pico 2 Wを対象とした機能レベルのGPIO、ADC、PWM、I2C、SPI、UARTモデル
- 仮想デバイスの配線編集とサンプルコード
- ブラウザ内へのエディタと接続設定の保存
- 日本語・英語表示

命令単位、クロック単位、電気特性を再現する完全なMCU／電子回路シミュレーターではありません。
LEDなどの部品は、学習用途に必要な範囲で抵抗等を内蔵した機能モデルとして扱います。

REPLの空の主プロンプトでCtrl+Dを押すと、Workerを再生成してPythonの変数と実行状態を初期化します。
エディタ内容と配線設定は保持します。複数行入力の空の継続プロンプトでのCtrl+Dは、その入力を実行します。
大量出力は標準出力・標準エラーの合計100,000文字で打ち切り、自動復旧します。

通常のワークスペースで画面の高さが足りない場合はページを縦にスクロールして操作できます。幅960px以上の画面では、
コード領域に約10行、REPLに約6行の最低作業高さを確保します。作業画面上部の「通常」
「エディタを広く」「REPLを広く」で表示を切り替えられ、コード、入力途中の内容、実行状態は保持します。
幅960px未満では、拡大表示中は仮想ボードも折りたたみ、通常表示で戻します。
表示の切り替えはページ内だけに適用し、再読み込み後は通常表示に戻ります。「停止」は作業画面を
スクロールしている間も上部に表示します。

## 公開αと対応環境

このプロジェクトは公開αです。画面、機能、ブラウザ内の保存形式は変更される可能性があります。
エディタと配線設定はブラウザ内にだけ保存され、端末間の同期やサーバー側バックアップはありません。
ブラウザデータの削除や保存形式の変更に備え、大切なコードは別の場所にも保存してください。

公開αの対応対象は、Windows 11のChrome／Edgeと、Apple Silicon Mac上のmacOSの
Chrome／Firefox／Safariです。Intel Macはサポート対象外です。確認したOS・ブラウザ版と検証範囲、
IME合成・タッチ入力・GPU固有動作などの未確認事項は
[ブラウザとOSの検証](docs/browser-compatibility.md)を参照してください。

## 開発環境

Node.jsとpnpmはプロジェクトで固定した版を使用します。グローバル環境を変更せず、次のコマンドで
セットアップと開発サーバー起動を行えます。

```sh
./scripts/setup-node.sh
./scripts/use-node.sh pnpm install --frozen-lockfile
./scripts/use-node.sh pnpm dev
```

ブラウザで`http://127.0.0.1:4173/`を開きます。SharedArrayBufferを使用するため、開発サーバーと
本番配信ではCOOP、COEP等のセキュリティヘッダーが必要です。

## 検証

```sh
./scripts/use-node.sh pnpm check
```

個別には、単体テスト、型検査とビルド、ブラウザテストを実行できます。

```sh
./scripts/use-node.sh pnpm test
./scripts/use-node.sh pnpm build
./scripts/use-node.sh pnpm test:e2e
```

製品版Chrome・Edge・Firefox・SafariとOS別の確認方法は
[ブラウザとOSの検証](docs/browser-compatibility.md)を参照してください。

## 静的配信

さくらのレンタルサーバ向けには`./scripts/use-node.sh pnpm build:sakura`で配信用成果物を生成します。
Basic認証で制限したリハーサルにも対応します。配置、HTTPS設定、公開後の検証は[配信手順](docs/deployment.md)を参照してください。

## セキュリティとプライバシー

MicroPythonコードはブラウザ内で実行し、通常の利用ではエディタ内容やREPL履歴をサーバーへ送信しません。
ユーザーコードにはDOM、任意ネットワーク、ブラウザストレージ全体を公開しない設計です。ただし、
ブラウザ内実行だけで完全なサンドボックスを保証するものではありません。

設計上の信頼境界と既知の制約は[脅威モデル](docs/threat-model.md)、脆弱性の報告方法は
[SECURITY.md](SECURITY.md)を参照してください。

現在の構成と各層の責任は[アーキテクチャ](docs/architecture.md)を参照してください。

## コントリビューション

開発方針と確認手順は[CONTRIBUTING.md](CONTRIBUTING.md)および[AGENTS.md](AGENTS.md)を参照してください。
仮想デバイスの契約とローカル検証方法は[Device API v1仕様](docs/device-api-v1.md)と
[Device開発ガイド](docs/device-development.md)を参照してください。

不具合報告、機能提案、一般的な質問の範囲と、回答を保証しない事項は[SUPPORT.md](SUPPORT.md)を
参照してください。公開版の変更は[CHANGELOG.md](CHANGELOG.md)へ記録します。

## ライセンス

このリポジトリ本体はMIT Licenseです。同梱するMicroPython成果物と第三者コードには、それぞれの
ライセンスが適用されます。詳細は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)と各ディレクトリの
ライセンス表示、版情報を確認してください。
