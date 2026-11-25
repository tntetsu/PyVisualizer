# PyVisualizer 開発計画（初版 2026-11-24）

JSVisualizer の Python 版を作る。将来 C++・Java も追加できる「多言語の実行可視化基盤」に育てることを前提に設計する。

## 1. 結論：できるか

**できる。ただし「レクサーとパーサーだけ差し替える」は不可**で、共通化の単位を「評価器」ではなく「トレース（実行状態の配列）とそれを扱う層」に置く必要がある。

### 1.1 パーサー差し替えだけでは済まない理由

Python のコードを JS の AST に変換して JSInterpreter の評価器で実行すると、「Python の見た目で JS の意味」になる。教育用ツールでは誤った意味を見せること自体が致命的。

| 例 | Python の結果 | JS 評価器で動かした結果 |
|---|---|---|
| `[1, 2] + [3]` | `[1, 2, 3]` | `"1,23"` |
| `-7 % 3` / `7 // 2` | `2` / `3` | `-1` / `//` が存在しない |
| `if []:` | 偽 | 真（JS の `[]` は truthy） |
| `[1] == [1]` | `True` | `false` |
| `1 < x < 10` | 連鎖比較 | `(1 < x) < 10` |
| `print(1.0)` | `1.0` | `1` |
| ブロックスコープ | なし（関数単位、`global`/`nonlocal`） | `let` のブロックスコープ |
| デフォルト引数 | `def` 時に 1 回だけ評価 | 呼び出しごとに評価 |

### 1.2 共通化できる範囲・できない範囲

調査（JSInterpreter `85025c0`、JSVisualizer `b2d6060`）で確認した結合点：

| 層 | 現状 | Python 版での扱い |
|---|---|---|
| `Recorder`（`interpreter.js` 40–168行） | enter/exit を `trace` 配列に記録。言語非依存 | **そのまま共通化** |
| `JSDebugger` のステップ操作（stepIn/Over/Out/Back/continue） | `trace` の cursor 操作だけ | **そのまま共通化** |
| `JSDebugger.humanStep` の停止点ルール | `'CallExpression'` などの nodeType 名を直接参照 | 言語ごとの**ノード分類表**で差し替え |
| `Environment` / スナップショット | ブロックスコープ前提。`deepClone` は `__type__` を見て値を判別 | 基底クラスを共通化し、スコープ規則と値のクローン方法を言語ごとに渡す |
| `evaluate` 本体（約1000行） | JS の意味論そのもの | **言語ごとに書く**（if/while/return/break など制御構造の骨格は共通ヘルパーにできる） |
| 組み込み（`console`, `Math`, `Array`…） | ホストの JS オブジェクトをそのまま渡している | **言語ごとに書く**（`print`, `range`, `len`, list/dict のメソッド…） |
| JSVisualizer の各ビュー | `trace-builder.js`（nodeType 参照 54 箇所）、`expr-trace`・`subst-trace`・`trace-table`・`line-trace`・`exec-trace` が nodeType 名を直接参照。`format.js`・`memory-view` などが `Array.isArray` やオブジェクトのキーで値を判別し、JS の表記（`undefined`, `{a: 1}`）で表示 | **言語プロファイル**（ノード分類表＋値の表示方法）経由に書き換える |
| `debugger-adapter.js` | `JSDebugger` を包む 1 ファイル。エンジンとの境目 | エンジンを差し込む場所にする |

つまり「パーサー＋評価器（＋組み込み）」を言語ごとに書き、**それより上（トレース・デバッガー・ビュー・BhvVisualizer 連携）はすべて共通**にする。ビューは 1 万行超あるので、ここを共通にできれば言語追加のコストは大きく下がる。

