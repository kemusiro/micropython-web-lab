# ADR 0020: Device API型とマニフェスト検証をprivate Preview SDKへ切り出す

- 状態: Accepted
- 日付: 2026-08-30

> 2026-08-30追記: 公開予定名、npmへの公開方針、MIT License、モノレポ構成はADR 0021で決定した。
> 本ADRの`UNLICENSED`条件は履歴上の初期判断であり、現在は`private: true`を維持したMIT Licenseへ
> 置き換えられている。

## 背景

M11.2とM11.3ではDevice API型、Device Host、宣言型UIをWeb Lab内部に実装した。第三者がデバイスを
実装するには、Web Labの`src`を直接参照せずTypeScript型とJavaScript実行コードを利用できる独立した
SDK境界が必要である。また`device.json`は型注釈だけでは検証できないため、配布用JSON Schemaと実行時
検証器を同じ制約へ揃える必要がある。

一方、SDKの正式パッケージ名、公開先、リポジトリ本体とSDKのライセンスはまだ決定していない。
公開前判断ゲートを越えてnpmなどへ公開すると、名称やライセンスの変更が利用者へ破壊的な影響を与える。

## 決定

`packages/device-api`を独立ビルドできるSDKパッケージ境界とする。M11.4の内部Preview中は仮名
`@micropython-web-lab/device-api`、版`0.1.0-preview.0`、`private: true`、`UNLICENSED`とし、外部へ
publishしない。正式名、公開先、ライセンスが決定するまで、テンプレートを公開物として配布しない。

SDKはDOM、Node.js組み込みAPI、Web LabのWorkerプロトコルへ依存しないES Modulesと`.d.ts`を生成する。
Web Lab内部の`src/device-api/types.ts`はSDKの型と検証器を再exportし、内部と第三者向けで型の正本を
重複させない。Device Hostはデバイス生成前にSDKの`validateDeviceManifest()`を必ず通す。

マニフェストスキーマv1はDraft 2020-12 JSON Schemaとして同梱し、TypeScript検証器と次を共有する。

- 未知フィールドを許可しない。
- Device API版とSchema版は`1`だけを受理する。
- ID、Semantic Versioning、SPDXライセンス識別子、相対JavaScript entrypointを検証する。
- entrypointのディレクトリ遡及を許可しない。
- 7種類のポートだけを許可し、1デバイス1〜32ポートとする。
- `defaultAddress`はI2C targetだけに許可し、`0x08`〜`0x77`とする。
- 能力IDとポートIDの重複をTypeScript検証器で拒否する。
- JSONテキストはUTF-8で64 KiB以下とする。

検証後はマニフェスト、能力列、ポート列、各ポートをコピーしてfreezeする。呼び出し側が元の入力を
変更しても、Device Hostが使用する値は変化しない。

## 結果

- TypeScript利用者は生成された`.d.ts`、JavaScript利用者は同じパッケージのES Modulesを利用できる。
- Web Lab本体とSDKのマニフェスト解釈が同じ検証器を使う。
- JSON Schemaで表現できないポートID重複や64 KiBの入力テキスト上限は、実行時検証器で補完する。
- SDKビルドはDOMなしで型検査され、生成したJavaScriptをNode.jsからimportする回帰検査を持つ。
- 仮パッケージを誤って公開できない一方、正式名称・公開先・ライセンスが決まるまでM11.4を完了できない。
- 同じprivate Preview境界で適合テストキット、I2Cテンプレート、1コマンド検証を追加する。
- ローカルデバイスはVite仮想モジュールを介してWorkerへ組み込み、通常ビルドでは空に解決する。
- ローカル実行は未承認表示を必須とし、Node.js上の適合検査をサンドボックスとは扱わない。

## 関連文書

- `docs/device-api-v1.md`
- `docs/device-development.md`
- `docs/architecture.md`
- `docs/threat-model.md`
- `docs/adr/0016-define-a-curated-public-device-api.md`
- `docs/adr/0019-render-allowlisted-declarative-device-ui.md`
- `docs/adr/0021-decide-device-sdk-publication-policy.md`
