# ネットワーク機能 v1

## 範囲と利用方法

非公式の機能シミュレーション。電波・暗号・TCPパケット単位の再現ではない。
右ペインの「ネットワーク」を開き、サンプルを新しいタブへ追加して実行する。
初期SSIDは`WebLab-Demo`、仮想パスワードは`demo-password`。実在のWiFi情報は不要。
同期APIの待機には既存と同じクロスオリジン分離とSharedArrayBufferが必要。
未対応環境ではAPIがENOSYS相当のOSErrorとなり、ネットワークを黙って迂回しない。
共有メモリがない場合は通常のtimeモジュールを維持し、ネットワーク以外のREPL利用を妨げない。

既定は仮想環境だけ。外部通信はコードを準備した後、対象サービスを個別に許可する。
コード変更、プロジェクトファイル変更、停止、リセット、再読み込みで許可を破棄する。
許可は保存・ZIP出力しない。送信済み操作と外部のRetainは停止しても取り消せない。
ローカルPC、LAN、任意ホスト、任意TCP/UDP、APモード、WebREPLには対応しない。

## Pythonの対応範囲

MicroPython v1.28.0を対象とした部分互換。アダプターは独自実装で、上流ライブラリーのコピーではない。

| モジュール | API |
| --- | --- |
| network | WLAN() / WLAN.IF_STA / STA_IF、active、scan、connect、disconnect、status、isconnected、config('mac'/'ssid')、status('rssi')、ifconfig()、ipconfig('addr4') |
| requests | request/get/post、headers/data/json/timeout、Responseのstatus_code/headers/content/text/json()/close()/with |
| socket | 仮想AF_INET/SOCK_STREAM、getaddrinfo、socket、bind/listen/accept/connect、send/sendall/recv/read/write/readinto/readline/makefile、settimeout/setblocking、close/with |
| umqtt.simple | MQTTClient、set_callback、set_last_will、connect、disconnect、publish、subscribe、check_msg、wait_msg、ping |
| ntptime | time、settime、host、timeout |
| machine.RTC | RTC(0).datetime() / datetime(8要素タプル) |
| time / utime | 仮想RTCに従うtime/time_ns/gmtime/localtime。ticksとsleepは元の単調時計を維持 |
| weblab_network | topic_prefix()：外部MQTTで許可される実験用接頭辞 |

networkのIPとMACは架空。isconnectedはAP接続・IP取得だけを意味し、インターネット到達性ではない。
接続失敗時はRP2既定に合わせてSTAT_CONNECTINGを維持する。設定したAPが存在し、
SSID・キーが一致すると接続遅延後に成功する。scanは架空のAPだけを返す。
IPの書き換え、未知のconfig/status指定、任意の追加引数は明示的に失敗する。
socketの0秒タイムアウトは即時失敗し、Noneは停止可能な無期限待機となる。
SOCK_DGRAM定数は存在するがUDP socketの生成はNotImplementedError。

requestsはGET/POSTだけ。dataとjsonは排他。Content-TypeとAcceptだけを指定できる。
HTTPエラーはResponse、JSON不正はValueError、権限・容量・通信失敗はOSError。
時刻はUTC。localtimeもUTCを返し、PCのタイムゾーンは継承しない。

## 仮想HTTP

| URL | 動作 |
| --- | --- |
| http://weather.weblab.test/current | GET、temperature/humidity/sourceのJSON |
| http://echo.weblab.test/get、/post | GET/POST、要求本文の確認 |
| http://fault.weblab.test/status/404、/status/500 | HTTPエラー |
| http://fault.weblab.test/invalid-json | JSON構文エラー |
| http://fault.weblab.test/timeout | 指定期限より長く待機 |

仮想HTTPサーバーサンプルは0.0.0.0:8080へbindするが、実OSのポートは開かない。
パネルの仮想HTTPクライアントから`/on`・`/off`を要求して内蔵LEDを操作する。
応答はテキスト表示だけで、HTML、スクリプト、画像URLとして実行・取得しない。
仮想ソケットはストリームであり、1回のrecvで全要求が届くことは保証しない。
組み込みHTTPへの低水準socket接続はHTTP/1.0形式の単一要求を対象とし、
chunked transfer、TLS socket、汎用HTTPプロキシは提供しない。
仮想名の失敗から実DNSや実ネットワークへフォールバックしない。

## MQTT

仮想ホストは`mqtt.weblab.test`。QoS 0/1、+/#、Retain、Last Willに対応する。
clean_session=True、Keep Aliveは1〜300秒（既定60秒）。QoS 2、永続セッション、
任意の認証情報、カスタムTLS設定、unsubscribeは初版対象外。接続・確認応答の既定期限は5秒、最大10秒。
WebLabの外部通信仲介層がKeep Aliveを維持する。Pythonコールバックはcheck_msg/wait_msgでだけ呼ぶ。
wait_msgの受信待ちには一律の5秒期限を設定せず、停止・切断で解除する。
自動再接続は行わない。再接続後は再購読する。QoS 1の配信は重複し得る。
仮想ブローカーにはQoS 1の重複配信設定がある。
パネルを別の仮想クライアントとして使い、Publish/SubscribeやRetainを確認できる。

外部の第一候補はshiftr.ioの公開インスタンスのみ。
自分用shiftr.ioインスタンスの登録・認証情報入力は次バージョンの対象とし、本版には含めない。

| Pythonの接続指定 | 実際のブラウザ転送 |
| --- | --- |
| server=public.cloud.shiftr.io、port=8883（または0）、ssl=True、user=public、password=public | wss://public.cloud.shiftr.io:443/、subprotocol=mqtt |

