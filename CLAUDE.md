# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

**PyVisualizer** は、[JSVisualizer](../JSVisualizer)（JavaScript プログラムの実行過程を可視化する教育用 Web アプリ）の Python 版です。将来 C++・Java も追加できる「多言語の実行可視化基盤」に育てることを前提に設計します。

方針の要点（詳細は [docs/development-plan.md](docs/development-plan.md)）：

- **評価器は Python 用に新しく書く**。JS の AST に変換して [JSInterpreter](../JSInterpreter) の評価器で動かす方式は、Python と意味が違う（`[1,2]+[3]`、`-7 % 3`、`if []:` など）ため採らない
- **共通化はトレース（実行状態の配列）より上の層で行う**。JSInterpreter の `Recorder`・ステップ操作・TraceEvent 形式と、JSVisualizer のビュー・BhvVisualizer 連携を共有する
- **実行時の状態はすべて配列に記録する**（オムニシェント・デバッグ。JSInterpreter と同じ方式）
- AST のノード型名は、意味が同じ構文には JS（ESTree）の名前を流用し、Python 固有の構文には新しい型を足す
- 言語ごとの差（ノードの分類・値の表示・エディタ・サンプル）は **LanguageProfile** でフロントエンドに渡す
- パーサーは `@lezer/python` ＋ 自前の AST 変換（インデントの検査と構文エラーの説明は自前）で確定（Phase 0 で評価）

[BhvVisualizer](../BhvVisualizer)（学習ログの収集・分析）と組み合わせて授業で使えるようにすることも目標です。

**現在のステータス**: Phase 0〜5 完了・公開済み（2026-11-25）。リポジトリも公開し、`main` への push で GitHub Pages（https://tntetsu.github.io/PyVisualizer/）に公開される（[docs/development-plan.md](docs/development-plan.md) 6 節の決定 5・6.2 節）。報告書は [docs/phase0-report.md](docs/phase0-report.md)〜[docs/phase5-report.md](docs/phase5-report.md)。パーサーは Lezer で確定。共通コア `js-interpreter/core` は JSInterpreter の作業ブランチ `feature/interp-core`（JSInterpreter の ADR-015）。フロントエンドは JSVisualizer の作業ブランチ `feature/multilang` の言語プロファイル（JSVisualizer の ADR-055）を使い、Python のプロファイルは [src/lang/python.js](src/lang/python.js)（[ADR-004](docs/adr/ADR-004-python-display-in-frontend.md)）。Python の値の表現は [ADR-002](docs/adr/ADR-002-python-value-representation.md)、トレースへの追加は [ADR-003](docs/adr/ADR-003-python-trace-additions.md)、Phase 5 で入れた機能は ADR-005〜007、公開後の修正は ADR-008（コード表示のオレンジを式にだけ付ける）・ADR-009（値の表記の細部・制御フローのループの else）・ADR-010（エラーメッセージを表示言語に合わせる。英語は CPython と同じ文面）・ADR-011（入門でよく使う書き方）・ADR-012（デコレーター・with・match）・ADR-013（random などのモジュール）。ジェネレーター（yield）とファイル（open()）は見送った（2026-11-25）。方針：リポジトリ構成は [ADR-001](docs/adr/ADR-001-repository-structure.md)、JSInterpreter・JSVisualizer への変更の main へのマージは学期後（2027年2月以降）、BhvVisualizer 連携（Phase 6）は今期の授業が終わってから着手する（2026-11-25 決定）。

## 関連リポジトリ

| リポジトリ | 役割 | PyVisualizer との関係 |
|---|---|---|
| [../JSInterpreter](../JSInterpreter) | JS インタプリタ（`JSDebugger`・`Recorder`） | 共通コア `js-interpreter/core` をここに切り出して共有する（Phase 1 完了。作業ブランチ `feature/interp-core`、worktree `../JSInterpreter-core`） |
| [../JSVisualizer](../JSVisualizer) | 可視化フロントエンド（ビュー 20 種前後） | フロントエンドを言語非依存にして共有する（Phase 3） |
| [../BhvVisualizer](../BhvVisualizer) | 学習ログ収集・分析（Firebase） | `codes.language` を追加して Python のコードも扱う（Phase 6） |

## リポジトリ構成

