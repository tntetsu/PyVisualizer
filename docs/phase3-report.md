# Phase 3（フロントエンドの言語非依存化）報告書（2026-11-25）

[開発計画書](development-plan.md) 3 節 Phase 3 の結果。目的は、JSVisualizer のフロントエンドを言語に依存しない形にし、PyVisualizer がそれを Python で使えるようにすること。条件は、本番稼働中の JS 版の見た目と挙動を変えないこと。

## 1. 結論

**完了。** JSVisualizer のフロントエンドに**言語プロファイル**を入れた（JSVisualizer の ADR-055、作業ブランチ `feature/multilang`、worktree `../JSVisualizer-multilang`）。PyVisualizer は、それに Python のプロファイルを登録して動く（[ADR-004](adr/ADR-004-python-display-in-frontend.md)）。

| 項目 | 結果 |
|---|---|
| JS 版の表示 | 組み込みサンプル 21 本・記事の題材 29 本 × 5 つのステップ位置 × 全タブ（3,050 件）で、画面の HTML が main と一致（遅延描画の 1 件は待ち時間を延ばして一致。3 節） |
| JSVisualizer のテスト | 213 件がすべて通る（既存 210 件＋コンソールの断片をまとめる処理 3 件） |
| PyVisualizer のテスト | 104 件がすべて通る（ADR-004 の例 5 件を含む） |
| Python 版の画面 | 全サンプル × 全タブでブラウザのエラー 0 件。値・行・出力が Python の書き方で表示される |
| main へのマージ | 学期後（2027年2月以降）。PyVisualizer は作業ブランチを `file:../JSVisualizer-multilang` で参照する |

## 2. 言語プロファイル

JSVisualizer の `src/lang/index.js` に登録所（`setLanguage`・`getLanguage`）を置いた。既定は JS（`src/lang/javascript.js`）。フロントエンドの部品は、使うときにプロファイルから取り出す。

| 項目 | 使う部品 | JS | Python（PyVisualizer の `src/lang/python.js`） |
|---|---|---|---|
| `Debugger`・`ExecutionError` | 実行（`debugger-adapter.js`） | `JSDebugger` | `PyDebugger` |
| `editorExtension` | エディタ | CodeMirror の JS モード | `@codemirror/lang-python` |
| `samples`・`sampleGroups`・`defaultSample` | サンプル選択 | 組み込みサンプル 21 本 | `samples/*.py`（17 本） |
| `syntaxTokens` | コード表示の色分け | JS のキーワード | `def`・`elif`・`None` など |
| `traceRowTypes` | 実行トレースなどの行 | これまでの集合 | `for` の各回（`LoopBinding`）を加える |
| `valueModel` | 値を表示するすべてのビュー | これまでの判定・書き方 | `79.0`・`None`・`True`・`'abc'`・`(1, 2)`・`{ 'a': 1 }`、`list[3]`・`dict[2]` |

PyVisualizer の入口（[src/app.js](../src/app.js)）は、`register-python.js`（`setLanguage`）を先に import してから、JSVisualizer の `app.js` を import する。ESM は import を順に評価するので、JSVisualizer の部品が動く前に Python のプロファイルが登録される。

### 2.1 値の見せ方（valueModel）

値を JS の形に**変換せず**、ビューは見せ方だけを `valueModel` に尋ねる（`kind`・`literal`・`entries`・`length`・`label`・`shortLabel`・`brackets`・`numberValue`）。変換しないのは、メモリ・オブジェクトのビューが「同じオブジェクトを指しているか」を値そのものの同一性で判定しているため。

ビューは整形の規則（文字列の切り詰め方、`undefined` を `undef` と略すことなど）をこれまでどおり持ち、言語で変わる部分だけを尋ねる。書き換えたのは次の部品で、どれも JS 版では旧コードと同じ文字列を作る。

- `format.js` の 4 関数
- メモリ・オブジェクト・配列（color-box・array-grid）・ライフタイム・呼び出しツリー
- 実行トレース・変数のビューの条件の列

### 2.2 ノード型名

ビューのノード型名の参照（`'IfStatement'` など約 40 か所）は、プロファイルに移さなかった。Python の AST は、意味が同じ構文に ESTree と同じ名前を使う（計画書 2.1 節）ので、言語で違うのは実行トレースの行の集合だけだった。制御フロー・ヒートマップの `for` の回数は、Phase 1 で入れた `LoopBinding` が `for` の行で毎回記録されるので、変更なしで各回を数えるようになった。

