# ADR-001: リポジトリ構成 — エンジンは別リポジトリ、フロントエンドは JSVisualizer と共有、サイトは別

- ステータス: 採用
- 日付: 2026-11-24

## 背景

PyVisualizer は JSVisualizer の Python 版で、将来は C++・Java も追加する。Python は JS と意味論が違うため評価器は言語ごとに書くが、トレース（実行状態の配列）より上の層（ステップ操作・ビュー・BhvVisualizer 連携）は共通にしたい（[development-plan.md](../development-plan.md) 1・2 節）。共通部分をどのリポジトリに置き、Python 版をどうデプロイするかを決める必要がある。

## 選択肢

1. **エンジンは別リポジトリ、フロントエンドは JSVisualizer のものを共有、サイトは別**
2. JSVisualizer に Python エンジンも入れ、1 つのサイトで `?lang=python` を切り替える
3. JSVisualizer のフロントエンドを PyVisualizer にコピーして独自に育てる

## 決定

選択肢 1 を採る。

- **JSInterpreter**：共通コア（`Recorder`・ステップ操作・`Environment` 基底・TraceEvent 形式）を `src/core/` に切り出し、`js-interpreter/core` として公開する
- **JSVisualizer**：フロントエンドを言語非依存にし、エンジンと LanguageProfile を外から受け取れるようにする。JS 版の挙動とデプロイは変えない
- **PyVisualizer**：Python エンジンと、JSVisualizer のフロントエンドに Python エンジンを登録する入口を持ち、JS 版とは別のサイトとしてデプロイする

## 理由

- 依存が JSInterpreter ← JSVisualizer ← PyVisualizer の一方向になり、循環しない
- 本番稼働中の JSVisualizer に Python エンジンを持ち込まずに済み、JS 版のデプロイに影響しない
- ビュー（1 万行超）を 1 か所で保守できる。選択肢 3 はビューの改善が二重になる
- Java・C++ も同じ形（エンジンのリポジトリ＋入口）で追加できる。後で 1 つのサイトにまとめる（選択肢 2）道も残る

## 影響

- JSInterpreter・JSVisualizer に言語非依存化の変更が必要。授業中のため、ブランチ（`git worktree` で別ディレクトリ）で進め、main へのマージは学期後（2027年2月以降）とする（[development-plan.md](../development-plan.md) 6 節）
- PyVisualizer は JSVisualizer を `file:` 依存で参照するため、ビルドには兄弟ディレクトリに JSInterpreter・JSVisualizer（の作業ブランチ）が必要
- BhvVisualizer から使う場合は、`codes.language` に応じて iframe の URL と許可するオリジンを切り替える
