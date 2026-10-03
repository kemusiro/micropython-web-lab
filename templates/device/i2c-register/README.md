# I2C Register Device Template

Device API v1で最小のI2Cレジスタデバイスを作るための内部Previewテンプレートです。

このテンプレートと公開予定のDevice SDKはMIT Licenseである。現在のSDKは`private: true`の
Internal Previewであり、npmから導入できるPublic Previewや互換性保証済みのStable版ではない。
リポジトリ内では次の1コマンドでビルド、マニフェスト、モデル、Python作例を検査できる。

```sh
./scripts/use-node.sh pnpm verify:device-template
```

ローカルWeb Labで試す場合は次を実行します。このコマンドは依存パッケージのインストールや、デバイス側の
パッケージライフサイクルスクリプトを自動実行しません。適合検査とWeb Lab実行のため、ビルド済みの
DeviceDefinition自体は読み込んで実行します。信頼できるコードだけを指定してください。

```sh
./scripts/use-node.sh pnpm dev:device -- templates/device/i2c-register
```

画面には「ローカル開発モード」「未承認デバイス」と常時表示されます。ローカルデバイスコードは
MicroPythonと同じWorker内で動作し、管理版への承認や安全性を意味しません。
