# 静的配信の準備

## 前提

Web Labは静的ファイルとして配信し、サーバー側では利用者のPythonコードを実行しない。VPSでは
`pnpm build`で生成した`dist`をNginxからHTTPS配信する構成を想定する。

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
