# ADR 0056: ホスト管理の仮想ネットワークと登録済み外部通信を追加する

- 状態: Accepted
- 日付: 2026-10-29

## 背景

Pico 2 W向けのWiFi/HTTP/MQTTと時計の実験が必要になった。汎用js/jsffiや任意socketの公開は、
既存の信頼境界を大きく広げる。ローカル接続と任意UDPは初版対象外とする。

## 決定

制限付きWASMはそのまま使い、独自Python互換層から版付き・上限付きのJSON要求を送る。
Python Workerは専用SharedArrayBufferで結果を待ち、メインのNetworkHostが実行する。
Asyncifyで汎用JS Promiseを公開する方式は採らない。既存の同期デバイス入力と同じ共有メモリ要件で、
WASM再ビルドや汎用ブリッジの解放を避けられる。

HTTP/仮想TCP/仮想MQTT/NTPを標準とし、外部はhttpbin、Open-Meteo、shiftr公開インスタンスだけ。
接続先、パス、パラメーター、トピック、出力量、受信容量、期限をホストで検証する。
外部許可は既定無効で、ソース・プロジェクト変更とWorker破棄で失効する。
NTPは仮想RTCを設定するだけで、実UDPやPC時計の変更は行わない。

## 影響と移行

ADR 0010のWASM単体の禁止モジュール検査は継続し、アプリでは限定network/socketを登録する。
アプリE2Eでは単なるimport拒否から、許可なし外部通信・UDP・任意宛先の拒否へ検査を変更する。
Runtime Protocolはv16からv17へ更新。startにnetworkChannelを追加し、network-requestを追加する。
内部RPCはモジュール・関数・呼出しアダプターのプロトタイプを除去してfreezeする。
モデル型のarm ProfileにはnetworkChannelを渡さず、混在した起動要求も拒否する。
配信はCSP connect-srcへ3つの固定外部オリジンを追加するため、Nginx/静的配布のヘッダーも更新する。
他の権限、クロスオリジン分離、Worker停止方式、Device APIは変更しない。

保存は既存のプロジェクトファイル形式内の`.weblab-network.json` v1で行う。権限や接続を保存しない。
公開ブローカーのトピック分離はACLではない。WSS Cookie、DNS後IPの検査、公開サービスの停止・仕様差、
クライアント側上限の回避は残る制約。詳細は[機能仕様](../network-v1.md)を参照する。