## 2. アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ 可視化フロントエンド（JSVisualizer の src を言語非依存化）        │
│   views / components / step-controller / trace-builder       │
│   ↑ LanguageProfile（ノード分類・値の表示・エディタ・サンプル）  │
├─────────────────────────────────────────────────────────────┤
│ interp-core（JSInterpreter から切り出す）                      │
│   Recorder / DebuggerBase / EnvironmentBase / 制御シグナル     │
│   TraceEvent スキーマ / ExecutionError                         │
├───────────────┬───────────────┬──────────────┬──────────────┤
│ JS エンジン     │ Python エンジン │ (Java)       │ (C++)        │
│ 既存 lexer/    │ Lezer→AST 変換 │              │              │
│ parser/評価器  │ 評価器・組み込み │              │              │
└───────────────┴───────────────┴──────────────┴──────────────┘
```

### 2.1 共通の契約（ここを固めるのが計画の中心）

1. **TraceEvent スキーマ**：現行の `{phase, nodeType, loc, end, depth, callDepth, callStack, env, frameEnvs, globalBlockVars, value, matchIdx}` をそのまま全言語の共通形式にする。Python 版も**実行時の状態をすべて配列に記録する方式**（オムニシェント・デバッグ）をそのまま使う。
2. **AST のノード型名**：意味が同じ構文は JS（ESTree）の名前を使う。そうすれば既存ビューの多くが無改造で動く。
   - そのまま使える例：`IfStatement`（`elif` は else 側の入れ子 If）、`WhileStatement`、`ReturnStatement`、`BreakStatement`、`CallExpression`、`BinaryExpression`、`ConditionalExpression`、`BlockStatement`（suite）、`FunctionDeclaration`（`def`）、`ForOfStatement`（`for x in ...`）
   - Python 固有の型を追加する例：`CompareChain`、`SliceExpression`、`TupleExpression`、`ListComprehension`、`WithStatement`、`GlobalStatement`、`Assign`（Python の代入は文なので）
3. **LanguageProfile**（フロントエンドに渡す言語ごとの設定）
   - `nodeCategories`：nodeType → 意味の分類（`loop` / `branch` / `call` / `assign` / `return` / `funcDef` / `block` …）。trace-builder・humanStep・各ビューはこの分類を見る
   - `valueModel`：値を「プリミティブ / シーケンス（list, tuple, 配列）/ マップ（dict, オブジェクト）/ インスタンス / 関数」に分類し、要素を取り出す
   - `repr(value)`：表示用の文字列（Python は `None`, `True`, `'abc'`, `(1, 2)`, `{'a': 1}`）
   - エディタの言語モード、サンプル、エラー種別、ビューの有効・無効（DOM モードは JS のみ、など）

### 2.2 パーサーの選定：Lezer（`@lezer/python`）に確定

| 候補 | 評価 |
|---|---|
| **`@lezer/python`＋自前の AST 変換** | **推奨**。JSVisualizer が使っている CodeMirror 6 の公式パーサーで、インデント・f 文字列・演算子の優先順位などが実績あり。**`@lezer/java`・`@lezer/cpp` も同じ仕組み**なので、将来の言語追加でも同じ作り方ができる。位置情報（from/to）が正確に取れるので `loc`/`end` を作れる。弱点は構文エラーの説明が「ここで解析に失敗した」程度しか出ないことで、初学者向けの日本語メッセージは自前で補う |
| 手書き（JSInterpreter と同じ方式） | 日本語エラーを細かく出せるが、Python の文法（インデント、内包表記、f 文字列…）を一から書いて保守する負担が大きい。Java/C++ でも同じことを繰り返すことになる |
| Pyodide（CPython の WASM 版） | 約 10MB。`sys.settrace` で取れるのは行単位で、式単位の状態は取れない → **実行には使えない**。ただし**テストの正解（オラクル）**としては有用（4.3節） |
| Skulpt / Brython | Python を JS にコンパイルして実行する方式で、式単位の状態を配列に記録する仕組みを差し込みにくい |
| tree-sitter-python（WASM） | 能力は Lezer と同等だが、WASM の読み込みが増え、エディタとも共有できない |

> 前提条件「実行時の状態をすべて配列に記録できる」を満たすのは評価器の側なので、パーサーは既存品で問題ない。評価器は自作が必須。

### 2.3 Python の値の表現

| Python | 表現 | 理由 |
|---|---|---|
| `int` | 安全な整数の範囲は JS の `number`、超えたら `BigInt`（Phase 2 で実装） | 棒グラフ・タイムライン・配列の添字など既存ビューが数値を前提にしている |
| `float` | `PyFloat` ラッパー | `1.0` と `1` を区別して表示するため |
| `str` / `bool` / `None` | `string` / `boolean` / `null` | |
| `list` | JS の `Array` | 配列ビュー（color-box, array-grid）をそのまま使える |
| `tuple` | 印付きの `Array` | 不変であることと表示 `(1, 2)` のため |
| `dict` | `PyDict`（キーと値の配列。キーの型と挿入順を保持する。Phase 2 で実装） | `{1: 'a'}` と `{'1': 'a'}` を区別するため。JS のオブジェクトではキーが文字列になってしまう |
| `set` | 未定（MVP の対象外） | |
| 関数・クラス・インスタンス | `__type__` 付きの値（JS 版と同じ流儀） | |

`deepClone` は値の種類ごとのクローン方法を受け取れるようにする（共通コア側の変更、Phase 1 で実装）。確定した表現は [ADR-002](adr/ADR-002-python-value-representation.md)。

### 2.4 リポジトリ構成：エンジンは別リポジトリ、フロントエンドは JSVisualizer のものを共有（推奨）

- **JSInterpreter**：`src/core/` に interp-core を切り出し、パッケージのサブパス（`js-interpreter/core`）として公開する。新しいリポジトリは作らない（必要になったら後で分ける）
- **JSVisualizer**：フロントエンドを言語非依存にし、`app.js` がエンジンと LanguageProfile を外から受け取れるようにする。JS 版の挙動・デプロイは変えない
- **PyVisualizer（このリポジトリ）**：Python エンジン（`src/engine/`）と Python 用の入口（`src/app.js`：JSVisualizer の src を `file:` 依存で読み込み、Python エンジンを登録するだけ）。サイトは別にデプロイする

依存は JSInterpreter ← JSVisualizer ← PyVisualizer の一方向になり、循環しない。Java/C++ も同じ形で追加できる。いずれ 1 つのサイトで `?lang=` を切り替える形にまとめる道も残る。

### 2.5 BhvVisualizer との連携

フロントエンドのコードが共通なので、postMessage の手順（init ハンドシェイク、run/step/visibility/lifecycle イベント、ADR-028）、URL クエリ（`exercise`/`code`/`view`、ADR-029/031/036）はそのまま動く。BhvVisualizer 側の変更は小さい：

- `codes` に `language`（`'javascript'` | `'python'`、省略時は `'javascript'`）を追加し、`firestore.rules` とルールのテストを更新
- `viewer-host.js` が `language` に応じて iframe の URL と許可するオリジンを選ぶ（現在は `jsvOrigin` 1 つ）
- postMessage の `source: 'jsvisualizer'` は互換のため残し、`language` フィールドを足す
- 教員向け編集画面に言語の選択欄を追加。分析（`analysis.js`）は言語非依存のイベントしか見ていないかを確認する
- 公開 API（`functions/`）の応答に `language` を含める

## 3. フェーズ計画

**運用上の制約**：JSVisualizer と BhvVisualizer は「ソフトウェア基礎論」で本番稼働中（2026-09-30〜）。JSInterpreter・JSVisualizer に手を入れるフェーズ（1・3）は**ブランチで進め、main へのマージは学期後（2027年2月以降）**とする（6 節の決定 3）。

| Phase | 内容 | 主な成果物 | 完了条件 |
|---|---|---|---|
| **0. スパイク**（どこまで共通化できるかの見極め）✅ 2026-11-24 完了 | Lezer→AST 変換と評価器を PyVisualizer 内で作り、JSInterpreter・JSVisualizer を改変せずに組み合わせて全ビューを確認した | [phase0-report.md](phase0-report.md) | **Go**：2.1 の契約で進めてよい。Lezer で確定 |
| **1. 共通コアの切り出し**（JSInterpreter）✅ 2026-11-24 完了 | `Recorder`・`TraceDebugger`（ステップ操作・humanStep をノード分類表で）・`Scope`・クローンの hook・出力の断片（`write()`）を `src/core/` に切り出した。JS の部品はその派生クラスにし、挙動は変えていない。Python エンジンは Phase 0 の回避策をすべて外してコアの API に乗せ換え、`for x in` の各回で止まるようにした（`LoopBinding`） | `js-interpreter/core`（作業ブランチ `feature/interp-core`、worktree `../JSInterpreter-core`。JSInterpreter の ADR-015）、[phase1-report.md](phase1-report.md) | JSInterpreter のテスト 284 件（既存 266＋コア 18）が通り、master と作業ブランチのトレースが 194 プログラム・約 24 万イベントで一致（`scripts/compare-js-core.mjs`） |
| **2. Python エンジン MVP**（PyVisualizer）✅ 2026-11-25 完了 | 4.1 節の範囲を実装。辞書を `PyDict` に作り直し（キーの型と挿入順）、大きな整数（BigInt）、連続代入。行単位の変数の状態を CPython と比べるテストを追加 | `src/engine/`、[phase2-report.md](phase2-report.md)、ADR-002・003 | CPython との比較（出力 31 件・変数の状態 23 件）を含む 95 件がすべて通る |
| **3. フロントエンドの言語非依存化**（JSVisualizer）✅ 2026-11-25 完了 | 言語プロファイル（エンジン・エディタ・サンプル・色分け・実行トレースの行・値の見せ方 `valueModel`）を入れ、コンソールが出力の断片を行にまとめるようにした。PyVisualizer は Python のプロファイルを登録して動く（停止点の統一はしなかった。理由は [phase3-report.md](phase3-report.md) 2.3 節） | JSVisualizer の作業ブランチ `feature/multilang`（worktree `../JSVisualizer-multilang`、JSVisualizer の ADR-055）、PyVisualizer の ADR-004、[phase3-report.md](phase3-report.md) | JS 版の画面の HTML が main と一致（`scripts/capture-js-dom.mjs`）、JSVisualizer のテスト 213 件・PyVisualizer のテスト 104 件が通る |
| **4. PyVisualizer アプリ** ✅ 2026-11-25 完了（公開は Phase 5 の後、2026-11-25） | サンプル 23 本（`samples/samples.json` で表示名・分類）、全サンプル × 全タブの確認、Python 版のマニュアル（日本語・英語）、GitHub Pages のワークフロー（手動実行のみ。公開は判断待ち） | [phase4-report.md](phase4-report.md) | 全サンプル × 全タブでブラウザのエラー 0 件、テスト 122 件が通る。公開は未実施 |
| **5. Python の対象拡大** ✅ 2026-11-25 完了 | 基本の拡張（内包表記・set・del・スライスへの代入・ループの else・% 書式・*args/**kwargs）、例外（try/except/else/finally・raise・assert）、class（継承・super()・特殊メソッド）、import math と input()（画面の入力欄）。ジェネレーターは対象外 | [phase5-report.md](phase5-report.md)、ADR-005〜007 | CPython との比較（出力 58 件・変数の状態 37 件）を含む 166 件がすべて通る |
| **6. BhvVisualizer 連携** | 2.5 節の変更 | | 既存の e2e（exercise-flow・viewer-host・analysis-dashboard）＋ Python のコードを使う e2e が通る |
| 7.（将来）Java / C++ | 同じ手順でエンジンを追加 | | |

Phase 2 と Phase 3 は並行して進められる。Phase 0 の結果、評価器の制御構造ヘルパーは共通化しない（Python の評価器は Recorder・シグナル・Environment を使うだけで十分簡潔に書けた）。

## 4. Python エンジンの詳細方針

### 4.1 MVP の対象範囲

- 型：`int`, `float`, `str`, `bool`, `None`, `list`, `tuple`, `dict`, `range`
- 文：代入（タプルのアンパック、`+=` など）、`if/elif/else`、`while`、`for ... in`、`break`/`continue`、`def`/`return`（デフォルト引数）、`pass`、`global`/`nonlocal`
- 式：算術（`//`, `%`, `**` は Python の意味で）、連鎖比較、`and`/`or`/`not`、`in`/`not in`、`is`、添字（負の添字）、スライス、条件式
- 組み込み：`print`（`sep`/`end`）、`len`, `range`, `abs`, `min`, `max`, `sum`, `sorted`, `str`, `int`, `float`, `list`, `append`/`pop`/`insert` など
- 対象外（MVP）：ジェネレーター/`yield`、`async`、デコレーター、`import`（`math` など一部を後で組み込みとして用意する）

