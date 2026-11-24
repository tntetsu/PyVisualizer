# Phase 2（Python エンジン MVP）報告書（2026-11-25）

[開発計画書](development-plan.md) 3 節 Phase 2 の結果。目的は、計画書 4.1 節の MVP の範囲で Python の意味論を正しく再現するエンジンを仕上げること。完了条件は、計画書 4.3 節の CPython との比較テストが通ること。

## 1. 結論

**完了。** Phase 0 のスパイクのコードを土台に、残っていた 3 つの作業を済ませた。

- 辞書の表現の作り直し
- 大きな整数
- 連続代入

さらに、計画書 4.3 節の後半「行単位の変数の状態を CPython と比べるテスト」を作った。CPython との比較はすべて一致する。

| テスト | 件数 | 内容 |
|---|---|---|
| CPython と出力・例外の種類を比べる（`tests/oracle.test.js`） | 31 | サンプル 17 本、意味論のテストケース 6 本、例外のテストケース 8 本 |
| CPython と変数の状態の変化を比べる（`tests/line-state.test.js`、**新規**） | 23 | 例外で終わらないプログラム全部 |
| 構文エラー・AST（`tests/parse.test.js`） | 18 | |
| JSVisualizer の TraceBuilder に通す（`tests/trace-builder.test.js`） | 18 | |
| PyDebugger と共通コア（`tests/debugger.test.js`） | 5 | |
| **計** | **95** | すべて通る |

## 2. 作業の内容

### 2.1 辞書を作り直した（[ADR-002](adr/ADR-002-python-value-representation.md)）

`{ __type__: 'PyDict', keys: [...], values: [...] }` にした（検索用の索引は列挙されない `_index`）。Phase 0 の表現（JS のプレーンオブジェクト）の制約がなくなった。

- キーに int・float・bool・str・tuple・None・range・関数を使える。list・dict は `TypeError: unhashable type`
- Python と同じく `1`・`1.0`・`True` は同じキー。既にあるキーに代入しても、キーそのものは最初に入れたものを保つ
- 挿入順を保つ（JS のオブジェクトは整数風のキーを先頭に並べ替えるので、Phase 0 の表現では保てなかった）
- メソッド：`get`・`keys`・`values`・`items`・`pop`・`setdefault`・`update`・`copy`・`clear`。`dict()` は、辞書・(キー, 値) の並び・キーワード引数から作れる

### 2.2 大きな整数（ADR-002）

int は、安全な整数の範囲（±(2^53−1)）では JS の number、超えたら BigInt で表し、常にこの形に保つ。

- 演算（`+ - * // % **`）は、number で正確に計算できないときだけ BigInt で計算し直す
- 比較・`==`・辞書のキー・`int()`・`str()`・`abs()`・`sum()`・`round()`・f 文字列の `d`・`,` に対応した
- 大きな整数のリテラル（`12345678901234567890`）は、AST に 10 進の文字列（`bigint`）として持たせる（AST は JSON にできる形のまま）
- **ついでに直した誤り**：ビット演算（`& | ^ << >> ~`）を JS の number で計算していたので、32 ビットを超えると誤っていた（`1 << 40` が `256` になっていた）。常に BigInt で計算するようにした

画面では `15511210043330985984000000` のように正しく表示される。ブラウザのエラーもない。

### 2.3 連続代入

`a = b = c = 0` に対応した。値を 1 回だけ評価し、左の代入先から順に代入する（Python と同じ）。AST は ESTree の形を保ち、最初の代入先を `left`、残りを `extraTargets` に入れた。

### 2.4 変数の状態を CPython と比べるテスト（計画書 4.3 節の後半）

出力の比較では見えない、途中の変数の値の誤りを見つけるためのテスト。

- CPython 側（`tests/tools/trace_states.py`）：`sys.settrace` で、各行の実行前と関数を抜けるときに、そのフレームのローカル変数の `repr` を取る。前回から変わったものを「関数名:変数名=repr」として順に記録する
- PyDebugger 側（`tests/line-state.test.js`）：トレースのうち、同じ時点に当たるイベントで同じように記録する。該当するのは、各文の enter、`for` の各回のループ変数への代入（`LoopBinding`）の enter、関数を抜ける直前のイベント
- 2 つの「変化の列」が一致することを確かめる

作る途中で、トレースに記録が 2 つ足りないことが分かった（[ADR-003](adr/ADR-003-python-trace-additions.md)）。

- `sorted(key=lambda ...)` のように組み込み関数がユーザー定義の関数を続けて呼ぶと、トレースから呼び出しの切れ目が分からない → コールスタックのフレームに呼び出しごとの番号 `callId` を持たせた
- CPython は `for` の行でも毎回チェックするので、ループ変数の変化と本体の変化を別々の時点で記録する → `LoopBinding` の enter もチェックする時点に加えた

制約が 2 つある。

- 1 行に複数の文（`a = 1; b = 2`）を書くと、チェックする時点の細かさが違うので一致しない。テストのプログラムでは書かない
- 例外で終わるプログラムは、例外の直前の変化の扱いが両者で違うので、出力の比較だけを行う

## 3. MVP の範囲（計画書 4.1 節）と残り

4.1 節の範囲はすべて実装した。

- 型：int（大きな整数を含む）・float・str・bool・None・list・tuple・dict・range
- 文：代入（アンパック・`+=`・連続代入）・if/elif/else・while・for・break/continue・def/return（デフォルト引数・キーワード引数）・pass・global/nonlocal
- 式：Python の意味の算術・連鎖比較・and/or/not・in/not in・is・負の添字・スライス・条件式・lambda・f 文字列
- 組み込み関数 23 個と、list・str・dict の主なメソッド

対象外のまま（Phase 5 の候補）：class、try/except、内包表記、set、`*args`/`**kwargs`、`input()`、import（`math` など）、ジェネレーター、文字列の `%` 書式、`while ... else`・`for ... else`、スライスへの代入、`del`。

既知の制約：

- 再帰の上限は Node の既定のスタックで約 290 段（CPython は 1000 段。[phase0-report.md](phase0-report.md) 3.2 節 g）
- 文字列の長さ・添字は UTF-16 の単位で数える。絵文字など、BMP の外の文字を含む文字列では Python と結果が違う（日本語の文字は BMP の中なので問題ない）
- 大きな整数どうしの `/` は、最後の桁が CPython と違うことがありうる（ADR-002）

## 4. 画面への影響と、Phase 3 に回す項目

PyVisualizer はまだ公開していないので、利用者への影響はない。JSVisualizer の画面に差し込んだ確認（`scripts/capture-spike.mjs`）で分かった次の点を、Phase 3（フロントエンドの言語非依存化）で直す。

- **dict が内部の形のまま表示される**：`{ __type__: "PyDict", keys: [...], values: [...] }`。メモリのビューでは、キーと値の 2 つの配列に見える。Phase 0 の時点（JS のオブジェクトで表していた）より表示は悪くなったが、Phase 3 の `valueModel` で直す前提で、意味論の正しさを優先した
- tuple が list と同じ形で、float が `{ v: 79 }` で表示される（Phase 0 から）
- Exec Trace などのビューが `LoopBinding` を知らない。コンソールが出力の断片を 1 行ずつ表示する（[phase1-report.md](phase1-report.md) 5.2 節）