```
PyVisualizer/
├── src/app.js                # PyVisualizer の入口（register-python.js → JSVisualizer の app.js の順に import）
├── src/register-python.js    # JSVisualizer のフロントエンドに Python の言語プロファイルを登録する
├── src/lang/python.js        # Python の言語プロファイル（エンジン・エディタ・色分け・実行トレースの行・valueModel。ADR-004）
├── src/engine/               # Python エンジン（Phase 0 のスパイクで作成、Phase 2 の土台）
│   ├── parse.js              # Lezer の木 → AST、インデントの検査、構文エラーの日本語説明
│   ├── interpreter.js        # 評価器（LEGB スコープ・Python の演算）。js-interpreter/core の Recorder・Scope 等を使う
│   ├── builtins.js           # 組み込み関数・list/str/dict のメソッド・f 文字列の書式指定
│   ├── values.js             # 値の表現（int の number/BigInt・PyFloat・tuple・set・PyDict・PyRange。ADR-002・005）、repr/str、比較、反復
│   ├── objects.js            # クラス（PyClass・C3 の MRO）・インスタンス・例外のクラスの階層・特殊メソッドの呼び出し（ADR-006）
│   ├── modules.js            # import できるモジュール（実行ごとに作る。ADR-007・013）
│   ├── lib/                  # math 以外のモジュール：random.js（CPython と同じ MT19937）・datetime.js（datetime・time）・collections.js（collections・copy・statistics・string）。ADR-013
│   ├── messages-en.js        # エラーメッセージの英語化（日本語の文型 → CPython と同じ英語。ADR-010）
│   └── py-debugger.js        # PyDebugger（TraceDebugger の派生、PY_NODE_CATEGORIES。debugger-adapter.js が使う名前でも export）
├── samples/                  # Python のサンプル 27 本（JSVisualizer の組み込みサンプルに対応）と samples.json（表示名・分類・既定。ビルドが食い違いを検出する）
├── manual/                   # 利用者向けマニュアル（manual.html・manual.en.html と ja/・en/ のスクリーンショット）。ビルドが web/ にコピーする
├── .github/workflows/deploy.yml  # GitHub Pages へのデプロイ（main への push と手動実行。兄弟リポジトリの作業ブランチを clone してビルド）
├── tests/
│   ├── oracle.test.js        # CPython（python3）を正解とした比較（samples/ と tests/cases/）
│   ├── parse.test.js         # 構文エラーの検出と説明、AST の形
│   ├── trace-builder.test.js # トレースを JSVisualizer の TraceBuilder に通す
│   ├── debugger.test.js      # PyDebugger と共通コアの組み合わせ（LoopBinding・tuple のクローン・出力の断片）
│   ├── line-state.test.js    # 変数の状態の変化の列を CPython と比べる（tools/trace_states.py が CPython 側）
│   ├── adr-examples.test.js  # 利用者に見える ADR の例をそのままテストにしたもの（テスト名に ADR 番号）
│   ├── messages-en.test.js   # エラーメッセージの英語化。エンジンのソースからメッセージを集めて訳し漏れを検出する（ADR-010）
│   ├── format.test.js        # 書式指定（f 文字列・format()）と小数の repr を CPython と比べる（ADR-011）
│   ├── tools/trace_states.py # CPython で sys.settrace を使い、変数の状態の変化の列を JSON で出す
│   └── cases/                # 意味論・例外の比較用の Python プログラム
├── scripts/
│   ├── build.mjs             # web/ にビルド（JSVisualizer のフロントエンド＋Python のプロファイル。CodeMirror の重複を避ける）
│   ├── capture-spike.mjs     # 全サンプル × 全タブのスクリーンショットとブラウザのエラーを収集
│   ├── capture-manual-screenshots.mjs  # マニュアルのスクリーンショットを manual/ja・manual/en に撮り直す
│   ├── compare-js-core.mjs   # JSInterpreter の master と作業ブランチで JS のトレースを 1 件ずつ比べる
│   └── capture-js-dom.mjs    # JSVisualizer（JS 版）の全サンプル・全タブの画面の状態を記録し、2 つのビルドを比べる（Phase 3）
├── web/                      # ビルド出力（gitignore 対象）
├── docs/
│   ├── development-plan.md   # 開発計画書（アーキテクチャ・フェーズ・リスク・決定事項）
│   ├── phase0-report.md      # Phase 0 の報告書（共通化の検証、ビューごとの問題、Lezer の評価）
│   ├── phase1-report.md      # Phase 1 の報告書（共通コアの中身、Phase 0 の項目の解消、検証の方法）
│   ├── phase2-report.md      # Phase 2 の報告書（辞書・大きな整数・連続代入、変数の状態の比較テスト）
│   ├── phase3-report.md      # Phase 3 の報告書（言語プロファイル、JS 版の画面の一致の確認、Python 版の画面）
│   ├── phase4-report.md      # Phase 4 の報告書（サンプル、マニュアル、デプロイの準備）
│   ├── phase5-report.md      # Phase 5 の報告書（基本の拡張・例外・class・import math と input()）
│   ├── phase0/               # 報告書のスクリーンショット
│   └── adr/                  # Architecture Decision Records（ADR-001〜）
├── CLAUDE.md                 # このファイル
├── README.md / README.en.md
└── LICENSE
```