共通認証情報は秘密ではない。Pythonのポート指定は実機側の論理設定であり、任意ポート転送ではない。
可視化は公式サイトを別タブで開く。iframeや第三者スクリプトをアプリへ組み込まない。
WebLabが生成した`weblab/<実験ID>/`配下だけを許可する。サンプルはtopic_prefix()で取得する。
Pico実機では同じ接頭辞を設定する。公開環境の名前分けはアクセス制御ではなく、他者も読み書きできる。
メッセージは公開してよい実験値だけにする。実機での相互通信は実機検証が別途必要。

shiftr.ioは標準との差異があり、先頭スラッシュを区別せず、トピックに文字制限・128文字上限がある。
WebLabは外部トピックで先頭スラッシュと非対応文字を拒否する。
Retainはshiftrインスタンス再起動で消失し、セッション・購読は永続化されない。
仮想ブローカーへこれらの独自挙動は持ち込まない。

## 登録済みHTTPS

- httpbin.org：GET /get、/status/404、/status/500、POST /post。クエリは不可。
- api.open-meteo.com：GET /v1/forecast。緯度・経度、current=temperature_2m/relative_humidity_2m、
  forecast_days=1、timezone=UTCの範囲だけ。

Open-Meteo無料APIは非商用向け。表示に出典を付ける。商用利用は契約条件を見直す。
外部通信はHTTPS:443、CORS、credentials=omit、redirect=error、no-referrer、no-store。
Cookie、Authorization、任意ヘッダー、URL内認証、リダイレクト、no-cors迂回は提供しない。
WSSの標準APIにはcredentials=omitがなく、Cookieを絶対に送らないとは保証しない。
ブラウザによってDNS、TLS、CORSの失敗を区別できないため、原因を断定しない。
ブラウザのDNS後のIPを検査できないため、文字列検証だけでLAN到達を完全に防ぐ保証はしない。

## 仮想NTPと時計

ntptime.hostは`pool.ntp.org`（既定）または`ntp.weblab.test`のみ。どちらも仮想処理で外部送信しない。
固定時刻（既定2026-01-01 UTC）またはPCの時計を応答に利用する。
遅延、タイムアウト、不正応答を設定できる。失敗してもRTCを変更しない。
settimeは仮想RTCだけを変更する。PC時計、ticks_ms/us、PWMやデバイスの時計、通信期限を変更しない。
RTCはUnix秒を境界形式とし、PythonアダプターがMicroPythonのエポックに合わせる。
PC時計を使っても「実NTP同期」とは表示しない。

## 上限・状態・保存

| 項目 | 上限 |
| --- | --- |
| HTTP要求本文/応答本文 | 16 KiB / 展開後64 KiB |
| HTTP要求時間 | 既定5秒・最大10秒、本文受信完了まで |
| 外部HTTP | 同時2要求・30要求/60秒（ページ全体） |
| 仮想TCP | Pythonとパネルの合計4 socket、各送受信キュー8 KiB、待受キュー2接続 |
| MQTT | Python側2接続、各8購読、payload 4 KiB、受信キュー64 KiB/256件 |
| 外部MQTT | Publish/Subscribe/手動Pingの合計毎秒10件、接続試行6回/60秒（ページ全体） |
| 仮想Retain | 64トピック・payload合計64 KiB |
| 履歴 | 最新100件。本文、クエリ値、認証情報は自動記録しない |

HTTP本文はストリーム受信中に検査し、Content-Lengthを信用しない。
上限や権限はPythonから書き換えられないホストでも検証する。ブラウザを改変する利用者に対する
サービス側の悪用対策を代替しない。ページ再読み込みによる回数制限の回避までは防げない。

仮想AP・HTTP遅延・NTP・重複配信の設定は`.weblab-network.json`（version=1）として
既存のプロジェクトファイル保存・ZIPに含める。未知フィールド、不正値、2 KiB超過は拒否して既定へ戻す。
外部許可・接続・履歴は同ファイルへ保存しない。設定のない既存プロジェクトも既定値で開ける。
Worker再生成では仮想RTCとWiFi/接続を初期化し、ページ内の仮想Retainは維持する。
「ネットワーク実験を初期化」は仮想Retainと履歴も破棄する。ページ再読み込みでも仮想Retainは失われる。

## 構成と検証

Python互換層 → 版付きJSON要求 → メインスレッドのNetworkHost → 仮想モデル/登録済み実通信。
要求は48 KiB、応答は160 KiBまで。Runtime Protocol v16はWorkerごとの共有応答領域と
単調増加要求IDを持つ。古いWorkerの応答は書き込まない。停止時に通信を中断しWorkerを破棄する。
WASM成果物、ヒープ、js/jsffi禁止は変更しない。Device APIへネットワーク権限を渡さない。

検証：`./scripts/use-node.sh pnpm test`、`pnpm test:headers`、`pnpm test:runtime`、`pnpm build`、
`pnpm exec playwright test e2e/network.spec.ts`（すべてuse-node.sh経由）。既存4173番と競合する場合は
`WEB_LAB_E2E_PORT=4273 ./scripts/use-node.sh pnpm exec playwright test e2e/network.spec.ts`を使う。
外部サービスへの実接続とPico実機は、決定的な自動テストから分離して検証する。
format/lint専用コマンドは現行package.jsonでは未整備。型検査はbuildに含まれる。

## 一次資料

- [MicroPython RP2](https://docs.micropython.org/en/v1.28.0/rp2/quickref.html)
- [shiftr MQTT仕様](https://www.shiftr.io/docs/broker/mqtt-interface/)
- [shiftrブラウザ接続](https://www.shiftr.io/docs/manuals/javascript/)
- [Open-Meteo利用条件](https://open-meteo.com/en/terms)
- [WebSocket仕様](https://websockets.spec.whatwg.org/)
