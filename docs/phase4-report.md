# Phase 4（PyVisualizer アプリ）報告書（2026-11-25）

[開発計画書](development-plan.md) 3 節 Phase 4 の結果。目的は、PyVisualizer をアプリとして仕上げること。完了条件は「全サンプルがエラーなく実行でき、全タブで表示が正しい」。

## 1. 結論

**公開（デプロイ）以外は完了。公開は Phase 5 の完了時に行う。** 全 23 サンプル × 全 12 タブでブラウザのエラーはなく、表示も確認した。Python 版のマニュアル（日本語・英語、スクリーンショット 18 枚ずつ）を作った。GitHub Pages へのデプロイは、ワークフローを用意し、まっさらな環境でワークフローと同じ手順を再現して動くことを確かめた。公開は **Phase 5 の完了時**に行うと決めた（2026-11-25）。それまでワークフローは手動実行だけにしておく（4 節）。

| 項目 | 結果 |
|---|---|
| サンプル | 23 本（6 本追加）。表示名と分類は `samples/samples.json` |
| 全サンプル × 全タブ | ブラウザのエラー 0 件（`scripts/capture-spike.mjs`） |
| テスト | 122 件がすべて通る（サンプルが増えた分、CPython との比較が増えた） |
| マニュアル | `manual/manual.html`（日本語）・`manual/manual.en.html`（英語）。画面の「?」から開く |
| デプロイ | `.github/workflows/deploy.yml`（手動実行のみ）。まっさらな環境で同じ手順のテスト・ビルド・ブラウザでの起動を確認 |

## 2. サンプル

JSVisualizer の組み込みサンプル 21 本に対応させた。JS 版にあって Python 版になかった 6 本を足し、表示名・分類も JS 版と同じ形にした（`samples/samples.json`）。足した 6 本は次のとおり。

- 文字列のキーでソート
- 連結リスト（辞書で作ったもの）
- 練習用の 4 本（ウォームアップ、課題 1〜3）

JS 版の「クラスと継承」は、Python の `class` が MVP の対象外なので作っていない。

ビルドは、`samples.json` と `samples/*.py` が食い違うと（登録していない `.py`、ファイルのない項目）エラーにする。`samples/` に置いた `.py` は、CPython との出力と変数の状態の比較テストの対象にもなる。

## 3. マニュアル

JSVisualizer のマニュアル（2026-11-25 時点）をもとに、Python 版として書き換えた。以後は PyVisualizer で管理する。ビューの説明は言語に依存しないので、ほぼそのまま使った。書き換えたのは次の箇所。

- 名前
- `print()`
- サンプルの表
- 使える Python の範囲（値・文・式・組み込み関数・まだ使えないもの）
- 再帰の深さの上限
- エラーの説明と画像（コロン忘れ）
- `or`・`and`、`True`・`False`
- 「人」のステップで止まるところ（`for` のループ変数が次の値になるところ）
- エラーメッセージが日本語だけであること
- 「まだ対応していません」のときの対処

スクリーンショットは `scripts/capture-manual-screenshots.mjs`（JSVisualizer の同名のスクリプトを Python のサンプル用にしたもの）で撮る。ビルドが `manual/` を `web/` にコピーする。

## 4. デプロイ（Phase 5 の完了時に公開）

`.github/workflows/deploy.yml` を用意した。CI で兄弟リポジトリを次のように clone し、テスト・ビルドのあと `web/` を GitHub Pages に公開する。

- JSInterpreter の作業ブランチ → `../JSInterpreter-core`
- JSInterpreter の master → `../JSInterpreter`
- JSVisualizer の作業ブランチ → `../JSVisualizer-multilang`

まっさらなディレクトリで同じ手順（clone・`npm ci`・テスト・ビルド）を再現し、テスト 122 件が通り、ビルドしたものがブラウザでエラーなく動くことを確かめた。

**決定（2026-11-25）**：今は公開しない。Phase 5 の完了時に公開する。公開の前に、README.md・マニュアルなどを公開にふさわしい内容にする（JSVisualizer のリポジトリと同程度。[計画書](development-plan.md) 6.2 節）。

公開のときに決めること：

- PyVisualizer のリポジトリは非公開（private）。非公開のリポジトリで GitHub Pages を使うには、有料のプラン（GitHub Pro など）が必要。公開されたサイト自体は、誰でも見られる
- サイトを公開すると、PyVisualizer の存在が外から見えるようになる

## 5. 残っていること

- **公開**：Phase 5 の完了時。その前に README.md・マニュアルなどを整える（計画書 6.2 節）
- 辞書のかっこの内側の空白（`{ 'a': 1 }`）、1 要素のタプルの表記（式評価・置換で `(1)`）
- 画面を英語にしても、Python のエラーメッセージは日本語のまま
- Phase 5（Python の対象拡大：class・try/except・内包表記など）、Phase 6（BhvVisualizer 連携）は計画どおり後回し
