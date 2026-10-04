# Third-Party Notices

MicroPython Web Lab本体にはMIT Licenseを適用する。以下は、リポジトリへ同梱する生成物と、その生成に
使用する主要な第三者ソフトウェアの出典およびライセンス情報である。

## MicroPython

- Project: MicroPython
- Upstream: <https://github.com/micropython/micropython>
- Version: v1.28.0
- Commit: `e0e9fbb17ed6fd06bb76e266ae554784c9c80804`
- Source archive: <https://github.com/micropython/micropython/archive/refs/tags/v1.28.0.tar.gz>
- License: MIT License。上流ツリー内の第三者コードに関する概要を含む正確な本文は
  [`runtime/micropython/LICENSE`](runtime/micropython/LICENSE)を参照する。
- Distributed artifacts: `src/vendor/micropython-build/micropython.mjs`、
  `src/vendor/micropython-build/micropython.wasm`

生成物には`web-lab-restricted` variantと、WebAssemblyポートへ適用する最小パッチを使用している。
固定値、入力アーカイブとLICENSEのSHA-256、生成物SHA-256は
[`runtime/micropython/versions.env`](runtime/micropython/versions.env)と
[`runtime/micropython/artifacts.sha256`](runtime/micropython/artifacts.sha256)を正本とする。

## Emscripten

- Project: Emscripten
- Upstream: <https://github.com/emscripten-core/emscripten>
- Version: 6.0.6
- Usage: MicroPython WebAssembly生成時のビルドツール。Emscripten本体はこのリポジトリへ同梱しない。
- License: MIT LicenseおよびUniversity of Illinois/NCSA Open Source License。正確な本文は
  [`runtime/emscripten/LICENSE`](runtime/emscripten/LICENSE)を参照する。

Emscriptenの上流LICENSEには、Emscriptenが利用するNode.js由来コードと、同梱するmusl libcに関する
通知も含まれる。

## JavaScript build and test toolchain

ルート`package.json`には実行時のnpm依存関係を置いていない。次の直接依存は、開発、ビルド、型検査、
テストに使用する。Viteはビルド時に生成コードを出力へ加える場合があるため、配布物の監査対象にも含める。

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Browser end-to-end tests |
| `typescript` | 7.0.2 | Apache-2.0 | Type checking and compilation |
| `vite` | 8.3.1 | MIT | Development server and production bundling |
| `vitest` | 5.0.3 | MIT | Unit and integration tests |

`pnpm-lock.yaml`にはこれらが解決する推移的な開発依存関係も記録される。各パッケージの正確なライセンス
本文と追加通知は、固定バージョンの配布パッケージを参照する。`scripts/verify-third-party-notices.mjs`は、
直接依存の追加、版またはライセンス識別子の変更、NOTICEとの不一致を検出する。

## Device names, datasheets, and trademarks

Raspberry Pi is a trademark of Raspberry Pi Ltd.

MicroPython Web Labは非公式プロジェクトであり、MicroPythonプロジェクト、MicroPython.org、
Raspberry Pi Ltd、秋月電子通商、および記載する部品・コントローラのメーカーとの提携、承認、後援を
示すものではない。その他の製品名、会社名、商標は各権利者に帰属する。

AE-BME280、QT095B／SSD1331、GT-502MGG-N、OSTAMC5A31A-VVの名称は、互換対象となる実製品または
部品を識別する目的で参照的に使用している。製品ページとデータシートの出典は次の文書に記載する。

- [`docs/devices/ae-bme280.md`](docs/devices/ae-bme280.md)
- [`docs/devices/qt095b-ssd1331.md`](docs/devices/qt095b-ssd1331.md)
- [`docs/devices/gt-502mgg-n.md`](docs/devices/gt-502mgg-n.md)
- [`docs/devices/ostamc5a31a-vv.md`](docs/devices/ostamc5a31a-vv.md)

このリポジトリは、各社の製品画像またはデータシートPDFを複製しておらず、外部の公開ページへリンクする。
仮想デバイスのコードと画面表現は、このプロジェクトが作成した学習用の機能モデルであり、実製品の電気特性、
タイミング、全機能を再現するものではない。
