# Changelog

MicroPython Web Labの公開版で利用者に影響する変更を記録する。

このプロジェクトは公開準備中であり、安定版はまだリリースしていない。`Unreleased`の機能、UI、保存形式、
Device APIは、公開アルファまでに変更または削除される場合がある。リリース後は、版と公開日を付けた節へ
変更内容を移す。

## Unreleased

### Added

- さくらのレンタルサーバ向けビルド、Apache配信設定の生成、Basic認証付きリハーサル対応の公開URL検証コマンドと配信手順

- ブラウザ内のDedicated Web Workerで動作するMicroPython v1.28.0 REPL
- 複数タブのコードエディタ、通常実行、pdb互換のデバッグ実行
- 停止、Worker再生成、実行時間・出力量制限による復旧
- Pico 2 W向けGPIO、ADC、PWM、I2C、SPI、UARTの機能レベルモデル
- 複数デバイスの配線編集、デバイス操作、基本・連携サンプル
- 日本語・英語表示とレスポンシブなペイン配置
- ブラウザ内へのエディタと接続設定の保存

### Security

- MicroPythonをメインスレッドから分離し、汎用JavaScript・ネットワーク連携モジュールを除いた固定WASMを使用
- CSP、COOP、COEP、CORP、Permissions Policyを含む静的配信ヘッダー定義
- 公開候補ツリーの許可リスト生成、秘密情報パターン走査、第三者通知検査
