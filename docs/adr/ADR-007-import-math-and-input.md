# ADR-007: import math と input()

- ステータス: 採用
- 日付: 2026-11-25

## 背景

入門の教材では、`math` モジュール（`sqrt`・`pi` など）と、`input()` による入力をよく使う。PyVisualizer はブラウザの中でプログラムを最後まで実行してから、ステップ実行で見せる。そのため、実行中にキーボードから入力を受け取ることはできない。

## 利用者に見える例

テストは `tests/adr-examples.test.js`（ADR-007 例1〜3）。3 件とも、入れる前（`2574c30`）では失敗することを確かめた。

1. 画面の「入力」の欄に `太郎`・`20` の 2 行を書いて、次のプログラムを実行する。コンソールには `名前: 太郎`・`年齢: 20`・`太郎 21` と表示される。端末で実行したときと同じく、プロンプトの後に読んだ行が表示される
   ```python
   name = input("名前: ")
   age = int(input("年齢: "))
   print(name, age + 1)
   ```
2. 入力の欄の行が足りないと `EOFError` になり、「入力が足りません（画面の「入力」の欄に、input() で読む行を書いてください）」と表示される
3. `import math`・`from math import sqrt` は使える。`import random` などのほかのモジュールは `ModuleNotFoundError` になり、「PyVisualizer で import できるのは math だけです」と表示される（[ADR-013](ADR-013-more-modules.md) で random などを使えるようにし、メッセージは使えるモジュールの一覧になった。テストは `import numpy` で確かめる）

## 決定

- **input()**
  - 画面のソースの下に「入力」の欄を置く。実行するとき、その内容を改行で区切った行の並びとして渡し、`input()` は 1 行ずつ読む
  - 欄の最後の改行は、空の行として数えない
  - 端末と同じく、プロンプトの後に読んだ行と改行をコンソールに出す
  - 入力の欄は、言語プロファイルが `supportsInput: true` のときだけ出す（JSVisualizer の作業ブランチ `feature/multilang` の `components/input-panel.js`、JSVisualizer の ADR-055）。JS 版では出さない
- **import**
  - `import m`・`import m as x`・`from m import a, b as c`・`from m import *` の形に対応する
  - モジュールは `math` だけ。`random` は実行ごとに結果が変わり、CPython と比べられないので入れていない
- **math**：定数（`pi`・`e`・`tau`・`inf`・`nan`）と主な関数を入れた。CPython と同じく、`floor`・`ceil`・`trunc`・`isqrt`・`gcd`・`factorial`・`comb`・`perm` は int を返し、定義域の外は `ValueError` にする
  - 平方根・指数・対数：`sqrt`・`exp`・`log`・`log2`・`log10`・`pow`
  - 三角関数：`sin`・`cos`・`tan`・`asin`・`acos`・`atan`・`atan2`、`degrees`・`radians`
  - 整数を返すもの：`floor`・`ceil`・`trunc`・`isqrt`・`gcd`・`factorial`・`comb`・`perm`
  - その他：`hypot`・`fabs`・`isclose`・`isfinite`・`isinf`・`isnan`・`fsum`

## 結果

- CPython との比較テスト（出力・変数の状態の変化）で、`input()` を使うプログラムも比べられるようにした
  - テストのプログラムと同じ名前の `.stdin` ファイルを、入力として渡す
  - CPython 側は、`input()` を「読んだ行を表示する」形にそろえて実行する（`tests/tools/run_echo.py`）
- 組み込みのサンプルは、入力の欄が空でも動くものだけにした（`input()` を使うサンプルは入れていない）
- 実行のたびに入力の欄の内容を読む。サンプルを選んでも入力の欄の内容は変わらない
