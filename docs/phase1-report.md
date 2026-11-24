# Phase 1（共通コアの切り出し）報告書（2026-11-24）

[開発計画書](development-plan.md) 3 節 Phase 1 の結果。目的は、JSInterpreter から言語に依存しない部品を切り出し、Python の評価器が回避策なしで使えるようにすること。条件は、JS 版の挙動を変えないこと。

## 1. 結論

**完了。** JSInterpreter に言語非依存の共通コア `js-interpreter/core` を切り出した。Python エンジンは、Phase 0 の回避策をすべて外し、このコアの API だけで動く。JS 版の挙動は変わっていない。

| 項目 | 結果 |
|---|---|
| JSInterpreter のテスト | 既存 266 件＋コア 18 件＝284 件がすべて通る（ADR-016 の取り込み後は 287 件） |
| JS 版の挙動 | master と作業ブランチのトレースが、194 プログラム・約 24 万イベントですべて一致（[scripts/compare-js-core.mjs](../scripts/compare-js-core.mjs)） |
| PyVisualizer のテスト | 67 件がすべて通る（CPython との比較を含む） |
| 置き場所 | JSInterpreter の作業ブランチ `feature/interp-core`（worktree `../JSInterpreter-core`）。master へのマージは学期後（2027年2月以降） |

設計の決定は JSInterpreter の [ADR-015](https://github.com/tntetsu/JSInterpreter/blob/feature/interp-core/docs/adr/ADR-015-shared-core.md)、詳細は同じブランチの `docs/detailed-design.md` §12 にある。

## 2. 共通コアの中身

| ファイル | 中身 | JS の派生クラス |
|---|---|---|
| `src/core/recorder.js` | `Recorder(maxSteps, { clone, formatLog, echo })`。出力の断片を記録する `write()`、TraceEvent にフィールドを足す `eventExtras()`、`joinConsoleLines()` | `Recorder`（console.log の整形・端末への出力・`domSnapshot`） |
| `src/core/trace-debugger.js` | `TraceDebugger`（トレースを受け取るだけのデバッガー）。humanStep の停止点は `static nodeCategories`（役割ごとの nodeType の一覧）で決める。`ExecutionError`・`finalizePartialTrace()` | `JSDebugger`（JS の実行・DOM モード・`JS_NODE_CATEGORIES`） |
| `src/core/scope.js` | `Scope`（`bindings`・スナップショットだけ。参照・代入の規則は持たない） | `Environment`（const・TDZ・未定義変数のエラー） |
| `src/core/clone.js` | `deepClone(val, seen, hook)`・`createCloner(hook)` | — |
| `src/core/signals.js` | `ReturnSignal` など | — |

## 3. Phase 0 の項目の解消

[phase0-report.md](phase0-report.md) 3.2 節の回避策が、それぞれ次のように不要になった。

| # | Phase 0 の問題 | Phase 1 での解消 |
|---|---|---|
| a | `JSDebugger` のコンストラクターが中で JS をパースする | `PyDebugger extends TraceDebugger` で、トレースを渡すだけ。`fromTrace()` も派生クラスのインスタンスを返す |
| b | `Environment` が JS の規則を持つ | `PyScope extends Scope`（Python のスコープ情報 `pyScope` を持つ） |
| c | `captureLog` が JS の書式で整形し端末に出す | コアの `Recorder` は既定で整形しない・端末に出さない |
| d | `print(x, end=" ")` を表せない | `recorder.write()` で出力の断片（`eol: false`）として記録。行にまとめるのは `joinConsoleLines()` |
| e | クローンで tuple の印が落ちる | `createCloner(pyCloneHook)` で tuple の印を保つ |
| f | `for x in` の各回で humanStep が止まらない | 評価器が各回のループ変数への代入を `LoopBinding` として記録し、`PY_NODE_CATEGORIES.stopOnExit` に入れた |
| g | 再帰の上限（約 290 段） | 残す（Phase 0 の判断どおり） |

## 4. 検証の方法

- **JS 版の挙動**：master と作業ブランチの両方の `JSDebugger` で同じプログラムを実行し、全 TraceEvent（変数のスナップショット・コールスタック・値を含む）、consoleLogs、humanStep の停止点、getResult、例外を 1 件ずつ比べた。対象は次のとおり。スタックオーバーフローで止まるプログラムは、止まる深さが実行ごとに変わる（JSInterpreter ADR-014）ので、共通の長さまでを比べた
  - JSVisualizer の組み込みサンプル・記事の題材
  - JSInterpreter の examples
  - BhvVisualizer の授業の演習（24 ファイル）
  - エラー・上限超過・DOM モードなどの追加ケース
- **コアの API**：JS の評価器を使わず、テストの中で組み立てた小さな言語の評価器から使うテスト（`src/core/core.test.js`、18 件）
- **Python から使えること**：PyVisualizer のテスト（`tests/debugger.test.js`：LoopBinding・while の停止点・tuple のクローン・出力の断片・fromTrace）と、画面の確認（`scripts/capture-spike.mjs`、ブラウザのエラー 0 件）

## 5. 見つかったこと

### 5.1 JSInterpreter の既存の不具合（ADR-016、対応済み）

トレースの比較で、`console.log(1, "a")` が Node.js の `1 a` ではなく `1 'a'` と表示される不具合が見つかった。2026-06-04 のコミット `6def082` 以来の不具合で、ソフトウェア基礎論 第11回 課題3（Moodle の短答の正答 `insert 2 at 0`）に影響していた。第11回の前に master を直し、JSVisualizer の公開版を再デプロイした（2026-11-24 21:27）。BhvVisualizer の評価計画 3.9 節に記録した。共通コアのブランチにも取り込み済み。

### 5.2 Phase 3 に回す項目

- **Exec Trace などのビューが LoopBinding を知らない**：ステップのボタン（`dbg.humanStep()`）は各回の `for` で止まるようになった。一方 Exec Trace などのビューは、JSVisualizer の `TraceBuilder.buildHumanIndices()` が独自に計算した停止点を使っているため止まらない。JS 版でも、この 2 つの停止点は少しずれている（[phase0-report.md](phase0-report.md) 3.2 節の参考）。ビューの停止点を、デバッガーのもの（ノード分類表）に統一する
- **コンソールが出力の断片を 1 行ずつ表示する**：`print(x, end=" ")` の断片が別々の行に見える。コンソールのビューで `joinConsoleLines()` を使う

## 6. 運用

- PyVisualizer の `js-interpreter` は `file:../JSInterpreter-core`（作業ブランチの worktree）を指す。別の PC では `git -C ../JSInterpreter worktree add ../JSInterpreter-core feature/interp-core` で作る（CLAUDE.md）
- master に修正が入ったら、作業ブランチに merge で取り込み（GitHub にプッシュ済みなので rebase はしない）、`scripts/compare-js-core.mjs` で master とのトレースの一致を確かめる
