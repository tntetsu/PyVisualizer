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
- パーサーは `@lezer/python` ＋ 自前の AST 変換を第一候補とし、Phase 0 で評価して確定する

[BhvVisualizer](../BhvVisualizer)（学習ログの収集・分析）と組み合わせて授業で使えるようにすることも目標です。

**現在のステータス**: 計画段階（2026-11-24 にリポジトリを作成）。[docs/development-plan.md](docs/development-plan.md) 6 節の「決めてほしいこと」への回答待ち。次は Phase 0（スパイク）。

## 関連リポジトリ

| リポジトリ | 役割 | PyVisualizer との関係 |
|---|---|---|
| [../JSInterpreter](../JSInterpreter) | JS インタプリタ（`JSDebugger`・`Recorder`） | 共通コア（Recorder・ステップ操作・Environment 基底）をここから切り出して共有する（Phase 1） |
| [../JSVisualizer](../JSVisualizer) | 可視化フロントエンド（ビュー 20 種前後） | フロントエンドを言語非依存にして共有する（Phase 3） |
| [../BhvVisualizer](../BhvVisualizer) | 学習ログ収集・分析（Firebase） | `codes.language` を追加して Python のコードも扱う（Phase 6） |

## リポジトリ構成

```
PyVisualizer/
├── docs/
│   └── development-plan.md   # 開発計画書（アーキテクチャ・フェーズ・リスク・未決事項）
├── CLAUDE.md                 # このファイル
├── README.md
└── LICENSE
```

予定する構成（Phase 2・4 以降）：`src/engine/`（Lezer→AST 変換・評価器・組み込み・`PyDebugger`）、`src/app.js`（JSVisualizer のフロントエンドに Python エンジンを登録する入口）、`web/`、`tests/`、`docs/adr/`。

## 作業上の注意

### 本番稼働中の兄弟リポジトリへの変更

JSVisualizer と BhvVisualizer は「ソフトウェア基礎論」（2026-09-30〜）で本番稼働中。BhvVisualizer は JSVisualizer の公開版を `<iframe>` で埋め込んでいるため、JSVisualizer の main への push はその日のうちに学生の画面を変える。

- JSInterpreter・JSVisualizer・BhvVisualizer への変更（共通コアの切り出し、フロントエンドの言語非依存化など）は**ブランチで進め、main へのマージは確認を取ってから**行う
- 変更する場合は、それぞれのリポジトリの CLAUDE.md の手順（回帰テスト・ドキュメント更新・評価計画への記録）に従う

### ドキュメント

- ドキュメントは日本語で書く
- 設計上の決定は `docs/adr/ADR-NNN-*.md` に記録する（JSVisualizer と同じ流儀）
- 計画・方針を変えたら [docs/development-plan.md](docs/development-plan.md) とこのファイルのステータスを更新する

### テスト

Python の意味論の正しさは、同じプログラムを CPython（`python3`）でも実行して比較するテストで確認する（[docs/development-plan.md](docs/development-plan.md) 4.3 節）。
