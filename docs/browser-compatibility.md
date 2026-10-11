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

## YM2203追加後のローカル候補（2026-10-12）

未コミットの作業ツリーから`build:sakura`で生成した候補を、ループバックの静的配信で確認した。
以前の固定コミットの実URL検証とは別の結果。この最初の候補の後に、下記のHTTPSリハーサルと
Safariで発見した問題の修正を実施した。

| OS・CPU | 製品版ブラウザ | 確認した版 | 最終結果 |
| --- | --- | --- | --- |
| macOS 27.0.1 arm64 | Chrome | 154.0.8037.98 | 全E2E 110項目成功 |
| macOS 27.0.1 arm64 | Edge | 155.0.4283.45 | 全E2E 110項目成功 |

両ブラウザをheadlessの独立セッションで実行し、失敗・スキップ・再試行による成功は0件。
AudioWorkletのFM／SSG波形とRMS、131,071イベントの転送、音源側ループ、10秒を超える連続試聴、
ミュートと音量の独立性、音色編集、保存、停止・再起動と失敗からの復旧を確認した。
実スピーカーの音量・聴感と実チップとの比較、24時間の実時間連続運転を保証する結果ではない。

予備検証で連続予約テストが前の演奏の完了状態を拾ったため、各予約の命令番号を確認してから
その番号の完了を待つように修正した。修正後はChrome／Edge各3回と最終全E2Eで成功。

同じ成果物をローカルの`/lab/`へ配置した追加確認も、両ブラウザで成功。
`/lab/`と`/lab/index.html`の起動、保存後の再読込み、ライセンス参照、未知のWASMの404、
専用試作ページのFM／SSG再生を確認した。これは実Apache・HTTPS配信の検証の代替ではない。

この最初の候補ではWindows 11は未確認。FirefoxのWebDriverプロファイル起動失敗と
Safariのリモートオートメーション無効により、自動化した製品版検証は実行できなかった。
その後、製品版のGUIを独立したプライベートウィンドウで確認した結果は次の節へ記録する。

## YM2203のHTTPSリハーサル候補（2026-10-12）

最初の候補をGUIで検証すると、Safari 27.0.1で音源ドライバー呼び出しと12段のPython関数呼び出しに
`RangeError: Maximum call stack size exceeded`が発生した。固定上流ソースと既存パッチを保ち、
WASMのリンク時にも`-Os`を加えると、隔離ビルドと正式な生成手順の両方で解消した。
ヒープ、Asyncify退避領域、公開するAPIは変更していない。
関数呼び出しとGCで生存オブジェクトを保持し、その後も実行できる回帰検証を追加した。

修正候補は未コミットの作業ツリーから`build:sakura`で生成したもの。
ZIPのSHA-256は`35d8d3bd8da8fcae553cd87d758f263d13efcbc6c9867450a1cca3524b57562f`。
既存の公開サイトを入れ替えず、別のBasic認証付きHTTPS領域へ同じ18ファイルを配置した。
未認証401、認証後の全ファイルハッシュ、MIME型、ヘッダー、HTTPからHTTPSへの転送、未知のWASMの404を確認。
既存サイトの配信ファイルと共通認証設定のハッシュが変わっていないことも確認した。

| OS・CPU | 製品版ブラウザ | 確認した版 | 修正候補の結果 |
| --- | --- | --- | --- |
| macOS 27.0.1 arm64 | Chrome | 154.0.8037.98 | ローカル全E2E 111項目、HTTPSの47項目成功 |
| macOS 27.0.1 arm64 | Edge | 155.0.4283.45 | ローカル全E2E 111項目、HTTPSの47項目成功 |
| macOS 27.0.1 arm64 | Firefox | 157.0 | ローカル配信のGUI検証8項目成功 |
| macOS 27.0.1 arm64 | Safari | 27.0.1 | ローカル配信のGUI検証8項目成功 |

Chrome／Edgeはheadlessの独立セッションで実行し、ローカル222項目とHTTPSの94項目は
いずれも失敗・スキップ・再試行による成功0件。HTTPSでは音源関連、保存、停止・復旧、GC、
配信ヘッダーを対象にした。最終HTTP検査では一度接続がタイムアウトし、再実行で全ファイル検査が成功した。
単体306項目、配信検査10項目、固定ランタイム検査、TypeScript、通常／Sakuraビルド、
SDKとローカルDeviceの検査・統合テストも成功した。Sakuraビルドを再生成して18ファイルの一致を再確認した。

Firefox／Safariでは起動とPython実行、12段の呼び出し中のGC、初期ミュート、FMだけの比較メロディー、
SSGだけの予約演奏、全イベントの完了と消音、無限ループの停止と消音、再起動後の実行を確認した。
GUI検証は固定候補をループバックの`no-store`配信で読み込み、アクセシビリティの音声RMSと描画された
出力を確認したもの。Chrome／Edgeの全E2E、実URLでの確認、大容量転送、連続試聴の代替とは扱わない。
最初の既存ローカル配信ではSafariのCOEPによるWorker読み込み失敗も観測したため、
別ポートの同一候補で切り分けた。Safariの実URLでの再読込みは追加確認として残す。

