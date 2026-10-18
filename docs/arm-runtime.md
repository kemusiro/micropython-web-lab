# 一軸アームの同期実行基盤（E4）

制限付きMicroPythonで書いた制御ループを、E3の数値モデルと同期して実行する。
`src/control/session.ts`がWorkerのペアを所有する。通常画面のロボット入口、保存形式、描画はまだ接続しない。
数値モデルは[一軸アームの物理モデル](arm-physics.md)、選択の理由は[ADR 0054](adr/0054-connect-micropython-to-a-simulation-worker.md)を参照する。

## ホストからの利用

```typescript
import { ArmRuntimeSession } from "./src/control/session";
import { ARM_CONTROL_SOURCE } from "./src/control/python-module";
import { DEFAULT_ARM_CONTROL } from "./src/physics/arm-control";

const session = new ArmRuntimeSession({
  setId: "my-arm-set", generation: 1, conditions: DEFAULT_ARM_CONTROL,
  onFrame(frame, lagMs) { /* 検査済みの観測コピーを表示へ渡す */ },
});
await session.start(); // 両Workerの準備。コードはまだ実行しない。
const result = await session.execute(ARM_CONTROL_SOURCE); // 明示的な実行要求
// result.telemetry、metadata、projectを次の表示・保存処理へ渡す。
// 実行中の停止はsession.stop()。再実行には新しいsessionを作る。
```

`start`はクロスオリジン分離とSharedArrayBufferを要求する。不足してもソースや条件を代替実行せず、
理由を返す。コード・解説を表示する側は、この実行能力の確認と分離して扱う。
`runtimeFactory`と`simulationFactory`はホストの検証用差替えで、Pythonや保存データからは指定できない。
モデル型のRuntimeClientにボード配線、共有デバイス入力、デバッガを混在させると起動を拒否する。

## Python API v1

モデル用Profileだけで、次のコードを使える。通常のPicoワークスペースへ追加したAPIではない。

```python
from math import cos
from weblab.control import Experiment

experiment = Experiment()
arm = experiment.joint("arm")
p = experiment.parameters()
for _ in range(experiment.steps):
    angle, speed = arm.read()
    torque = p["kp"] * (p["target_rad"] - angle) - p["kd"] * speed
    if p["gravity_compensation"]:
        torque += p["gravity_coefficient_nm"] * cos(angle)
    arm.set_torque(torque)
    experiment.step()
```

| 操作 | 契約 |
| --- | --- |
| `Experiment()` | 今回の実行へ限定したハンドルを一つ作る。二つ目は拒否 |
| `parameters()` | 開始条件のコピー。変更しても物理モデルの条件は変わらない |
| `joint("arm")` | 登録済みの一軸だけを返す。ほかの名前はValueError |
| `joint.read()` | 同じ確定tickの角度rad、角速度rad/sの組。時刻を進めない |
| `joint.set_torque(value)` | 次の区間の要求値N·m。最後の指定を採用し、未指定なら直前値、開始時は0 |
| `experiment.step()` | 一制御周期10 msを進め、完了番号と観測を確認してから戻る |
| `experiment.steps` | 実験長の制御tick数。読取専用 |
| `experiment.time_s` | 整数tickから求めた仮想秒。読取専用 |

`parameters`のキーは`target_rad`、`kp`、`kd`、`gravity_compensation`、`gravity_coefficient_nm`、
`payload_mass_kg`、`initial_angle_rad`、`duration_ms`、`control_period_s`、`inertia_kg_m2`。
標準条件と変更範囲はE3の仕様を使い、実行中の変更は反映しない。
トルクはbool・数値以外をTypeError、非有限値や無効ハンドルなどのホスト制御エラーをRuntimeErrorで拒否する。
有限な大きい要求はモデルで±1.20 N·mへ飽和させ、要求値を記録に残す。実験長を超えるstepも拒否する。

`time.sleep_ms`や`ticks_ms`は実時間のままであり、仮想時刻へ変換しない。
実時間、乱数、手動入力へ依存するコードまで同じ結果になるとは保証しない。
終了、停止、例外後は追加の物理計算を行わない。Pythonの途中状態から再開する仕組みではない。

## 共有領域と時刻

制御版1、合計96,168バイトを使う。ヘッダーはInt32×16、要求トルクはFloat64×1、観測はFloat64×12×1,001。

| ヘッダースロット | 内容 |
| --- | --- |
| 0、1、2 | magic、制御版、世代 |
| 3、4 | 要求番号、完了番号 |
| 5、6 | 中止、障害 |
| 7、8 | 最後に確定したtick、初期状態の準備完了 |
| 9〜15 | 予約。現行版では未使用 |

