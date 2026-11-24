# Phase 0（スパイク）報告書（2026-11-24）

[開発計画書](development-plan.md) 3 節 Phase 0 の結果。目的は「2.1 節の共通の契約（TraceEvent・ESTree 名の AST・LanguageProfile）で進めてよいか」と「Lezer を採用してよいか」の判断。

## 1. 結論

**計画どおり進めてよい（Go）。Lezer も採用してよい**（2026-11-24 に Lezer で確定）。

- **JSInterpreter と JSVisualizer を 1 行も改変せずに**、Python エンジンを差し込んだ JSVisualizer が動いた。差し込みは、esbuild で `debugger-adapter.js` の import 1 行を Python エンジンに向け替えただけ（[scripts/build-spike.mjs](../scripts/build-spike.mjs)）
- Python 版のサンプル 15 本 × 全 12 タブ × 2 時点（途中・最後）で、ブラウザのエラーは 0 件。Python の意味論は **CPython との比較テスト 28 件がすべて一致**
- 12 タブのうち、**構造が壊れたビューはない**。問題は「値の表示が JS の書き方になる」「エディタの色分けが JS 用」など、計画書が Phase 3 で LanguageProfile に移すとしていた範囲に収まった
- 予想していなかった課題が 3 つ見つかった。いずれも計画の範囲内で対処できる
  - Lezer がインデントの誤りを検出しない → 自前の検査で対処済み
  - Python の `for` ループで「人にやさしい単位」のステップが各回に止まらない → Phase 1 に追加
  - Node での再帰の上限が約 290 段 → 記録のみ

## 2. 作ったもの

| ファイル | 行数 | 内容 |
|---|---|---|
| [src/engine/parse.js](../src/engine/parse.js) | 556 | Lezer の木 → AST の変換、インデントの検査、構文エラーの日本語説明 |
| [src/engine/interpreter.js](../src/engine/interpreter.js) | 527 | 評価器（LEGB スコープ、Python の演算・真偽・反復・代入） |
| [src/engine/builtins.js](../src/engine/builtins.js) | 280 | 組み込み関数 23 個、list/str/dict のメソッド、f 文字列の書式指定 |
| [src/engine/values.js](../src/engine/values.js) | 203 | 値の表現（2.3 節）、repr/str、比較、反復 |
| [src/engine/py-debugger.js](../src/engine/py-debugger.js) | 63 | `JSDebugger` と同じ API の `PyDebugger` |
| [tests/](../tests/) | — | CPython との比較 28 件、構文エラー 18 件、TraceBuilder 16 件（計 62 件） |
| [samples/](../samples/) | — | JSVisualizer の組み込みサンプルに対応する Python 版 15 本（class を使うものを除く） |
| [scripts/capture-spike.mjs](../scripts/capture-spike.mjs) | — | 全サンプル × 全タブのスクリーンショットと、ブラウザのエラーの収集 |

対象範囲は計画書 4.1 節の MVP のほぼ全部（`global`/`nonlocal`、デフォルト引数、キーワード引数、タプルのアンパック、スライス、連鎖比較、f 文字列を含む）。スパイクのコードは捨てずに Phase 2 の土台にする。

## 3. 共通化の検証

### 3.1 無改造で使えたもの

| 部品 | 結果 |
|---|---|
| `Recorder`（enter/exit の記録・変数のスナップショット・コールスタック） | そのまま使えた。Python の関数呼び出しでも `frameEnvs` などが JS 版と同じ形になる |
| 制御シグナル（`ReturnSignal` など） | そのまま使えた |
| `Environment`・`deepClone` | 使えた（ただし 3.2 節の b・e） |
| `JSDebugger` のステップ操作・humanStep・`ExecutionError` | `JSDebugger.fromTrace()` で作ったインスタンスで動いた（3.2 節の a） |
| JSVisualizer の `TraceBuilder`（制御フロー用の `buildCFG()` を含む全メソッド） | Python の AST とトレースで動いた |
| JSVisualizer の全 12 タブ | 動いた。表示の問題は 3.3 節 |
| エラー表示 | 構文エラー・実行時エラーとも JS 版と同じ形で表示され、エラーの直前まではステップ操作できる（[画像](phase0/runtime-error.png)） |

