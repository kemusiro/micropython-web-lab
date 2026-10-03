# ADR 0022: 表示器を上限付きピクセルプレビューとして描画する

- 状態: Accepted
- 日付: 2026-08-30

## 背景

SSD1331を使うQT095B RGB OLEDをDevice APIのSPIサンプルとして追加するには、コマンドや転送回数だけでなく
表示結果を確認できる必要がある。ADR 0019で定めた5種類の宣言部品は低帯域の値と入力を対象にしており、
ピクセル表示を持たない。一方、Device ModelへCanvasや描画コールバックを公開すると、DOM非依存、固定DOM、
許可リストという境界を崩す。

Device API v1の状態は平坦なプリミティブ値、JSON直列化後16 KiB以下である。96×64 RGB565は生データだけで
12,288バイトだが、文字列へBase64化すると16 KiBを超える。表示器のために状態形式やWorkerプロトコルを
破壊的に変えることも避ける必要がある。

## 決定

SSD1331 Device Modelは内部でRGB565を保持し、UI通知時だけRGB332へ量子化する。6,144バイトの固定長を
Base64文字列にして既存の`DeviceStateValue`として発行する。表示OFF中は黒画面を発行し、表示状態を別の
真偽値でも通知する。CSがHighへ戻るまではフレーム状態を通知せず、SPI転送単位の再描画を避ける。

管理版の宣言型レンダラーへ、Internal Experimentalの`pixel-display`部品を追加する。部品は幅、高さ、
状態キー、固定符号化`rgb332-base64`だけを持ち、総ピクセル数を16,384以下に制限する。状態ビューはBase64
形式と符号化後の長さを検証し、レンダラーは部品自身が作った固定サイズのCanvas 2Dへだけ展開する。
Device Modelと宣言にはCanvas、描画API、DOM、任意HTML、CSS、JavaScriptを公開しない。

この部品を`@micropython-web-lab/device-api`へは追加しない。Device SDK v1、マニフェスト、ポート、状態形式、
Workerプロトコルの外部仕様は変更しない。初版管理版に固定したSSD1331 UIだけで実績を得て、第三者向けの
表示器UIは状態帯域、更新頻度、アクセシビリティ、複数表示方式を評価してから後方互換なv1追加、独立した
Renderer API、またはDevice API v2のいずれかを別途決定する。

## 結果

- SSD1331は既存のSPI targetとGPIO observerだけで実装され、公開Device API v1の適合検査を通過する。
- 96×64の表示結果を既存の16 KiB状態上限内で確認できる。
- 16-bit色から8-bit色への量子化があるため、UIプレビューは実機の65K色を完全には再現しない。
- ピクセル数、データ長、符号化を固定し、任意の描画コードを実行しない。
- 高解像度、高頻度、複合入力を持つ表示器はこの仕組みに追加せず、将来のRenderer API検討に残す。

## 関連文書

- `docs/devices/qt095b-ssd1331.md`
- `docs/device-api-v1.md`
- `docs/architecture.md`
- `docs/threat-model.md`
- `docs/adr/0019-render-allowlisted-declarative-device-ui.md`
