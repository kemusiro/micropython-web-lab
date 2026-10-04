# 静的配信の準備

## 前提

Web Labは静的ファイルとして配信し、サーバー側では利用者のPythonコードを実行しない。VPSでは
`pnpm build`で生成した`dist`をNginxからHTTPS配信する。さくらのレンタルサーバでは、
以下の専用ビルドとApache用設定を使用する。

## さくらのレンタルサーバ

### ビルドと配置

```sh
./scripts/use-node.sh pnpm install --frozen-lockfile
./scripts/use-node.sh pnpm check
./scripts/use-node.sh pnpm build:sakura
```

`build:sakura`は型検査と公開対象検査を行い、相対URLの成果物と`dist/.htaccess`を生成する。
ドメイン直下と`/lab/`などのサブディレクトリに同じ成果物を配置できる。通常の`build`を実行すると
`dist`が再生成されるため、アップロード直前は必ず`build:sakura`を使用する。
Node.jsはローカルのビルドと検証にだけ必要で、サーバーでは実行しない。

1. 専用ドメイン／公開フォルダを用意し、SSL証明書を設定する。HSTSがホスト全体に適用されるため、
   同じホストの他のパスもHTTPSで利用できることを確認する。
2. コントロールパネルの「ドメイン/SSL」→対象ドメインの「設定」→「基本設定」で
   「HTTPS転送設定」を有効にする。独自の転送規則を重ねない。
3. 現行成果物と既存`.htaccess`を公開フォルダの外へバックアップする。
4. `dist`の**中身すべて（隠しファイルの`.htaccess`を含む）**を公開フォルダへ転送する。
   リポジトリ、`.git`、`node_modules`、設定用の秘密情報は転送しない。
   既存サイトの`.htaccess`へ無条件に上書きせず、専用フォルダを使う。
5. 更新時はassetsを先に、`index.html`を最後に転送する。旧assetsは開いている画面から参照される
   可能性があるため即時削除しない。不具合時はバックアップした成果物と設定を一式戻す。

`.htaccess`は`config/security-headers.mjs`から生成し、COOP・COEP・CSP等を既存配信と一致させる。
WASMとJavaScriptのMIME型、ディレクトリ一覧禁止、隠しファイル拒否、再検証必須のキャッシュ設定も含む。
SPAへのフォールバックは設定せず、存在しないassetsは404とする。`mod_headers`等が使えない場合に
設定を黙って無効化しない。500が出る場合はサーバーのエラーログと許可ディレクティブを確認する。

生成規則と検証ロジックの単体テストは`./scripts/use-node.sh pnpm test:deployment`で実行でき、
`pnpm check`にも含まれる。format／lint専用コマンドは現時点では未整備。

### 公開URLの自動検証

アップロードしたものと同じローカル`dist`を残した状態で実行する。URLは転送後の正規URLを指定し、
必ず末尾に`/`を付ける。

```sh
./scripts/use-node.sh pnpm verify:deployment -- https://web-lab.example.com/lab/
```

ディレクトリのトップと全成果物をGETし、ステータス、セキュリティヘッダー、キャッシュ設定、
HTML・JS（Workerを含む）・CSS・WASMのMIME型、ローカル成果物とのバイト一致を検証する。
存在しないWASMの404、`.htaccess`の403/404、HTTPからHTTPSへの転送も確認する。
TLS証明書検証は無効化せず、リクエストは各30秒でタイムアウトする。
不一致は終了コード1となる。古いCDNキャッシュ、転送漏れ、親フォルダのrewrite／ヘッダー設定を調べる。
このコマンドはブラウザ実行を検証しないため、次の手動確認も必須とする。

### アクセス制限付きリハーサル（Basic認証）

本番公開前の候補は、専用のHTTPSホストに親フォルダと配信フォルダを分けて配置する。
`deploy/sakura/rehearsal.htaccess.example`を親の`.htaccess`として使い、配信物は子の`lab/`に置く。
親の認証設定と公開フォルダ外のパスワードファイルは、配信物の入れ替え対象にしない。

```text
公開フォルダ/
  .htaccess           ← rehearsal.htaccess.exampleを基にしたBasic認証設定
  lab/
    .htaccess         ← dist/.htaccess（生成したまま）
    index.html
    assets/
公開フォルダ外/
  rehearsal.htpasswd  ← 認証用。配信物やGitには含めない
```

`AuthUserFile`のプレースホルダーはサーバー上の公開フォルダ外の絶対パスへ置き換える。
パスワードファイルはサーバー管理機能または`htpasswd`の対話入力で作成し、パスワードをコマンド引数に
渡さない。実際のパス、利用者名、パスワード、完成した認証設定をコミットしない。
さくらのコントロールパネルでHTTPS転送を先に有効にし、HTTPは認証要求より先にHTTPSへ転送する。
生成した子の設定には全体を許可する`Require all granted`を追加しない。

検証コマンドは次の環境変数が両方ある場合にBasic認証モードになる。Bashの対話入力例：

