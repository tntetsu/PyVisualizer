# ADR-003: Python のトレースに足したもの（LoopBinding・callId・出力の断片）

- ステータス: 採用
- 日付: 2026-11-25

## 背景

TraceEvent の形式は、JS と全言語で共通にする（[development-plan.md](../development-plan.md) 2.1 節）。ただし Python の評価器には、JS の評価器にはない記録が 3 つ必要になった。

1. `for x in ...` は Python のループの基本形だが、各回のループ変数への代入がトレースに残らない。そのため、humanStep が各回で止まらない（[phase0-report.md](../phase0-report.md) 3.2 節 f）
2. 組み込み関数がユーザー定義の関数を続けて呼ぶ場合（`sorted(key=lambda ...)` など）、呼び出しが同じ深さで続く。そのため、トレースから呼び出しの切れ目が分からない
3. `print(x, end=" ")` のように、行の途中で終わる出力がある

## 利用者に見える例

テストは `tests/adr-examples.test.js`（ADR-003 例）。

```python
total = 0
for i in range(3):
    total += i
```

「人」の単位で進めると、次の 7 か所で止まる。`for` の行で止まるたびに、`i` がその回の値（0、1、2）になっている。以前は `for` の行では止まらず、3 行目だけで止まっていた。

1. 1 行目（`total` が 0 になる）
2. 2 行目（`i` が 0 になる）→ 3. 3 行目
4. 2 行目（`i` が 1 になる）→ 5. 3 行目（`total` が 1 になる）
6. 2 行目（`i` が 2 になる）→ 7. 3 行目（`total` が 3 になる）

## 決定

| 追加 | 内容 | 使う側 |
|---|---|---|
| `LoopBinding` ノード | `for` の各回のループ変数への代入を、`{ type: 'LoopBinding', loc, end }`（`loc`・`end` はループ変数の位置）の enter/exit として記録する。AST にはないノードで、評価器が記録するときだけ作る | `PY_NODE_CATEGORIES.stopOnExit` に入れ、humanStep が各回で止まる。変数の状態の比較テストも、CPython の `for` の行の line イベントに当たる時点として使う |
| フレームの `callId` | 関数の呼び出しごとの通し番号を、コールスタックのフレーム（`{ name, loc, args, callId }`）に持たせる | 呼び出しの区別（変数の状態の比較テスト。今後、呼び出しを区別したいビューも使える） |
| 出力の断片 | `print` は共通コアの `recorder.write()` で出力し、行の途中で終わる断片は `eol: false` で記録する | 行にまとめるのは `joinConsoleLines()`（JSInterpreter ADR-015） |

いずれも JS 版のトレースには影響しない（JS の評価器は記録しない）。

## 結果

- ステップのボタン（`dbg.humanStep()`）は、`for` の各回で止まる
- JSVisualizer の Exec Trace などのビューは、`TraceBuilder.buildHumanIndices()` で独自に停止点を計算している。そのため、`LoopBinding` ではまだ止まらない。Phase 3 で、ビューの停止点をデバッガーのもの（ノード分類表）に統一する
- コンソールのビューは、断片を 1 行ずつ表示する。Phase 3 で `joinConsoleLines()` を使う
