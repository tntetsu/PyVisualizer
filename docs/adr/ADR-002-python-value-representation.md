# ADR-002: Python の値の表現

- ステータス: 採用
- 日付: 2026-11-25

## 背景

Python の評価器は、値を JS の値で表す。表現の条件は 4 つ：

1. Python の意味論を正しく再現できる（`1` と `1.0` の区別、大きな整数、辞書のキーの型と順序、tuple と list の区別）
2. JSInterpreter の共通コアの `deepClone`（スナップショット）で、その時点の値が正しく残る
3. JSVisualizer の既存のビュー（配列・棒グラフ・ヒートマップなど）が、できるだけそのまま使える
4. AST や TraceEvent に、JSON にできない値を入れない

Phase 0 のスパイクでは dict を JS のプレーンオブジェクトで表した。しかしこの表現では、キーが str に限られる。また JS のオブジェクトは整数風のキー（`"2"`）を先頭に並べ替えるので、Python の挿入順を保てない（[phase0-report.md](../phase0-report.md) 5 節）。

## 利用者に見える例

テストは `tests/adr-examples.test.js`（ADR-002 例1〜3）。

1. `print(2 ** 64)` と `print(1 << 40)` は、`18446744073709551616` と `1099511627776` と表示される（以前は桁が丸められ、`1 << 40` は `256` になっていた）
2. `d = {2: "two", "b": "bee", (1, 2): "pair", None: "none"}` のあと `print(d)` は、`{2: 'two', 'b': 'bee', (1, 2): 'pair', None: 'none'}` と、入れた順に表示される（以前は文字列以外のキーを使えなかった）
3. 空の辞書 `d` に `d[1] = "a"`、`d[1.0] = "b"`、`d[True] = "c"` の順に入れると、`print(d)` は `{1: 'c'}` と表示される（3 つは同じキーで、最初に入れた `1` のまま値だけが変わる。Python と同じ）

## 決定

| Python | 表現 | 理由 |
|---|---|---|
| int | 安全な整数の範囲（±(2^53−1)）は JS の number、それを超えたら BigInt。常にこの正規形に保つ（`normInt`） | ほとんどの int は number のままなので、既存のビュー（配列の添字・棒グラフなど）がそのまま使える。`factorial(25)` や `2 ** 64` も正確に計算できる。number どうしで正確に計算できないときだけ BigInt で計算し直す（`intOp`）。ビット演算は常に BigInt で行う（JS の number のビット演算は 32 ビットなので `1 << 40` が正しくない） |
| int のリテラル | AST の `Literal` は `value`（number、近似）に加え、範囲を超える場合だけ `bigint`（10 進の文字列）を持つ | AST を JSON にできる形に保つ |
| float | `PyFloat`（不変のクラス。`v` に number） | `1.0` と `1` を区別して表示するため。不変なので、スナップショットでは参照を保持してよい |
| bool / str / None | boolean / string / null | |
| list | JS の Array | 配列のビューがそのまま使える |
| tuple | 凍結した Array ＋ 列挙されない印 `__pytuple__` | スナップショットでは、クローンの hook（`pyCloneHook`）で印を保つ |
| dict | `{ __type__: 'PyDict', keys: [...], values: [...] }`。キーの検索用の索引は列挙されない `_index`（Map） | キーの型（int・tuple・None など）と挿入順を保つ。`deepClone` はプレーンオブジェクトとして keys・values をクローンし、索引は落とす（スナップショットは読むだけなので不要） |
| range | `PyRange`（不変） | |
| 関数 | `{ __type__: 'JSFunction', ... }` | JSVisualizer のビューが関数として扱う印をそのまま使う |

dict のキーの同一性は `hashKey()` で決める。Python と同じく `1`・`1.0`・`True` は同じキーで、既にあるキーに代入しても、キーそのものは最初に入れたものを保つ。list・dict はキーに使えない（`TypeError: unhashable type`）。

## 結果

- CPython と出力・例外の種類を比べるテストと、行単位の変数の状態を比べるテストが、大きな整数・いろいろな型のキーの辞書を含めて一致する
- **dict と tuple の表示**：JSVisualizer のビューは、dict を `{ __type__: "PyDict", keys: [...], values: [...] }` という内部の形のまま、tuple を list と同じ形で表示する。float も `{ v: 79 }` と表示される。Phase 3 で LanguageProfile の `valueModel`・`repr` を経由させて直す
- 大きな整数どうしの `/`（真の割り算）は、BigInt で割った商と余りから float を作るので、CPython の正確な丸めとは最後の桁が違うことがありうる
