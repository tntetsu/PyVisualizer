# ADR-011: 入門でよく使う書き方を入れる（型注釈・* のアンパック・:=・str.format・組み込み関数など）

- ステータス: 採用
- 日付: 2026-11-25

## 背景

公開後に、入門の授業で使いそうな書き方を一通り試したところ、次が動かなかった（2026-11-25）。

- 型注釈（`def f(x: int) -> int:`・`x: int = 1`）が構文エラー（最近の教材ではよく使う）
- `a, *b = …`・`[*xs, 1]`、`n := …`、`f"{x=}"`・`f"{x!r}"`
- `"{}".format()`、`zfill`・`center`・`title` などの文字列のメソッド
- 組み込み関数 `map`・`filter`・`any`・`all`・`divmod`・`pow`・`hex`・`bin`・`oct`・`iter`・`next`・`callable`・`format`・`id`・`hash`・`exit`・`quit`、`int("ff", 16)`

あわせて、書式指定（f 文字列の `{:…}`）が主要な部分しかなく（`08b` などが未対応）、丸めも CPython と違うことがあった（`f"{2.675:.2f}"` が `2.68`。CPython は `2.67`）。小数の表示も、`1e20` が `100000000000000000000` になっていた（CPython は `1e+20`）。

## 利用者に見える例

テストは `tests/adr-examples.test.js`（ADR-011 例1〜6）。6 件とも、入れる前のコードで失敗することを確かめた。

1. 型注釈を付けた関数・変数が、そのまま実行できる
   ```python
   def area(w: int, h: int = 2) -> int:
       return w * h
   size: int = area(3)
   print(size)        # 6
   ```
2. `first, *rest = [1, 2, 3]`・`if (n := len(rest)) > 1:`・`f"{pi=} {pi = :.2f}"`（`pi=3.14159 pi = 3.14`）が使える
3. `"{} + {} = {:.1f}".format(1, 2, 3)`、`list(map(str, [1, 2]))`、`list(filter(None, [0, 3]))`、`any`、`divmod(7, 2)`、`hex(255)`、`int("ff", 16)` が使える
4. `exit()` を呼ぶと、エラーにならずにそこで終わる（後ろの行は実行されない）
5. `map` に渡した関数は、`map` を呼んだときに全部呼ばれる（CPython とは違う。下の「決定」）
   ```python
   def show(x):
       print("call", x)
       return x
   m = map(show, [1, 2])
   print("made")
   print(list(m))
   # PyVisualizer：call 1 / call 2 / made / [1, 2]
   # CPython：     made / call 1 / call 2 / [1, 2]
   ```
6. `print(1e20, 0.00001)` は `1e+20 1e-05`、`f"{2.675:.2f} {2.5:.0f}"` は `2.67 2`（CPython と同じ）

## 決定

- **型注釈**：読み飛ばす（実行には使わない）。値のない `x: int` は何もしない文にし、関数の中ではローカル変数の宣言として扱う（CPython と同じ）
- **`*` のアンパック**：代入先（`a, *b = …`・`for a, *b in …`）と並び（`[*a, 1]`・`(*a,)`・`{*a}`）で使える。`*` の付いた代入先は残りをリストで受け取る
- **`:=`**：代入して値を返す。内包表記の中では、内包表記を含むスコープの変数になる（PEP 572）
- **f 文字列**：`{x=}`（式の書き方と `=` の前後の空白をそのまま出し、書式指定がなければ repr）、`!r`・`!s`・`!a` の変換
- **`str.format`**：`{}`・`{0}`・`{name}`・`{0.attr}`・`{0[key]}`・`!r`・`{:spec}`・`{{ }}`
- **書式指定**：CPython の文法 `[[fill]align][sign][#][0][width][grouping][.precision][type]` に沿って作り直した（型 `b c d e E f F g G n o s x X %`）。丸めは、小数の 2 進の正確な値を偶数への丸めで 10 進にする（CPython と同じ）。`tests/format.test.js` が、48 の書式指定 × 18 の値を CPython の `format()` と比べる
- **小数の表示**：CPython の repr と同じく、10 進の指数が -4 未満か 16 以上なら指数表記にする
- **`map`・`filter`・`iter`**：イテレーター（`<map object>`）を返す。`next()` や `for` で 1 回だけ取り出せる。ただし要素は作ったときに全部求める（`map` に渡した関数もそのときに呼ぶ）。CPython は値を取り出すときに呼ぶので、関数の中で `print` すると順序が違う（例5）。値を取り出すときに呼ぶと、別の関数の中で取り出したときに、呼び出しの深さ（コールスタックの表示）が記録とずれるため、この形にした。`<map object at 0x…>` のアドレスは付けない（インスタンスと同じ。ADR-006）
- **`exit()`・`quit()`**：`SystemExit`（`BaseException` の派生）を送出する。捕まえられなければ、そこで正常に終わる（エラーの表示は出さない）
- **`pow(b, e, m)`**：指数が負なら逆元を使う（CPython 3.8 以降と同じ）
- **`id()`**：オブジェクトごとに決まった番号（CPython のアドレスとは違う）。**`hash()`**：int・bool・整数の float は CPython と同じ値。文字列は実行ごとに同じ値（CPython は実行ごとに変わる）
- **英訳**：足したメッセージは ADR-010 の方式で英訳する（`tests/messages-en.test.js` が漏れを検出する）

## 結果

- CPython との比較テストに `tests/cases/semantics_phase6_basics.py`（出力と変数の状態の変化）と、例外で終わる 3 本（`next()` の `StopIteration`・`*` のアンパックで値が足りない・`int()` の基数）を足した。3 本とも英語のメッセージまで CPython と一致する
- 変数の状態の比較（`tests/tools/trace_states.py`）は、`<… object at 0x…>` のアドレスを除いて比べ、`exit()` を正常な終わりとして扱う
