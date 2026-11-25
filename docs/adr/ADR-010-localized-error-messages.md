# ADR-010: エラーメッセージを表示言語に合わせる（英語は CPython と同じ文面）

- ステータス: 採用
- 日付: 2026-11-25

## 背景

PyVisualizer のエンジンは、エラーメッセージを初学者向けの日本語で作る（ADR-006）。そのため、画面を英語表示にしても Python のエラーメッセージは日本語のままだった（[phase5-report.md](../phase5-report.md) 4 節。マニュアルにも「今のところ日本語だけ」と書いていた）。

JS 版（JSVisualizer）は、エンジンが作った日本語のメッセージを、表示するときに文型で英語に置き換えている（JSVisualizer の ADR-046）。英語の文面は V8 のメッセージにそろえている。

## 利用者に見える例

テストは `tests/adr-examples.test.js`（ADR-010 例1〜5）。5 件とも、直す前のコードで失敗することを確かめた。

1. 英語表示で次のプログラムを実行すると、エラーの欄に `IndexError: list index out of range (line 2)` と表示される。日本語表示では従来どおり `IndexError: list の範囲外の位置 5 を指定しています（長さ 3）（2行目）`
   ```python
   x = [1, 2, 3]
   print(x[5])
   ```
2. 英語表示で `if x > 1`（「:」がない）を実行すると、`SyntaxError (line 1): expected ':'` と表示される
3. 英語表示で次のプログラムを実行すると、コンソールに `invalid literal for int() with base 10: 'x'` と表示される（日本語表示では `'x' は整数に変換できません`）
   ```python
   try:
       int("x")
   except ValueError as e:
       print(e)
   ```
4. エラーが表示されているときに表示言語を切り替えると、エラーの欄は、もう一度実行しなくてもその言語に切り替わる
5. メソッドの引数の誤りは、CPython と同じくクラス名を付けて表示される（英語：`A.__init__() missing 1 required positional argument: 'x'`、日本語：`A.__init__() の引数 'x' が渡されていません`）

## 決定

- **方式**：JS 版と同じく、エンジンはメッセージを日本語で作り、英語表示のときに文型で英語に置き換える（`src/engine/messages-en.js`）。言語プロファイルの `localizeError`（JSVisualizer の作業ブランチ `feature/multilang` に足した。ADR-055 に追記）が、エラーの欄の文字列を置き換える。表示するときに置き換えるので、言語を切り替えるとすぐ反映される
- **英語の文面**：なるべく CPython 3.12 のメッセージと同じにする（2026-11-25 決定。JS 版の英語が V8 の書き方にそろえているのと同じ考え方）。CPython と比べるテスト（`tests/oracle.test.js`）で、英語で実行したときの出力と例外のメッセージが一致することを確かめる。ただし次は CPython と違う
  - PyVisualizer 固有の案内を足すもの：`input()` の行が足りない（「入力」の欄に書くよう案内）、import できないモジュール（math だけであることを案内）
  - 未対応の構文（`the 'with' statement is not supported yet` など）・ステップ数の上限など、CPython にないもの
  - 日本語のメッセージに CPython の区別に必要な情報がないもの（`0 で割る` は、演算子によらず `division by zero`。閉じていない括弧の種類など）
- **枠**：`ValueError: 本文（3行目）` → `ValueError: body (line 3)`、`構文エラー（3行目）: 本文` → `SyntaxError (line 3): body`。`raise` で書いたメッセージは書いたとおりに残し、行番号の部分だけ英語にする
- **実行時の str(e)**：`except` で捕まえた例外の `str(e)`（`args`）は、実行したときの表示言語で作る（`runPython` の `lang`。言語プロファイルの Debugger が画面の表示言語を渡す）。プログラムの出力なので、表示言語を切り替えたあとは、もう一度実行すると切り替わる
- **CPython に合わせたエンジンの変更**：
  - クラスの中で定義した関数は、メッセージでの名前にクラス名を付ける（`A.__init__()`。日本語のメッセージも同じ）
  - リストの範囲外への代入・削除は、日本語でも別の文面（`…は変更・削除できません`）にする（CPython の `list assignment index out of range` に対応させる）
- **漏れの検出**：`tests/messages-en.test.js` が、エンジンのソースからメッセージの日本語の文字列を集めて、すべて英語になることを確かめる。メッセージを増やしたら `messages-en.js` に文型を足す

## 結果

- 英語表示で、エラーの欄と `print(e)` の出力が英語になった。CPython との比較テストの例外で終わる 20 本のうち 18 本で、英語のメッセージが CPython と一字一句同じになる（残る 2 本は、案内を足した意図した違い）
- 日本語表示のメッセージは、上の 2 点（クラス名・代入の範囲外）を除いて変わらない