### 4.2 スコープ

Python の LEGB 規則に従う。関数本体の中で代入される名前はその関数のローカル（代入前に読むと `UnboundLocalError`）。そのため `def` を評価する前に、本体の代入先を静的に集めておく。ブロックごとの環境は作らない。ビュー側から見た `env` / `frameEnvs` の形は JS 版と同じにする。

### 4.3 テスト方針：CPython を正解にする比較テスト

- サンプルとテスト用プログラムを実際の CPython（`python3`）でも実行し、`print` 出力と例外の種類が一致することを確認する
- さらに `sys.settrace` で**行単位**の変数の状態を CPython から取り出し、PyDebugger のトレースを行単位にまとめたものと比較する。これで評価器の意味論の誤りを機械的に見つけられる（式単位の比較はできないので、式の評価は単体テストで確認する）

## 5. リスク

| リスク | 対策 |
|---|---|
| フロントエンドの言語非依存化（Phase 3）で、本番稼働中の JS 版を壊す | ブランチで進め、Playwright のスクリーンショット比較で見た目が変わらないことを確認。main へのマージは学期後（2027年2月以降） |
| Lezer の構文エラーが初学者に分かりにくい | よくある誤り（`:` の付け忘れ、インデントの不一致、括弧の閉じ忘れ）は専用のチェックで日本語メッセージを出す。Phase 0 で質を評価し、不十分なら手書きパーサーに切り替える |
| 置換ビュー・式評価ビューがソース文字列の置換で表示しているため、Python の構文（`elif`、内包表記、インデント）で崩れる | Phase 0 で確認する。崩れるビューは Python 版では一旦無効にする（LanguageProfile で切り替え） |
| C++ のポインタ・スタック上のメモリ、Java の静的型は今の値の表現に収まらない | `valueModel` に「アドレス」「型名」を持たせる余地を最初から残しておく。具体化は Phase 7 で |
| 実行速度（Python は組み込みのラッパーが増える） | maxSteps（10 万）は共通。比較テストに大きめの入力を含めて計測する |

