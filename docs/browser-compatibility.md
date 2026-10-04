# ブラウザとOSの検証

公開αの対応対象はWindows 11とApple Silicon Mac上のmacOSとする。Intel Macはサポート対象外である。
実行した環境と未確認の環境を区別し、ブラウザエンジンのテストだけで製品版ブラウザの対応を宣言しない。

## 公開αの対応表

2026-10-04に、Basic認証下の固定コミット`24464a4`で次の製品版ブラウザを確認した。

| OS・CPU | ブラウザ | 確認した版 | 実URLで確認した範囲 |
| --- | --- | --- | --- |
| Windows 11 x64 | Chrome | 154.0.8037.97 | 公開α表示、起動、レイアウト、ADC入力、Worker再生成（8シナリオ） |
| Windows 11 x64 | Edge | 154.0.4258.53 | 公開α表示、起動、レイアウト、ADC入力、Worker再生成（8シナリオ） |
| macOS arm64 | Chrome | 154.0.8037.93 | 管理版の機能・配信検証48項目 |
| macOS arm64 | Firefox | 157.0 | 起動、共有入力、ソフトリセット、UART、BME280、失敗表示と復旧（7シナリオ） |
| macOS arm64 | Safari | 26.6.2 | 公開α表示、起動、REPL、ソフトリセット、Python例外表示と復旧（4シナリオ） |

同じ固定コミットについて、Windows Server 2025のGitHub ActionsではChrome／Edgeの管理版E2E 51項目と
Firefoxの製品版検証10項目も完走した。このCI結果はWindows 11実機の確認を補うが、実機確認の代替とは
扱わない。

## ChromeとEdge

インストール済みの製品版ChromeとEdgeで、通常の管理対象ビルドの全E2Eを実行する。
REPL、保存、デバッグ、仮想デバイス、共有入力、リセット、無限ループ／大量出力からの復旧、
配線編集、レイアウトに加え、分離ヘッダー欠落とWASM／Worker読み込み失敗を確認する。

```sh
./scripts/use-node.sh pnpm exec playwright test --config playwright.compatibility.config.ts
```

一方だけなら`--project chrome`または`--project edge`を付ける。
`test-results/compatibility.json`の環境添付に実際のブラウザ版、OS版、CPUを記録する。
既定の`pnpm check`は引き続きPlaywright Chromiumを使う。

## 製品版FirefoxとSafari

PlaywrightのFirefoxとWebKitは、それぞれ製品版FirefoxとSafariの代替検証とは扱わない。
インストール済みブラウザを公式のWebDriverで起動し、独立したテストセッションで確認する。
追加の本番依存パッケージは不要。

```sh
./scripts/use-node.sh pnpm build:sakura
# 別端末で公式geckodriverを起動
geckodriver --port 4444
# 検証端末
./scripts/use-node.sh node scripts/verify-native-browser.mjs
```

Safariは設定で「リモートオートメーションを許可」を一時的に有効にする。
必要なOS認証は利用者が行い、終了後に設定を元に戻す。他のセキュリティ制限は解除しない。

```sh
# 別端末
/usr/bin/safaridriver --port 4445
# 検証端末
WEB_LAB_BROWSER=safari WEB_LAB_WEBDRIVER=http://127.0.0.1:4445 \
  ./scripts/use-node.sh node scripts/verify-native-browser.mjs
```

起動、ADC／GPIOの実行中入力、UART入力、BME280入力、ソフトリセット、Python例外、
分離ヘッダー欠落、WASM／Worker失敗表示と復旧を確認する。
`WEB_LAB_DIST`で検証対象の固定成果物ディレクトリ、`WEB_LAB_BROWSER_REPORT`でJSON結果の
保存先を指定できる。既定は`dist`と`test-results/native-<browser>.json`。
テストサーバーはループバックにのみバインドし、成果物を編集せず応答へ障害を注入する。
実サーバーの設定、認証、配信内容は変更しない。

## OSの範囲

`Browser compatibility`ワークフローは`windows-2025`上でChrome、Edge、Firefoxを実行する。
Unix専用の`use-node.sh`に代わり、この使い捨てWindowsランナーだけは`setup-node`とCorepackで
`.node-version`と`packageManager`の固定版を使用する。Firefox driverも版とSHA-256を固定する。
OS・ブラウザ版とテスト結果は`windows-browser-compatibility-chrome-edge`と
`windows-browser-compatibility-firefox` artifactへ保存する。

Windows 11実機ではIME合成、タッチ、GPU依存描画を確認していない。macOSの結果は確認したarm64環境の
範囲であり、Intel Macへ一般化しない。Intel Macは公開αのサポート対象外とする。
実URLのHTTPS、認証、ヘッダー、ファイルハッシュは[配信手順](deployment.md)で別途確認する。
公開αの正式な対応表には、実行結果のある具体的な環境だけを記載する。

## 一次資料

- [Playwrightのブラウザと製品版チャンネル](https://playwright.dev/docs/browsers)
- [Apple: Testing with WebDriver in Safari](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari)
- [Mozilla geckodriver](https://github.com/mozilla/geckodriver/releases)
- [Windows 2025ランナーの収録ソフトウェア](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