## コマンド

```bash
npm install                            # 兄弟ディレクトリに ../JSInterpreter-core・../JSVisualizer が必要（file: 依存。下記）
npm test                               # 全テスト（node:test。CPython との比較に python3 が必要）
node scripts/build.mjs --serve         # http://127.0.0.1:8123/ で確認
node scripts/capture-manual-screenshots.mjs   # 画面を変えたらマニュアルのスクリーンショットを撮り直す
node scripts/capture-spike.mjs <出力先> [サンプルid...]   # スクリーンショットの収集
node scripts/compare-js-core.mjs       # JSInterpreter の master と作業ブランチで JS のトレースが一致するか
```

> **依存先**：`js-interpreter` は JSInterpreter の作業ブランチ `feature/interp-core` を指す（`file:../JSInterpreter-core`。`git -C ../JSInterpreter worktree add ../JSInterpreter-core feature/interp-core` で作る）。共通コア（`js-interpreter/core`）は main（master）にはまだない（学期後にマージ）。`js-visualizer` は JSVisualizer の作業ブランチ `feature/multilang` を指す（`file:../JSVisualizer-multilang`。`git -C ../JSVisualizer worktree add ../JSVisualizer-multilang feature/multilang` で作る。言語プロファイルは main にはまだない）。

> テストは Jest ではなく Node 標準の `node:test` を使う（ES modules のまま追加の設定なしで動くため）。

## 作業上の注意

### 本番稼働中の兄弟リポジトリへの変更

JSVisualizer と BhvVisualizer は「ソフトウェア基礎論」（2026-09-30〜）で本番稼働中。BhvVisualizer は JSVisualizer の公開版を `<iframe>` で埋め込んでいるため、JSVisualizer の main への push はその日のうちに学生の画面を変える。

- JSInterpreter・JSVisualizer・BhvVisualizer への変更（共通コアの切り出し、フロントエンドの言語非依存化など）は**ブランチで進め、main へのマージは学期後（2027年2月以降）**。マージの前には必ず確認を取る
- 作業ブランチは `git worktree` で別ディレクトリ（例：`../JSInterpreter-core`、`../JSVisualizer-multilang`）に取り出す。元の作業ディレクトリは main のまま残す（授業中の修正用）。PyVisualizer の `file:` 依存は worktree 側を指す
- 変更する場合は、それぞれのリポジトリの CLAUDE.md の手順（回帰テスト・ドキュメント更新・評価計画への記録）に従う

### ドキュメント

- ドキュメントは日本語で書く
- 設計上の決定は `docs/adr/ADR-NNN-*.md` に記録する（JSVisualizer と同じ流儀）
- 計画・方針を変えたら [docs/development-plan.md](docs/development-plan.md) とこのファイルのステータスを更新する

### テスト

**利用者に見える ADR には例とテストを付ける**（2026-11-25、JSVisualizer と同じ約束）：画面やステップ実行で何が表示される／されないかを決める・直す ADR には、利用者に見える例（入力のプログラムと「表示される／されない」）を実装用語なしで書き、同じ例をテストにする（テスト名に ADR 番号を入れる。`tests/adr-examples.test.js`）。テストは、直す前のコードで失敗することを確かめてから足す。内部の構造だけの ADR には求めない。

Python の意味論の正しさは、同じプログラムを CPython（`python3`）でも実行して比較するテストで確認する（[docs/development-plan.md](docs/development-plan.md) 4.3 節）。出力と例外の種類（`tests/oracle.test.js`。英語表示でも実行し、出力と例外のメッセージを CPython と比べる。ADR-010）と、変数の状態の変化の列（`tests/line-state.test.js`）の 2 つを比べる。`samples/` と `tests/cases/` に置いた `.py` は自動で両方の対象になる（`error_`（例外で終わる）・`output_`（`sorted` が特殊メソッドを呼ぶ順序など、変数の状態を比べられない）で始まるテストケースは出力の比較だけ）。`input()` で読む行は、同じ名前の `.stdin` ファイルに書く（CPython 側は `tests/tools/run_echo.py` で、読んだ行を表示する形にそろえる）。1 行に複数の文を書くと変数の状態の比較が合わなくなるので書かない。