### 2.3 停止点の統一はしなかった

Phase 0・1 で、「ステップのボタン（デバッガー）の停止点」と「実行トレースなどの行（`TraceBuilder`）」が JS 版でも少しずれていることが分かっていた。調べたところ、`TraceBuilder` の規則はデバッガーの写しではなく、「表の行をどこで作るか」という別の設計だった。たとえば、ネイティブ関数を含むすべての呼び出しの exit で行を作る。統一すると JS 版の表示が変わるので、統一はせず、行を作るノード型をプロファイルで与える形にした。Python では `for` の各回（`LoopBinding`）を加えたので、ボタンとビューのずれはなくなった。

## 3. JS 版の表示が変わらないことの確認

PyVisualizer の [scripts/capture-js-dom.mjs](../scripts/capture-js-dom.mjs) を作った。JSVisualizer のビルドを配信し、組み込みサンプルと記事の題材のすべてで、5 つのステップ位置ごとに全タブの次の 5 つを記録する。

- ステップ位置：最初・人で 5 つ・式で 3 つ・人でさらに 15・最後
- 記録するもの：`#view-container` の HTML、コンソール、ステップ数、エラー表示、コード表示

main と作業ブランチで記録して 1 件ずつ比べた。

- **3,050 件中 3,049 件が一致した。** 残る 1 件は、`bubbleSort` の「最初」の位置の実行トレースで、25 行目の配列の図が main では描かれ、作業ブランチではまだ空の枠だった
- 実行トレースのビューは、図が見える範囲に入ってから描く（遅延描画）。記録はタブを切り替えて 60 ms 後に取るので、それまでに描き終わるかどうかで結果が変わる
  - 同じ条件で 3 回取り直すと、main どうしは 3 回とも一致し、作業ブランチは 3 回とも 25 行目がまだ描かれていなかった
  - 待ちを 600 ms にすると、main と作業ブランチは完全に一致した
- つまり、**描かれる内容は同じで、作業ブランチは遅延描画がわずかに遅い**。値を表示するたびに言語プロファイルを参照する分と考えられる。利用者が見る最終的な表示は変わらない
- 上限（50,000 ステップ）まで回る無限ループの題材 `12-list-bug`（連結リストのつなぎ替えの誤り）は、全タブの描画に非常に時間がかかるため、この比較から外した。main と作業ブランチで同じように描画に時間がかかることは確かめた。JS の実行結果は Phase 1 のトレースの比較（`scripts/compare-js-core.mjs`）で一致している
- どちらのビルドでもブラウザのエラーは 0 件

## 4. Python 版の画面

| ビュー | 結果 |
|---|---|
| コールスタック・変数・実行トレース | 値が Python の書き方。実行トレースに `for` の各回の行が出る。条件の列は `True`/`False` |
| 置換・式評価 | 値が Python の書き方で置き換わる（`{ 'to': 2, … }.get('to', 0) + 1`）。`print` などの組み込み関数は置き換えない |
| 配列 | list・tuple の要素が Python の書き方。小数も数として色分けされる |
| メモリ・オブジェクト | `list[3]`・`tuple[2]`・`dict[3]` の見出し。辞書のキーは `'to'`・`(1, 2)` |
| ヒートマップ・制御フロー | `for` の行が各回を数える（`for i in range(n - 1)` が ×4） |
| 呼び出しツリー・ライフタイム | 引数が Python の書き方 |
| コンソール | `print(x, end=" ")` の出力が 1 行につながる |
| エディタ・コード表示 | Python の色分け。画面の名前は「PyVisualizer」 |

## 5. 残っていること

- **辞書の表記の細部**：かっこの内側に空白が入る（`{ 'a': 1 }`。Python の `repr` は `{'a': 1}`）。1 要素のタプルは、式評価・置換では `(1)`（`repr` は `(1,)`）
- タブに登録されていないビュー（棒グラフ・タイムライン・トレース表・スコープ・アニメーション）は書き換えていない
- 画面を英語にしても、Python のエラーメッセージは日本語のまま
- マニュアル（使い方のボタン）は JS 版のものが開く
- Phase 4（PyVisualizer アプリ）：マニュアル、サンプルの見直し、デプロイ（GitHub Pages）