## 6. 決定事項（2026-11-24）

| # | 論点 | 決定 |
|---|---|---|
| 1 | リポジトリ構成 | 2.4 節の案で進める（エンジンは別リポジトリ、フロントエンドは JSVisualizer のものを共有、サイトは別）。[ADR-001](adr/ADR-001-repository-structure.md) |
| 2 | パーサー | Lezer（`@lezer/python`）で進め、Phase 0 で評価してから確定する → **Lezer で確定**（2026-11-24。Phase 0 の評価は [phase0-report.md](phase0-report.md) 4 節） |
| 3 | JSVisualizer・JSInterpreter への変更をマージする時期 | **学期後（2027年2月以降）**。それまではブランチで進める（6.1 節） |
| 4 | MVP の対象範囲 | 4.1 節の範囲。現時点で授業で使う予定はない |

| 5 | PyVisualizer の公開（GitHub Pages） | **Phase 5 の完了時に公開する**（2026-11-25）。公開の前に、README.md・マニュアルなどを公開にふさわしい内容にする（JSVisualizer のリポジトリと同程度。6.2 節）。**リポジトリも公開する**（2026-11-25。非公開のまま有料のプランで Pages を使う案は採らない） |

### 6.1 決定を受けた進め方

- **ブランチの置き場所**：JSInterpreter・JSVisualizer の作業ブランチは `git worktree` で別のディレクトリ（例：`../JSInterpreter-core`、`../JSVisualizer-multilang`）に取り出す。元の作業ディレクトリは main のまま残し、授業中の修正はそちらで行う。PyVisualizer の `file:` 依存は worktree 側を指す
- **main への追従**：学期中に main へ入った修正は、作業ブランチへ定期的に取り込む（rebase または merge）。Phase 1・3 の「JS 版の挙動が変わらない」確認は、マージ直前に main の最新に対してもう一度行う
- **PyVisualizer のサイト**：別サイトなので、マージ前でもブランチのフロントエンドを使って公開できる。学生の画面には影響しない
- **Phase 6（BhvVisualizer 連携）**：授業で使う予定がないため後回しにする。Phase 4 まで終えてから、必要になった時点で着手する → **今期の授業（ソフトウェア基礎論）が終わってから着手する**（2026-11-25 決定）。BhvVisualizer は授業で使っているので、学期中は作業ブランチも作らない。着手するときは、ほかの兄弟リポジトリと同じく `git worktree` の作業ブランチで進め、エミュレータで確認してから、確認を取って本番に反映する
- **Phase 5（対象拡大）**：授業の演習に合わせる必要がないので、Phase 4 の後に必要なものから進める

### 6.2 公開の前に整えるもの（決定 5）

JSVisualizer のリポジトリと同程度にする。JSVisualizer には次のものがある。

- README.md・README.en.md（それぞれ約 330 行。概要・使い方・ビューの説明・開発の方法など）
- LICENSE
- 画像（`img/`）
- 利用者向けマニュアル（日本語・英語）

PyVisualizer では次を行った（2026-11-25）。

- README.md・README.en.md を書いた（JSVisualizer の README と同程度）
- マニュアルは Phase 5 で増えた範囲に合わせてある（Phase 5 で更新済み）
- 公開してよい文書かを見直した。授業の運用の記述は、公開中の JSVisualizer のリポジトリと同程度なのでそのままにした。論文の投稿の予定の記述は、今のファイルから消した（履歴には残る。履歴は書き換えないと決めた）
- リポジトリを公開すると決めた（決定 5）
- ワークフローの `push` のトリガーを有効にした（`main` への push で公開する）
