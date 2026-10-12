# YM2203イベントBIN：WYM1

WebLabの1台のYM2203（4 MHz、FM 3ch＋SSG 3ch）用の予約演奏データ。
音色設定を含むレジスタ書き込み列を格納する。録音やPythonコードのバイナリ化ではない。

## ファイル構造

整数はすべて符号なし、リトルエンディアン。ヘッダー16バイト＋6バイトのイベントN件。
ファイル長は厳密に16＋6×Nバイト。追加タグ、パディング、圧縮、CRCは含まない。

| オフセット | サイズ | 内容 |
| --- | --- | --- |
| 0 | 4 | ASCII WYM1（57 59 4D 31）。形式と版を識別 |
| 4 | 4 | event_count：1〜131071 |
| 8 | 4 | period_ms：1〜4294967295。1回の期間・繰り返し周期 |
| 12 | 4 | clock_hz：4000000のみ |
| 16＋6i | 4 | イベントiの絶対時刻time_ms |
| 20＋6i | 1 | YM2203レジスタ番号：0〜255 |
| 21＋6i | 1 | レジスタ値：0〜255 |

0 ≤ time_ms ≤ period_ms、時刻は非減少順。同時刻の書き込みはファイル順を保持する。
FMの周波数上位・下位・キーオン、SSGエンベロープ再トリガーなどの順序を変更しない。
予約開始を0 msとする。I2Cアドレス、アンプ音量、曲名、部分ループ位置は格納しない。

リセット後に再生するので、先頭には必要なFM音色・SSGミキサー等の初期化を含める。
終端にはFM各chキーオフ・SSG各ch音量0を入れ、余韻も含めて周期を決める。
全体を繰り返す場合は先頭の初期化も毎周実行する。イントロを1回だけ演奏して途中へ戻る
ループは表現しない。タイマー・CSMなどCPU連携を必要とする演奏はレジスタ列だけでは再現できない場合がある。

## Python API

「BINプレイヤー」でlib/web_lab_ym2203_bin_v1.pyとベースドライバーが追加される。
オリジナル発声データsamples/ym2203-demo.binも用意する。

~~~python
from machine import I2C, Pin
from web_lab_ym2203_v1 import YM2203
from web_lab_ym2203_bin_v1 import YM2203BinPlayer

sound = YM2203(I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000))
player = YM2203BinPlayer(sound)
print(player.inspect("music/song.bin"))
duration = player.play("music/song.bin", volume=20)
# 24時間繰り返す場合:
# duration = player.play("music/song.bin", repeat_ms=86400000, volume=20)
# player.stop()
~~~

| メソッド | 動作 |
| --- | --- |
| YM2203BinPlayer(sound) | 既存のYM2203ドライバーを使用 |
| inspect(path) | 全体を検証しevent_count・period_ms・clock_hz・header_bytesを返す。I2C書き込みなし |
| play(path, repeat_ms=None, volume=20) | 検証→リセット→アンプ設定→逐次転送→開始。総期間msを返す |
| play_raw(path, event_count, period_ms, repeat_ms=None, volume=20) | 旧ヘッダーなし形式を明示指定 |
| stop() | 即時発音・予約を停止 |

repeat_ms=Noneは1回。指定時は周期以上、最大4294967295 msの整数。周期は100 ms以上。
volumeは内蔵アンプ0〜100%。画面のスピーカー音量・ミュートとは独立する。

検証と転送の2パスで読み、最大42イベント＝252バイトずつ処理する。
Pythonヒープに曲全体のタプル配列を展開しない。I2Cは0x05＋イベント群、
6バイト状態の予約数を照合した後、0x06＋総期間uint32LE［＋周期uint32LE］で開始する。
転送中の例外・割り込みではキューをリセットする。検証エラーでは既存の演奏・音量・予約を変更しない。

Python終了後も音源側で再生する。I2C状態のqueuedは開始時に0になり、完了を表さない。
画面の演奏表示・処理数で完了を確認する。停止・再起動・結線無効化でも消音する。
ミュートは演奏位置を進めたまま消音する。最大BINは786442バイト、プロジェクト全体は4 MiBまで。

取り込みはZIP経由。ZIP取り込みは既存プロジェクトを置き換えるので、先にZIPで保存し、
必要な既存ファイルも新ZIPへ含める。

## 旧テストデータ

YSIIのローカルテストで使ったBINは同じ6バイトレコードだけを連結した形式。
長さは6×event_count。曲固有の数と周期をPython側で別途指定していた。
play_raw()には既知の値を渡す。自動判別しないので、不正ヘッダーを旧形式と誤認しない。
新規生成はWYM1を使う。旧rawは次のヘッダーを付加して移行できる。

~~~python
# デスクトップPython。count/period_msは元の変換記録から設定。
import struct
payload = open("events-raw.bin", "rb").read()
assert len(payload) == count * 6
with open("song.bin", "wb") as out:
    out.write(struct.pack("<4sIII", b"WYM1", count, period_ms, 4000000))
    out.write(payload)
~~~

rawにはクロック情報がないので、4 MHz・1台用であることを移行前に確認する。

## 生成時の注意

VGM/VGZなど元のレジスタ列・待ち時間があるログを入力にする。
録音・楽譜・曲名だけから元のFMパラメータを正確に復元したとは報告しない。
VGMは1秒＝44100サンプル、YM2203書き込みは0x55・register・value。
根拠は[VGMの一次仕様](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt)。
累積絶対サンプルを(samples×1000＋22050)//44100でmsへ丸め、待ちごとの丸めを累積しない。
同時刻のイベントを削除・並べ替えない。1台・4 MHz以外、他音源、PCM、未対応命令を黙って捨てない。

部分ループ、追加ヘッダーの音量／クロック、プリスケーラー変更等の扱いを報告する。
容量超過では無断間引きしない。曲名・機種・出典・権利・SHA-256・変換条件・未再現項目を別JSONへ記録する。
形状・順序の検査だけでは値の破損を必ず検出できないため、受領時にJSONのSHA-256と照合する。
[ChatGPTへのプロンプト例](ym2203-conversion-prompt.md)も参照する。
