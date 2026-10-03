# ADR 0012: 同一オリジン中心の制限付き配信ポリシーを適用する

- 状態: Accepted
- 日付: 2026-08-28

## 背景

M7でMicroPythonから汎用JavaScriptとネットワーク用モジュールを除外したが、ページへ別の
JavaScriptが混入した場合や、意図しない外部資源、iframe、ブラウザ機能が利用された場合の防御は
HTTP配信層にも必要である。Web Labは同一オリジンのJavaScript、WASM、Worker、静的コンテンツだけで
動作するため、既定拒否の配信ポリシーを適用できる。

## 決定

配信ヘッダーの正本を`config/security-headers.mjs`に置き、Viteの開発・プレビュー環境とNginx設定例で
同じ値を使用する。Nginx側との一致は`pnpm test:headers`で検査する。

Content Security Policyは`default-src 'none'`から始め、次の機能だけを許可する。

- JavaScript、CSS、画像、Worker、通信は同一オリジンだけを許可する。
- WebAssemblyのコンパイルに`'wasm-unsafe-eval'`を許可する。
- 汎用JavaScript文字列評価の`'unsafe-eval'`とインライン実行の`'unsafe-inline'`は許可しない。
- object、iframe、フォーム送信、外部フォントとメディアを禁止する。
- `frame-ancestors 'none'`と`X-Frame-Options: DENY`で他サイトからの埋め込みを拒否する。

COOP `same-origin`、COEP `require-corp`、CORP `same-origin`を組み合わせ、同意のないクロスオリジン
資源を同じブラウザ実行コンテキストへ取り込まない。Permissions Policyではカメラ、位置情報、
マイク、決済、USB、Serial、HIDを無効にする。HSTS、MIME sniffing防止、Referrer Policyも適用する。

開発サーバーだけはViteのHot Module Replacementに必要な`ws:`接続と、CSS更新で生成するインライン
`style`要素を追加で許可する。`style`属性は開発時も禁止する。本番相当の統合テストは`vite preview`を
使用し、追加権限のないポリシーでWASMとWorkerが動くことを確認する。

## 結果

- XSSや依存物混入が発生した場合に利用できる資源とブラウザ機能を狭められる。
- WebAssemblyは動作するが、通常の`eval()`や`Function()`はCSPで許可されない。
- 将来、外部CDN、解析サービス、決済UI、外部画像を追加する場合はCSPとCOEPへの明示的な変更が必要になる。
- Web SerialやWebHIDで実機連携する場合もPermissions Policyの設計変更が必要になる。
- M8以降はクロスオリジン分離を仮想入力用`SharedArrayBuffer`の機能要件としても利用する。
- CSP違反レポートの収集先、TLS証明書の自動更新、Nginx自体の強化は本ADRの対象外とする。

## 関連文書

- `docs/threat-model.md`
- `docs/deployment.md`
- `docs/adr/0010-build-a-restricted-micropython-runtime.md`
