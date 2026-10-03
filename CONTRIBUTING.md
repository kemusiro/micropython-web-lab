# Contributing

MicroPython Web LabへのIssueとPull Requestを歓迎する。公開アルファ前後は、セキュリティ、データ損失、
起動・復旧不能、複数利用者が迷う操作を優先する。提案された機能をすべて採用することは保証しない。

質問、個別環境の相談、対象外となる依頼は[SUPPORT.md](SUPPORT.md)を確認する。

## 開発を始める

```sh
./scripts/setup-node.sh
./scripts/use-node.sh pnpm install --frozen-lockfile
./scripts/use-node.sh pnpm dev
```

Node.jsは`.node-version`、pnpmは`package.json`の`packageManager`で固定する。リポジトリ内のNode.jsと
pnpmコマンドは原則として`./scripts/use-node.sh`経由で実行する。

## 変更の原則

- UI、Worker、仮想ボード、仮想デバイスの境界を維持する。
- Worker内だけをユーザーソースや設定の正本にしない。
- ユーザーコードへDOM、任意ネットワーク、秘密情報を公開しない。
- バグ修正には可能な限り回帰テストを追加する。
- 外部コード、画像、データシート等を追加する前に再配布条件を確認する。
- MicroPython、Node.js、pnpm等の固定版を変更する場合は、再現手順と関連文書も更新する。

詳細は`AGENTS.md`を参照する。

## 検証

変更した層に最も近いテストを実行し、提出前に可能な範囲で次を実行する。

```sh
./scripts/use-node.sh pnpm check
```

ブラウザテストを実行できない場合は、Pull Requestに理由と未検証範囲を記載する。
提出後はGitHub Actionsの`Verify public repository`が同じ全検査を実行する。

## IssueとPull Request

Issueには目的、期待した結果、実際の結果、ブラウザとOS、再現手順を記載する。秘密情報やソース全文を
貼り付けない。Pull Requestは一つの目的に限定し、互換性、保存形式、セキュリティ境界への影響を説明する。

セキュリティ問題は公開Issueではなく`SECURITY.md`の方法で報告する。

## コミュニティでの振る舞い

Issue、Pull Request、レビューでは、技術的な内容とプロジェクトの目的に集中し、相手の経験、背景、言語、
意見の違いを尊重する。嫌がらせ、個人攻撃、差別、脅迫、個人情報の無断公開、執拗な宣伝は認めない。
保守者は、プロジェクトと参加者の安全を守るため、投稿の編集依頼、非表示、会話のロック、参加制限を行う
ことがある。

公開Issueへ個人情報や秘匿すべき被害内容を書かない。独立した行動規範を採用する場合は、非公開の通報経路と
対応責任者を同時に明示する。