フィボナッチの Python 版と JS 版の比較（変数・実行トレース・置換の各ビュー）：[phase0/fib-py-vs-js.png](phase0/fib-py-vs-js.png)

### 3.2 回避策が必要だったもの → Phase 1（共通コアの切り出し）で直す

| # | 問題 | スパイクでの回避策 | Phase 1 での対処 |
|---|---|---|---|
| a | `JSDebugger` のコンストラクターが中で JS をパースする | `fromTrace()` でインスタンスを作り、プロトタイプを差し替えた | デバッガーの基底クラスはトレースを受け取るだけにし、エンジンを外から渡す |
| b | `Environment.get/set` が JS の規則（const、エラー文言）を持つ | `bindings`（Map）を直接操作し、Python のスコープ情報を `env.pyScope` に持たせた | 言語の規則を持たない基底クラスにする |
| c | `Recorder.captureLog` が JS の書式で整形し、端末にも出力する | 派生クラスで上書きした | 整形と端末への出力を外から差し替えられるようにする |
| d | `consoleLogs` が 1 行 1 件なので、`print(x, end=" ")` が行の途中で表示されない | 改行までためてから 1 行として記録した（行が完成するまでコンソールに出ない） | 出力を「行」ではなく「文字列の断片」として記録できるようにする（コンソールのビューは Phase 3） |
| e | `deepClone` が、列挙されない印（tuple・dict の目印）を落とす | tuple はスナップショットでは list に見える。dict のキーは str だけ | 値の種類ごとのクローン方法を渡せるようにする（2.3 節の予定どおり） |
| f | **Python の `for x in ...` で、humanStep が各回に止まらない**。ループ変数への代入がトレースに残らないため。JS の `for...of` も同じだが、Python ではこれがループの基本形 | なし | ループ変数への代入をトレースに記録し、humanStep の停止点に加える（ノード分類表の `loop` に含める） |
| g | 再帰の上限：Node の既定のスタックで **Python 版 291 段**（JS 版は 187 段）。CPython の上限は 1000 段 | スタックがあふれたら `RecursionError` として扱った | 当面はこのまま。授業で使う程度の再帰には足りる。深い再帰が必要になったら評価器を明示的なスタックで書き直す（大きな変更） |

参考（Python 版とは無関係）：JS 版でも、`JSDebugger._getHumanIndices()` と JSVisualizer の `TraceBuilder.buildHumanIndices()` の停止点は一致していない（JSDebugger 側にだけ `CallExpression` の enter と `LogicalExpression` の exit がある）。JSVisualizer に元からある差で、意図したものかは未確認。

### 3.3 フロントエンドの表示の問題 → Phase 3（言語非依存化）で直す

| ビュー | 結果 | Python 版での問題 |
|---|---|---|
| コールスタック | ○ | 値の表示（下記） |
| 変数 | ○ | 値の表示。条件の列が `true`/`false` |
| 実行トレース | ○ | `true`/`false` |
| 置換 | ○ | なし |
| 式評価 | ○ | `print(...)` の値が `None` ではなく `null` |
| 配列 | ○（ポインタ表示も動く） | なし（[画像](phase0/bubble-arrays-controlflow.png)） |
| ヒートマップ | ○ | なし |
| 呼び出しツリー | ○ | なし（組み込み関数の呼び出しは JS 版と同じく出ない） |
| ライフタイム | ○ | なし |
| 制御フロー | ○ | `for` の回数の意味が違う。JS は条件式の評価回数、Python の `for x in` は入った回数になる（ループの回数を数える方式にそろえる） |
| メモリ | ○（辞書の参照の矢印も動く） | `None` が `null`、辞書が `Object` と表示される |
| オブジェクト | ○（辞書で作った二分木がグラフになる） | 同上（[画像](phase0/tree-memory-objects-calltree-lifetime.png)） |

すべてのビューに共通する問題（[画像](phase0/value-display-issues.png)）：

- **値の表示が JS の書き方**：float が `{ v: 79 }`（正しくは `79.0`）、`True` が `true`、`None` が `null`、文字列が `"the"`（Python は `'the'`）、辞書が `{ the: 3 }`（Python は `{'the': 3}`）。`PyFloat` に `valueOf`/`toString` を持たせる工夫は、ビューがオブジェクトのキーを並べるので効かなかった。→ LanguageProfile の `repr` と `valueModel` を経由させる（計画どおり）
- エディタとコード表示の色分けが JS 用（`def` が着色されない）→ `@codemirror/lang-python`
- 画面の名前「JSVisualizer」、組み込みサンプル、マニュアルへのリンク → Phase 4 の入口で差し替え