Runtime Workerが要求トルクを書いて要求番号を公開する。Simulation Workerは一周期を計算し、
新しい行の全数値を書いてからtickと完了番号を公開する。Runtime Workerは完了待ちの間に観測を読まない。
公開済みの行を更新せず、新実行へバッファを再利用しない。ホストは確定prefixだけをコピーする。

Atomics.waitはDedicated Workerの中だけで用いる。起動の期限は10秒、stepの期限は1秒。
中止・障害・世代不一致・完了番号の異常でも待機を解除する。実装の基礎となる待機・通知の仕様は
[ECMAScriptのAtomics.wait](https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.wait)を参照する。
ブラウザやOSによるスレッド停止まで厳密に1秒以内へ制限するリアルタイム保証ではない。

Simulation Workerは仮想tickに対応する実時間まで待つ。遅れていても計算を省略せず、遅延msを通知する。
メインスレッドからの停止は、中止フラグとnotifyに続いて両Workerをterminateする。
相手からの正常終了メッセージを待たず、stepを呼ばない無限ループも破棄する。
ページを隠す場合も停止し、隠れた時間を後からまとめて追い付かせない。

## 観測と結果

数値列の順序は`CONTROL_SERIES`へ固定する。
角度、角速度、加速度、拘束なし加速度、重力項、粘性項、機械エネルギー、要求トルク、適用トルク、
フラグ、下端上の真偽値、上端上の真偽値の12列である。
行nはtick nの状態で、n>0のトルクと接触フラグは直前の区間[n−1,n)に対応する。行0のトルクは0。
フラグのbit 0は加速度有効、1は飽和、2は下端接触、3は上端接触、4は速度投影を示す。
加速度無効時の格納値0を通常の加速度として描画しない。

途中フレームは最大128点の窓を50 ms以上の間隔で返す。前の窓と重なる点を含む。
世代、実行ID、sequence、モデル版、tickの順序、長さ、有限性、フラグを検査し、UI用にはさらにコピーする。
終了時は最大1,001点、数値96,096バイトの全確定記録を一度返す。途中停止では確定した接頭部分を残す。
`firstTick`、`lastTick`で範囲を判断し、欠けた点や中断を完全な実験と扱わない。

結果の`status`は予定tickまでPythonが正常終了した`completed`、早期終了・手動停止の`stopped`、
例外・通信障害等の`failed`。失敗でも回収できる観測と受信済みファイルを残す。
メタデータにはセット・世代・実行ID、実行バッファのSHA-256、開始時の全プロジェクトのSHA-256、
条件、RuntimeのWASM参照、モデル・積分器版、通信版、制御周期と積分刻みを含める。
プロジェクトのハッシュはパス順に各ファイルの生バイトのSHA-256と空ディレクトリをまとめたもの。
実際にimportされたものだけを追跡する依存グラフではない。

Pythonから受け取ったファイル更新はホストへ複製し、`result.project`へ返す。現在のE4では自動永続化しない。
強制停止ではWorkerから未送信のファイル変更まで回収できるとは限らない。

## 権限と互換性

汎用のjs・jsffi・ネットワーク・DOM・ストレージを公開せず、モデル型ではmachineも登録しない。
新しい私有モジュールは一つの操作ディスパッチとJSONだけで構成する。
モジュール・関数のプロトタイプと書換えを制限し、Function/Objectのコンストラクターへたどる経路を閉じる。
共有メモリはPythonへ渡さない。未対応のモデルや版を通常のPico構成へ置き換えない。

Runtime Protocol 16と制御版1を両側で検査する。旧15のWorkerへは接続できず、同じ配布物で更新する。
WASMの上流ソース、固定成果物、Node.js、Device API、DB版・保存レコードは変更しない。

## 検証

`e2e/experiments/control-runtime.spec.ts`では実際の制限付きWASMで、参照4ケースの全601点、
同期読取、値保持、APIエラー、権限、通信相手の破棄、強制停止・再実行、非分離環境、ページ非表示、
ファイル保持とハッシュを確認する。参照角度系列との最大差は今回2.6×10⁻¹⁴°未満だった。
単体では不正バッファ・版・世代、順序・期限、起動失敗・旧能力、古い通知、ハンドル寿命、テレメトリ上限を検査する。

```sh
./scripts/use-node.sh pnpm test:e2e:experiments
```

開発サーバーには`/fixtures/control/`の検証ページを置く。これはテスト用ホストで、本番成果物へ含めない。
通常画面の保存・カタログ・アーム描画・グラフへの接続はE5で行う。
製品版Chrome・Edge・Firefox・Safari間と実機での検証は残る。
