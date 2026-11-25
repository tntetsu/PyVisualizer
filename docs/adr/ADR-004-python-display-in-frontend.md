# ADR-004: JSVisualizer の画面で、Python の値・行・出力を Python の書き方で見せる

- ステータス: 採用
- 日付: 2026-11-25

## 背景

PyVisualizer は JSVisualizer のフロントエンドを共有する（[ADR-001](ADR-001-repository-structure.md)）。Phase 0〜2 の時点では、フロントエンドは JS の値の形と書き方を前提にしていた。そのため、Python の値が `{ v: 79 }`・`false`・`null` のように JS の書き方で表示された。辞書は内部の形のまま表示され、`for` の各回も実行トレースに現れなかった（[phase0-report.md](../phase0-report.md) 3.3 節、[phase2-report.md](../phase2-report.md) 4 節）。

## 利用者に見える例

テストは `tests/adr-examples.test.js`（ADR-004 例1〜5）。「以前」は、直す前のフロントエンド（JSVisualizer の main）での表示。

| # | プログラム | 表示（以前 → 今） |
|---|---|---|
| 1 | `avg = sum([72, 88, 95, 61]) / 4` | 変数 `avg`：`{ v: 79 }` → `79.0` |
| 2 | `found = 3 > 5`、`x = None`、`s = "the"` | `false`・`null`・`"the"` → `False`・`None`・`'the'` |
| 3 | `d = {"a": 1, 2: None}`、`t = (1, "x")` | `{ __type__: "PyDict", keys: […], values: […] }` → `{ 'a': 1, 2: None }`（[ADR-009](ADR-009-value-notation-details.md) で `{'a': 1, 2: None}` に変えた）。`[1, "x"]` → `(1, 'x')` |
| 4 | `total = 0` / `for i in range(3):` / `    total += i` | 実行トレースの `for` の行：`range(3)` を求める 1 回だけ → それに加えて各回（`i` が 0・1・2）の計 4 回 |
| 5 | `for i in range(3):` / `    print(i, end=" ")` / `print()` | コンソール：`0 `・`1 `・`2 `・（空行）の 4 行 → `0 1 2 ` の 1 行 |

そのほか、同じ仕組みで次も Python の書き方になる。

- メモリのビューの見出し（`list[3]`・`tuple[2]`・`dict[3]`）と辞書のキー（`'to' : 2`、`(1, 2) : 'A'`）
- オブジェクトのビュー
- 配列のビューのマスの中身
- 呼び出しツリー・ライフタイムの引数
- 実行トレース・変数のビューの条件の列（`True`・`False`）
- エディタとコード表示の色分け（`def`・`elif`・`None` など）

制御フローのビューの `for` の回数も、ループの各回を数えるようになった（`for i in range(n - 1)` が ×1 → ×4）。

## 決定

JSVisualizer のフロントエンドに**言語プロファイル**を入れる（JSVisualizer の作業ブランチ `feature/multilang`。JSVisualizer 側の ADR に詳細を書く）。言語ごとの違いは、プロファイルが一か所で与える。

- 実行エンジン
- エディタの言語、サンプル、コード表示の色分け
- 実行トレースの行を作るノード型
- 値の見せ方（`valueModel`）

Python のプロファイルは [src/lang/python.js](../../src/lang/python.js)。

- `valueModel`：値の種類（float・BigInt も数、tuple は並び、dict は対応表）と書き方（`repr`）
- 実行トレースの行：`for` の各回（`LoopBinding`、[ADR-003](ADR-003-python-trace-additions.md)）を加える
- コンソール：フロントエンドが出力の断片を行にまとめる（JS の出力は断片を含まないので変わらない）

## 結果

- JS 版（JSVisualizer）の表示は変わらない（JSVisualizer の全サンプル・記事の題材・全タブで、画面の HTML を main と比べて確かめる。[phase3-report.md](../phase3-report.md)）
- 辞書のかっこの内側には空白が入る（`{ 'a': 1 }`）。Python の `repr`（`{'a': 1}`）とは少し違うが、ビューの書式（JS 版と同じ）に合わせた → [ADR-009](ADR-009-value-notation-details.md) で、Python の書き方（`{'a': 1}`）に変えた
- 1 要素のタプルは、式評価・置換のビューでは `(1)` と表示される（`repr` は `(1,)`）
- タブに登録されていないビュー（棒グラフ・タイムライン・トレース表・スコープ・アニメーション）は書き換えていない
- エラーメッセージは日本語だけ（画面を英語にしても Python のエラーは日本語のまま）
