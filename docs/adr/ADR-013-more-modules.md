# ADR-013: random・time・datetime・collections・copy・statistics・string を使えるようにする

- ステータス: 採用
- 日付: 2026-11-25

## 背景

Phase 5 では、import できるモジュールを `math` だけにしていた（ADR-007）。`random` は実行ごとに結果が変わり、CPython と比べられないため入れていなかった。

公開後、授業で使いそうなモジュールとして `random`・`datetime`・`time` を入れることにした（2026-11-25）。あわせて、推薦した `collections`（`Counter`・`defaultdict`・`deque`）・`copy`（参照の可視化と相性がよい）・`statistics`・`string` も入れることにした（同日）。

## 利用者に見える例

テストは `tests/adr-examples.test.js`（ADR-013 例1〜6）。6 件とも、入れる前のコードで失敗することを確かめた。

1. `random.seed(2026)` のあとの `random.randint(1, 6)`・`random.choice("ABC")` は、CPython で同じプログラムを実行したときと同じ値になる
2. `time.sleep(2)` は待たずにすぐ戻るが、`time.time()` は 2 秒進む（`start = time.time()` → `time.sleep(2)` → `time.time() - start` は約 2）
3. `date(2026, 11, 25) + timedelta(days=10)` は `2026-12-05`。変数のビューでは `date{year: 2026, month: 11, day: 25}` と表示される
4. `Counter("banana").most_common(1)` は `[('a', 3)]`、ない要素は 0。`defaultdict(list)`・`deque` が使え、ビューでは `Counter({…})`・`deque([0, 1, 2])` と表示される
5. `copy.copy(grid)` は中のリストを共有し、`copy.deepcopy(grid)` は中のリストもコピーする（メモリのビューの矢印で違いが見える）
6. `statistics.mean([72, 88, 95])` は `85`、`string.digits` は `'0123456789'`。用意していないモジュール（`import numpy`）は、使えるモジュールの一覧を案内する

## 決定

- **モジュールは実行ごとに作る**（`modules.js`）。`random` の状態と `time` の仮の時計を実行ごとに分けるため。同じ実行の中では、何度 import しても同じモジュール
- **random**（`lib/random.js`）：CPython と同じメルセンヌ・ツイスター（MT19937）と、同じ取り出し方（`_randbelow`・`randrange`・`randint`・`choice`・`shuffle`・`sample`・`choices`・`uniform`・`random`・`getrandbits`）にした。整数の種なら CPython と同じ乱数の列になり、CPython との比較テストで確かめられる。`seed()` を呼ばなければ実行ごとに違う種で始める。文字列の種（CPython は SHA-512 を使う）はまだ対応しない
- **time**（`lib/datetime.js`）：PyVisualizer はプログラムを最後まで実行してからステップ実行で見せるので、`time.sleep()` は待たない。その代わり、実行ごとの仮の時計を進め、`time.time()`・`perf_counter()`・`datetime.now()` などに足す（`sleep` の前後で測った時間が、CPython と同じくらいになる）
- **datetime**：`date`・`datetime`・`timedelta` を、組み込みのクラスのインスタンスとして作る（属性がビューに見える）。計算は CPython と同じ規則（先発グレゴリオ暦の通し日数、`timedelta` の正規化）。`strftime`・`strptime` は C ロケール（英語の曜日・月の名前）。辞書のキーには値で使える（`valueKey`）
- **collections**（`lib/collections.js`）：`Counter`・`defaultdict` は辞書に種類（`subtype`）を足したもの、`deque` はリストに印を付けたもの。辞書・リストの操作とビューの表示がそのまま使える。`Counter` の `repr` は CPython と同じく数の多い順
- **copy**：`copy`（浅いコピー）・`deepcopy`（深いコピー。同じものを 2 回指していれば、コピーでも同じものを指す）
- **statistics**：`mean`・`fmean`・`median`・`median_low`・`median_high`・`mode`・`multimode`・`variance`・`pvariance`・`stdev`・`pstdev`。CPython と同じく正確な有理数で計算し、データがすべて整数で結果が整数なら `int` を返す。`StatisticsError`（`ValueError` の派生）
- **string**：`ascii_letters` などの定数と `capwords`
- **表示**：モジュールは、ビューでは中身を見せず `<module 'math'>` と書く（以前は `import math` が属性の一覧を持つオブジェクトとしてヒープに出ていた）
- **エンジンの変更**：インスタンスの単項の `-`・`+`・`abs()` が `__neg__`・`__pos__`・`__abs__` を呼ぶ（`timedelta` のため。自作のクラスでも使える）
- **CPython との比較テスト**：`statistics.StatisticsError` のようなモジュールの例外は、PyVisualizer ではモジュール名を付けずに表示するので、前置きを除いて比べる

## 結果

- CPython との比較テストに `tests/cases/semantics_phase6_modules.py`（出力と変数の状態の変化）と、例外で終わる 3 本（`random.choice([])`・`date(2026, 2, 30)`・`statistics.mean([])`）を足した。3 本とも英語のメッセージまで CPython と一致する
- `time.time()`・`datetime.now()` の値は実行ごとに変わるので、比較テストでは使わない
- まだ対応していないもの：`collections.namedtuple`・`OrderedDict`、`itertools`、`datetime.time`・タイムゾーン、`random.gauss` などの分布、`time.localtime`