```sh
read -r -p 'Rehearsal user: ' WEB_LAB_DEPLOY_USER
read -r -s -p 'Rehearsal password: ' WEB_LAB_DEPLOY_PASSWORD
printf '\n'
export WEB_LAB_DEPLOY_USER WEB_LAB_DEPLOY_PASSWORD
./scripts/use-node.sh pnpm verify:deployment -- https://web-lab.example.com/lab/
unset WEB_LAB_DEPLOY_USER WEB_LAB_DEPLOY_PASSWORD
```

資格情報をURL、コマンド引数、ログへ書かない。TLS検証を維持し、認証ヘッダーは同一オリジンのHTTPSに
だけ送信する。HTTP転送の検査には送らず、HTTPS応答のリダイレクトには追従しない。
認証モードでは、トップと全成果物について未認証の401とBasic challengeを確認した後、認証付きで
通常のヘッダー・MIME型・内容一致検査を行う。HTMLだけ保護してWorkerやWASMが公開されている場合も
不合格になる。誤った資格情報、認証画面への転送、制限の解除を成功扱いしない。

ブラウザでも新しいプライベートウィンドウで認証要求を確認し、認証後に下記の合格条件を確認する。
IP制限を別途使う場合、通常の検証は許可された接続元で実行できるが、拒否される接続元からの403確認は
別途必要となる。自動検証が未認証401を要求するのはBasic認証モードのみ。

本番への切り替えは別作業とし、認証設定の削除をアップロード手順へ混ぜない。リハーサルでもHSTSは
ホスト全体へ適用されるため、HTTPSを恒久利用できる専用ホストを使用する。

### ブラウザでの合格条件

- HTTPSの正規URLで`window.isSecureContext === true`、`window.crossOriginIsolated === true`、
  `typeof SharedArrayBuffer === "function"`を開発者ツールで確認する。
- NetworkでWorker JSとWASMが200となり、CSPやMIME型のエラーがないことを確認する。
- REPLで`print(1 + 1)`、複数行コード、例外表示、エディタからの実行を確認する。
- 停止、ソフトリセット、完全リセット後に再実行できることを確認する。
- `while True: pass`と大量出力を実行し、UIが応答し、停止／自動停止とWorker再生成後に復旧できることを確認する。
- 仮想LED、ボタン、可変抵抗、I2Cサンプルの入力・出力と、再読み込み後のソース保存を確認する。
- サブディレクトリ配置ではトップと`index.html`の両方を開き、再読み込みでも正常に起動することを確認する。

### 一次資料と適用範囲

- [さくら：ドメインリダイレクト（HTTPS転送設定）](https://help.sakura.ad.jp/domain/2150/)
- [さくら：.htaccessによるアクセス制御](https://help.sakura.ad.jp/rs/2214/)
- [Apache：認証と認可](https://httpd.apache.org/docs/2.4/howto/auth.html)
- [Apache：mod_headers](https://httpd.apache.org/docs/2.4/en/mod/mod_headers.html)

さくら公式は一部の`.htaccess`記述の動作を保証していない。上記は配信候補設定であり、契約先サーバーで
自動検証とブラウザ確認が通ることを公開条件とする。ウェブアクセラレータや他のCDNを挟む構成は
この手順の対象外で、別途キャッシュとヘッダーの検証が必要となる。

## Nginx設定例

1. `pnpm check`を通した後に`pnpm build`を実行する。
2. `dist`を例では`/srv/micropython-web-lab/dist`へ配置する。
3. `deploy/nginx/security-headers.conf`を
   `/etc/nginx/snippets/micropython-web-lab-security.conf`へコピーする。
4. `deploy/nginx/micropython-web-lab.conf.example`をNginxのサイト設定へコピーする。
5. サーバー名、document root、TLS証明書と秘密鍵のパスを実環境へ合わせる。
6. `nginx -t`で検査してから設定を再読み込みする。

HTTPはHTTPSへリダイレクトする。HSTSはHTTPS応答で初めて有効になるため、証明書とHTTPS配信を確認する
までは本番公開しない。設定例に実在のホスト名、IPアドレス、秘密鍵を記録してリポジトリへ戻さない。

`.wasm`は`application/wasm`で返す。Nginx標準のMIME定義に依存しないよう、設定例でも明示している。

## 配信後の確認

公開URLに対して、少なくとも次を確認する。

```sh
curl --fail --silent --show-error --head https://web-lab.example.com/
curl --fail --silent --show-error https://web-lab.example.com/ \
  --output /dev/null \
  --write-out '%{content_type}\n'
```

ブラウザでは、MicroPythonの起動、Worker再生成、公開対象外のオプションコンテンツが含まれないこと、
仮想LED、仮想GPIO 15ボタン、仮想GPIO 26可変抵抗、仮想I2Cデバイス`0x50`の読み書き、
10秒の自動停止を確認する。仮想入力には`SharedArrayBuffer`が必要なため、開発者ツールで
`window.crossOriginIsolated`が`true`であることも確認する。開発用の`ws:`許可が本番CSPへ混入して
いないことをレスポンスヘッダーで確認する。

## 運用上の残課題

- TLS証明書の自動更新と更新失敗の監視
- NginxとOSのセキュリティ更新
- CSP違反レポートの収集先と個人情報を含めないログ方針
- Worker再生成頻度、転送量、エラー率の監視
- リリース成果物の署名または来歴証明
