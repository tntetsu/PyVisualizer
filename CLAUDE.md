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

**現在のステータス**: Phase 0（スパイク）・Phase 1（共通コアの切り出し）完了（2026-11-24）。Phase 0 の結果は **Go**（[docs/phase0-report.md](docs/phase0-report.md)）、パーサーは Lezer で確定。Phase 1 で JSInterpreter に言語非依存の共通コア `js-interpreter/core` を切り出し（作業ブランチ `feature/interp-core`、JSInterpreter の ADR-015、[docs/phase1-report.md](docs/phase1-report.md)）、Python エンジンはその API だけで動く。方針（[docs/development-plan.md](docs/development-plan.md) 6 節）：リポジトリ構成は [ADR-001](docs/adr/ADR-001-repository-structure.md)、JSInterpreter・JSVisualizer への変更の main へのマージは学期後（2027年2月以降）、MVP は 4.1 節の範囲、BhvVisualizer 連携（Phase 6）は後回し。次は Phase 2（Python エンジン MVP）と Phase 3（フロントエンドの言語非依存化、JSVisualizer の作業ブランチで）。

## 関連リポジトリ

| リポジトリ | 役割 | PyVisualizer との関係 |
|---|---|---|
| [../JSInterpreter](../JSInterpreter) | JS インタプリタ（`JSDebugger`・`Recorder`） | 共通コア `js-interpreter/core` をここに切り出して共有する（Phase 1 完了。作業ブランチ `feature/interp-core`、worktree `../JSInterpreter-core`） |
| [../JSVisualizer](../JSVisualizer) | 可視化フロントエンド（ビュー 20 種前後） | フロントエンドを言語非依存にして共有する（Phase 3） |
| [../BhvVisualizer](../BhvVisualizer) | 学習ログ収集・分析（Firebase） | `codes.language` を追加して Python のコードも扱う（Phase 6） |

## リポジトリ構成

```
PyVisualizer/
├── src/engine/               # Python エンジン（Phase 0 のスパイクで作成、Phase 2 の土台）
│   ├── parse.js              # Lezer の木 → AST、インデントの検査、構文エラーの日本語説明
│   ├── interpreter.js        # 評価器（LEGB スコープ・Python の演算）。js-interpreter/core の Recorder・Scope 等を使う
│   ├── builtins.js           # 組み込み関数・list/str/dict のメソッド・f 文字列の書式指定
│   ├── values.js             # 値の表現（PyFloat・tuple・dict・PyRange）、repr/str、比較、反復
│   └── py-debugger.js        # PyDebugger（TraceDebugger の派生、PY_NODE_CATEGORIES。debugger-adapter.js が使う名前でも export）
├── samples/                  # Python のサンプル（JSVisualizer の組み込みサンプルに対応）
├── tests/
│   ├── oracle.test.js        # CPython（python3）を正解とした比較（samples/ と tests/cases/）
│   ├── parse.test.js         # 構文エラーの検出と説明、AST の形
│   ├── trace-builder.test.js # トレースを JSVisualizer の TraceBuilder に通す
│   ├── debugger.test.js      # PyDebugger と共通コアの組み合わせ（LoopBinding・tuple のクローン・出力の断片）
│   └── cases/                # 意味論・例外の比較用の Python プログラム
├── scripts/
│   ├── build-spike.mjs       # JSVisualizer のフロントエンドに Python エンジンを差し込んで web/ にビルド
│   ├── capture-spike.mjs     # 全サンプル × 全タブのスクリーンショットとブラウザのエラーを収集
│   └── compare-js-core.mjs   # JSInterpreter の master と作業ブランチで JS のトレースを 1 件ずつ比べる
├── web/                      # ビルド出力（gitignore 対象）
├── docs/
│   ├── development-plan.md   # 開発計画書（アーキテクチャ・フェーズ・リスク・決定事項）
│   ├── phase0-report.md      # Phase 0 の報告書（共通化の検証、ビューごとの問題、Lezer の評価）
│   ├── phase1-report.md      # Phase 1 の報告書（共通コアの中身、Phase 0 の項目の解消、検証の方法）
│   ├── phase0/               # 報告書のスクリーンショット
│   └── adr/                  # Architecture Decision Records（ADR-001〜）
├── CLAUDE.md                 # このファイル
├── README.md
└── LICENSE
```

## コマンド

```bash
npm install                            # 兄弟ディレクトリに ../JSInterpreter-core・../JSVisualizer が必要（file: 依存。下記）
npm test                               # 全テスト（node:test。CPython との比較に python3 が必要）
node scripts/build-spike.mjs --serve   # http://127.0.0.1:8123/?exercise=/samples/python.json で確認
node scripts/capture-spike.mjs <出力先> [サンプルid...]   # スクリーンショットの収集
node scripts/compare-js-core.mjs       # JSInterpreter の master と作業ブランチで JS のトレースが一致するか
```

> **依存先**：`js-interpreter` は JSInterpreter の作業ブランチ `feature/interp-core` を指す（`file:../JSInterpreter-core`。`git -C ../JSInterpreter worktree add ../JSInterpreter-core feature/interp-core` で作る）。共通コア（`js-interpreter/core`）は main（master）にはまだない（学期後にマージ）。`js-visualizer` は `file:../JSVisualizer`（main のまま。Phase 3 で作業ブランチに切り替える）。

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

Python の意味論の正しさは、同じプログラムを CPython（`python3`）でも実行して比較するテストで確認する（[docs/development-plan.md](docs/development-plan.md) 4.3 節）。