FirefoxのWebDriver起動問題とSafariの自動化設定は未解消。Windows 11実機、24時間の実時間連続運転、
実スピーカーの聴感と実YM2203との比較も未確認。認証を解除した本番切り替えは実施していない。

## 最新main統合後の本公開（2026-10-12）

`main`の`bfa051c`を取り込み、3ペイン画面、専用配線画面、明示的な保存、復元用下書き、
構文色分けとデバッグ行表示を保持した候補を公開した。YM2203の音声パネルもカードの折りたたみへ連動する。
未コミットの作業ツリーから生成したZIPのSHA-256は
`9558c2df3bca400169667a7e5bc0843cabc5683fd2eadafc9c45829cb544ac02`。
本公開URLは <https://lab.asamomiji.jp/lab/>。認証なしのHTTPS接続と全18ファイルの一致を確認した。
旧配信物を公開領域外へ退避し、開いたままのページが使う旧アセットは保持した。共通認証設定は変更していない。

HTTPS検証で、配線変更によるWorker再起動中に音源サンプルを開くと追加したライブラリが届かない問題を発見した。
インストール後のスナップショットでWorkerを起動し直すよう修正し、ダウンロードを保留する回帰テストで
修正前の失敗と修正後の成功を確認した。デバッグ行位置の検証はスクロールイベントによる描画同期を待つよう変更した。

| OS | 製品版ブラウザ | 確認した版 | この候補の結果 |
| --- | --- | --- | --- |
| macOS 27.0.1 arm64 | Chrome | 154.0.8037.98 | ローカル149項目、認証付きHTTPS85項目、本公開10項目成功 |
| macOS 27.0.1 arm64 | Edge | 155.0.4283.45 | ローカル149項目、認証付きHTTPS85項目、本公開10項目成功 |
| macOS 27.0.1 arm64 | Firefox | 157.0 | ローカルGUI8項目、本公開GUI8項目成功 |
| macOS 27.0.1 arm64 | Safari | 27.0.1 | ローカルGUI8項目、本公開GUI8項目成功 |
| Windows 11 Pro 25H2、ビルド26200.9457 | Edge | 154.0.4258.53（64ビット） | RDP経由の本公開GUI9項目成功 |

Chrome／Edgeのローカル298項目、認証付きHTTPS170項目、本公開20項目は、失敗・スキップ・再試行による成功0件。
単体322項目（57ファイル）、配信検査10項目、型検査、両ビルド、固定ランタイム、ライセンス、SDKと
ローカルDevice検査・統合テストも成功した。Sakuraビルドを再生成して18ファイルの一致を再確認した。

Firefox／Safariの本公開GUIでは、起動、12段の関数呼び出しとGC、初期ミュート、FMとSSGの個別RMS、
再読込みでの下書き・配線保持、ミュートからの再演奏、停止・Worker再起動を確認した。
Safariの公開URL再読込みでは、先に観測したCOEPによるWorker読み込み失敗は再現しなかった。
これは将来のキャッシュやネットワーク条件まで保証する結果ではない。

Windows 11のEdgeでは、標準Pythonサンプル、音源の結線と初期ミュート、FM比較演奏と予約完了、SSG矩形波、
11秒を超える連続試聴、MIDI音符72から60への変更追従、試聴停止、楽曲演奏中の停止・再起動後の再演奏、
Pocket Signalの全960イベント完了、明示的な保存と再読込みを確認した。9シナリオとして記録した。
RDP入力の修飾キー・記号変換にずれがあり、任意コード入力は検証対象から外し、用意したサンプルとGUI操作を使った。
Windows Chromeは今回の候補では未確認。音声RMS・波形・状態の確認であり、実スピーカーの聴感、実チップ比較、
24時間の実時間連続運転は未確認である。Firefox WebDriverとSafariの自動化設定についても前節の制約が残る。

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
YM2203の初期ミュート、FM／SSGそれぞれの予約音声出力・完了、停止と再起動も確認する。
この製品版検証はChrome／Edgeの全E2Eと同じ網羅範囲ではなく、大容量転送や連続試聴は含まない。
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

Windows 11実機で修正候補を手動確認する場合は、OSのビルドとChrome／Edgeの版を記録し、
それぞれ新しいプライベートウィンドウで認証付きリハーサルを開く。次を確認する。

1. 起動後の`print(6 * 7)`が42を表示する。
2. YM2203を接続して配線を適用すると実行可能になり、スピーカーは初期ミュートになる。
3. ミュートを解除し、音源カードの比較サンプルでFMだけ、SSGだけのメロディーを確認する。
4. 音色エディターの連続試聴が10秒を超えて継続し、パラメータ変更へ追従する。
5. 演奏中の停止で音が消え、再起動後に同じサンプルを再実行できる。
6. 保存して再読込みしてもソースと配線を保持し、スピーカーはミュートから始まる。

この手動確認は全E2Eの代替ではなく、実機での最低限の確認記録とする。

## 一次資料

- [Playwrightのブラウザと製品版チャンネル](https://playwright.dev/docs/browsers)
- [Apple: Testing with WebDriver in Safari](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari)
- [Mozilla geckodriver](https://github.com/mozilla/geckodriver/releases)
- [Windows 2025ランナーの収録ソフトウェア](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