## 4. Lezer の評価

**採用を推奨する。**

- 正しいコードの解析：サンプル 15 本・テストケース 13 本、および連鎖比較・`elif`・f 文字列・スライス・タプルの代入・ラムダ・行継続・括弧の中の改行・三重引用符の文字列を、すべて正しく解析できた
- 木の形は平たい（`elif` が `if` と同じ階層に並ぶ、`a, b = b, a` は `=` と `,` のトークンの並び、連鎖比較は左結合の入れ子）。AST への変換で組み立て直す必要があるが、変換は約 550 行で済んだ
- **インデントの誤りを検出しない**：余計なインデント、字下げの不一致、タブと空白の混在の 3 つは、エラーなしで解析されてしまう。どれも初学者の典型的な誤りなので、行単位の自前の検査（括弧の中・文字列の中・行継続を除外する、約 80 行）を先に走らせて対処した
- エラーノードは位置しか教えてくれない。そこで、エラーの位置の行を見て説明を選ぶ方式にし、典型的な 10 種の誤りに日本語の説明を付けた

| 誤り | 表示されるメッセージ |
|---|---|
| `if x > 1`（コロン忘れ） | 行末に「:」がありません |
| `print((1 + 2)` | 括弧が閉じていません |
| `def f():` の次の行を字下げしない | 「:」の次の行はインデント（字下げ）が必要です |
| 余計なインデント | 予期しないインデントがあります |
| 字下げの不一致 | インデントの深さが、外側のどの行ともそろっていません |
| `if x = 1:` | 条件で等しいかを調べるときは「=」ではなく「==」を使います |
| `print("abc)` | 文字列の引用符が閉じていません |
| `if (x > 1) {` | Python ではブロックを { } ではなく「:」とインデントで表します |
| if のない `else:` | 対応する if がない else があります |
| タブと空白の混在 | インデントにタブと空白が混ざっています |

手書きのパーサーにした場合と比べても、メッセージの質に大きな差は出ないと判断した。Python の文法を自前で保守する負担を負わずに済む利点のほうが大きい。

## 5. 値の表現（計画書 2.3 節）について分かったこと

- **dict をプレーンオブジェクトで表すのはやめる**：スパイクではキーを str に限った。しかし JS のオブジェクトは整数のような文字列キー（`"2"`）を先頭に並べ替えるので、キーが int の辞書では Python の挿入順を保てない。キーの型と順序を保持する `PyDict`（キーと値の配列）にし、ビューには `valueModel` 経由で見せる
- **int を JS の number で表すのは問題なかった**：配列の添字・棒グラフ・ヒートマップなどがそのまま動く。2^53 を超える整数（大きな階乗など）は未対応のまま
- `round(2.675, 2)` のような浮動小数点の細部も、CPython と一致させられた（double の正確な 10 進展開で丸める）

## 6. 計画への反映

- Phase 1（共通コアの切り出し）の作業項目に 3.2 節の a〜f を加える
- Phase 3（言語非依存化）の作業項目は 3.3 節の表のとおり。表示の問題は値の表示とノードの意味の 2 系統に集約できるので、LanguageProfile の `repr`/`valueModel`/`nodeCategories` の設計で足りる見込み
- Phase 2（Python エンジン MVP）はスパイクのコードを土台にする。残りは、PyDict、tuple のスナップショット、2^53 を超える int、行単位の状態を CPython と比べるテスト（計画書 4.3 節の後半）
- スパイクのビルド（`scripts/build-spike.mjs`）は、Phase 3 の言語非依存化が済むまでの確認手段として残す

## 7. 再現方法

```bash
npm install                                   # 兄弟ディレクトリに JSInterpreter・JSVisualizer が必要
npm test                                      # 62 件（CPython との比較には python3 が必要）
node scripts/build-spike.mjs --serve          # http://127.0.0.1:8123/?exercise=/samples/python.json
node scripts/capture-spike.mjs <出力先>        # 全サンプル × 全タブのスクリーンショット
```
