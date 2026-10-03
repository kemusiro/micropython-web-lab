# ADR 0026: 単調増加Device時計と時間依存GPS信号を追加する

- 状態: Accepted
- 日付: 2026-08-30

## 背景

Device API v1の`DeviceContext`はボード情報、資源上限、状態通知だけを持ち、Device Modelが捕捉待ち、周期出力、
パルスなどの経過時間を再現する共通手段がなかった。モデルが`Date.now()`や`setInterval()`を直接使うと、
壁時計変更、ブラウザのバックグラウンド抑制、Worker破棄、テスト待機の影響を受ける。またMicroPythonの
同期WASM実行中はWorkerのJavaScriptタイマーが進行しない。

GT-502MGG-Nモデルには、捕捉中から測位済みへの遷移、1 Hz NMEA、PPSを追加する要求がある。既存の第三者
Device Model、テスト用の`DeviceContext`オブジェクト、Device API v1の同期ポート契約は維持する必要がある。

## 決定

公開Device API v1へ次を後方互換な省略可能プロパティとして追加する。

```ts
export interface DeviceClock {
  monotonicMilliseconds(): number;
}

export interface DeviceContext {
  // 既存フィールド
  readonly clock?: DeviceClock;
}
```

Web LabのDevice Hostは常に時計を提供し、返り値が0以上の有限値で後退しないことを境界で検査する。時計は
日時、タイムゾーン、タイマー登録、コールバックを提供しない。Testkitは壁時計を待たずに進められる
`ManualDeviceClock`を公開する。既存Device Modelは時計を参照しないため無変更で動作し、旧ホスト上の
時間依存モデルは時計がない場合の安全な静止状態を定義する。

時間依存Device Modelは、ポート操作またはActionの同期境界で時計を読み、現在状態を遅延評価する。
JavaScriptタイマーだけには依存しない。長時間アクセスがなかった場合、経過イベントを無制限に再生せず、
デバイスごとに最新状態、上限付きキュー、取りこぼしの可視化を定義する。

GT-502MGG-N `0.2.0`は次の機能レベル動作を採用する。

- 起動・リセットから3秒は捕捉中、その後は測位済み
- UART操作時に経過秒を評価し、最新GGA/RMCを1 Hzで生成
- 未読の古いスナップショットを最新値へ置換し、飛ばした周期と置換数を状態へ記録
- `gpio-driver`のPPSをGP14へ接続し、捕捉後の各秒先頭100 msをHighとしてポーリング可能にする
- 既存115200 bps UARTエコー互換モードは維持する

## 結果

- 周期センサー、ウォームアップ、タイムアウトなどを第三者Device Modelでも同じ安全な時計境界で実装できる。
- 手動時計により、時間待ちなしで捕捉、1 Hz、PPS境界を単体テストできる。
- Workerがイベントループへ戻らない間も、次の同期読み取り時には実経過時間を反映できる。
- NMEAとPPSの観測は呼び出し時評価であり、MicroPythonがポートを読まない間に割り込みを非同期配送しない。
- 将来`Pin.irq()`や非同期イベントを追加する場合は、別Worker、共有状態、イベント順序、停止・復旧を含む
  スケジューラー設計を新しいADRで決定する。

## 関連文書

- `docs/device-api-v1.md`
- `docs/device-development.md`
- `docs/devices/gt-502mgg-n.md`
- `docs/connection-model-v1.md`
- `docs/threat-model.md`
- `docs/adr/0018-generalize-synchronous-device-inputs.md`
- `docs/adr/0025-model-the-gt-502mgg-n-on-managed-uart0.md`
