# ADR 0021: Device SDKの公開予定名、配布先、ライセンス、リポジトリ構成を決める

- 状態: Accepted
- 日付: 2026-08-30

## 背景

M11.4でDevice API、適合テストキット、I2Cテンプレート、ローカル開発環境の技術項目が完成した。
Public Previewへ移行する前に、公開時のパッケージ名と配布先、リポジトリとSDKのライセンス、承認済み
デバイスの管理場所を決める必要がある。

一方、Web Lab本体はもう少し完成度を上げてから公開する。npmは、将来利用だけを目的とするOrganization名の
予約を禁止し、合理的な期間内にパッケージが公開されないOrganizationをスクワッティングと判断する場合が
ある。そのため、公開まで期間がある現時点で、名前の確保だけを目的にnpm Organizationを作るべきではない。

## 決定

Device SDKの総称を「MicroPython Web Lab Device SDK」とする。次を公開予定パッケージ名として、内部の
importと検証に継続して使用する。

- `@micropython-web-lab/device-api`
- `@micropython-web-lab/device-testkit`

正式な配布先はnpmの公開Organizationスコープ`@micropython-web-lab`とし、ソース、仕様、変更履歴は
`micropython-web-lab`のGitHubリポジトリを正本とする。ただし、npm Organizationは現時点では作成しない。
Public Previewのリリース作業で名前の利用可否を再確認し、Organization作成と実用的なPreviewパッケージの
公開を連続して行う。予定名を利用できない場合は暗黙に別名へ変更せず、新しい判断として記録する。

リポジトリ本体、Device API、適合テストキット、テンプレート、公式リファレンスデバイスにはMIT Licenseを
適用する。ライセンス決定と公開時期は分離し、非公開期間中もMIT Licenseを明記する。第三者デバイスは
マニフェストにSPDX識別子を記載し、Managed Catalogへの採用時にWeb Labで再配布できるかを別途審査する。
クローズドソースの商用デバイスは、署名、配布、利用権、失効の設計が完成するまで初版カタログへ含めない。

初版はモノレポ構成を維持する。SDK、適合テストキット、テンプレート、Managed Catalog、公式および承認済み
デバイスを同じリポジトリで管理し、カタログと成果物の変更を同じPull Requestで検証する。第三者は採用前の
デバイスを自身のリポジトリとローカルWeb Labで開発できる。デバイス数、成果物サイズ、権限分離の必要性が
増えた場合の別リポジトリ化は、初版公開後の移行判断とする。

Public Previewまで、SDKとテストキットの`private: true`を維持する。MIT Licenseへの変更を、npm publishの
許可や互換性保証とは扱わない。Public Previewのリリース作業では少なくとも次を行う。

1. npm上で予定スコープとパッケージ名の利用可否を再確認する。
2. npm Organizationを作成し、Organizationメンバーの2要素認証を必須にする。
3. 公開対象のtarball、依存関係、ライセンス、秘密情報の非混入を確認する。
4. 公開対象パッケージだけ`private: true`を解除する。
5. Organization作成後、実用的なPreview版を公開し、出典と版を検証する。

## 結果

- 内部コードは予定名を維持でき、公開時期を早めずにパッケージ境界を継続して検証できる。
- npmの名前予約だけを目的とするOrganizationを作らないため、スクワッティング方針へ抵触するリスクを避ける。
- MIT Licenseにより、SDK、テンプレート、リファレンス実装の利用条件が公開前から明確になる。
- `private: true`とSDK検証により、ライセンス適用後も誤publishを防止する。
- 初版はカタログとデバイスを同じPull Requestで扱え、複数リポジトリ間の同期を必要としない。
- 予定スコープを取得できないリスクはPublic Preview直前まで残るため、リリース作業で再確認が必要になる。

## 参照

- [npm Username Policy](https://docs.npmjs.com/policies/disputes/)
- [npm Organizations](https://docs.npmjs.com/organizations/)
- [Requiring two-factor authentication in your organization](https://docs.npmjs.com/requiring-two-factor-authentication-in-your-organization/)

## 関連文書

- `docs/device-api-v1.md`
- `docs/device-development.md`
- `docs/architecture.md`
- `docs/adr/0016-define-a-curated-public-device-api.md`
- `docs/adr/0020-extract-private-preview-device-sdk.md`
