# ADR-006: クラスと例外

- ステータス: 採用
- 日付: 2026-11-25

## 背景

Phase 5 で次を入れる。

- class：`__init__`・メソッド・属性・継承・`super()`・基本的な特殊メソッド
- 例外：`try`/`except`/`else`/`finally`・`raise`・`assert`

例外は「例外のクラス」の階層で照合される。そのため、ユーザー定義の例外（`class MyError(Exception)`）と組み込みの例外を、同じクラスのしくみで扱う必要がある。

## 利用者に見える例

テストは `tests/adr-examples.test.js`（ADR-006 例1〜5）。5 件とも、入れる前（`2574c30`）では失敗することを確かめた。

1. `int("x")` の `ValueError` を捕まえて `print(type(e).__name__, e)` すると、`ValueError 'x' は整数に変換できません` と表示される。型の名前は CPython と同じだが、PyVisualizer が出す例外のメッセージは、初学者向けの日本語の説明になる（CPython は `invalid literal for int() with base 10: 'x'`）
2. `raise ValueError("no scores")` を捕まえて `print("error:", e, e.args)` すると、`error: no scores ('no scores',)` と表示される。プログラムが `raise` で投げた例外のメッセージは、書いたとおりに出る
3. `try:` / `x = 1 // 0` / `except ZeroDivisionError as e:` / `x = -1` を「人」の単位で進めると、2 行目（例外が起きる文）→ 3 行目（`except` の行。`e` が `ZeroDivisionError`）→ 4 行目の順に止まる
4. `__str__` も `__repr__` もないクラスのインスタンスを `print` すると、`<__main__.Dog object>` と表示される。CPython の表示（`<__main__.Dog object at 0x7f…>`）からアドレスを除いたもの
5. インスタンスは、画面のビューでは属性で表示される（例：`{ name: 'Rex' }`。[ADR-009](ADR-009-value-notation-details.md) で、クラス名を付けた `Dog{name: 'Rex'}` に変えた）。メモリ・オブジェクトのビューの見出しはクラス名（`Dog`）

## 決定

### 表現（`src/engine/objects.js`）

- **クラス**：`PyClass`（名前・基底クラス・属性・MRO）。MRO は C3 線形化で作る。すべてのクラスの基底は `object`。スナップショットでは参照を保持する（クラスごとに複製しない）
- **インスタンス**：`{ __type__: 'PyInstance', cls, attrs: {…} }`。`attrs` はプレーンオブジェクトなので、スナップショットにその時点の属性が残る
- **例外**：組み込みの例外のクラス（`BaseException` → `Exception` → `ValueError`・`LookupError` → `KeyError` など）のインスタンス。`args` に引数の tuple を持つ。エンジンの内部のエラー（`PyError`）は、`except` で捕まえるときに、対応する例外のクラスのインスタンスに変換する。ただし次の 2 種類は捕まえない
  - 実行の上限（50,000 ステップ）を超えたときのエラー
  - 未対応の構文のエラー

### クラス

- クラスの本体は、自分のスコープで実行する。そこで作った名前がクラスの属性になる。メソッドからクラスのスコープは見えない（Python と同じ）
- `super()` は、実行中のメソッドを定義したクラスと `self` から、MRO の次のクラスを探す
- 特殊メソッドは、ユーザーのコードとして実行する（トレースに記録され、ステップ実行で中に入れる）
  - 表示：`__str__`・`__repr__`
  - 比較：`__eq__`・`__lt__`・`__le__`・`__gt__`・`__ge__`（定義がなければ反射した側。CPython と同じ手順）
  - その他：`__bool__`・`__len__`・`__contains__`、算術の `__add__` など（と `__radd__` など）
- 組み込み：`isinstance`・`issubclass`・`type`・`super`・`hasattr`・`getattr`・`setattr`・`object`

### 例外

- `try` の本体で例外が起きたら、JSInterpreter と同じ方式でトレースを整える（例外で中断した評価の、exit を持たない enter を片付ける）
- 捕まえた時点を `ExceptBinding` として記録し、「人」のステップが止まる（ADR-003 の `LoopBinding` と同じ方式）
- `finally` は、例外・`return`・`break` のいずれでも実行する
- `as` の名前は、`except` の後で消す（Python と同じ）
- `raise` だけの文は、処理中の例外を投げ直す

## 結果

- CPython との比較テスト（出力・例外の種類・変数の状態の変化）が一致する。特殊メソッドが呼ばれる回数も一致する
- 変数の状態の比較テストは、次のように比べる
  - インスタンス：ユーザーの `__repr__` を呼ばずに、属性から作った表記で比べる（`__init__` の途中では `__repr__` が失敗しうるため）
  - 例外：型だけで比べる（メッセージが日本語のため）
- `sorted` が `__lt__` を呼ぶ順序・回数は CPython と違う（並べ替えのアルゴリズムが違う）。結果は同じ。そのため、この比較は出力だけで行う（`tests/cases/output_sort_objects.py`。`output_` で始まるテストケースは、変数の状態の比較の対象外）
- コールスタックの見出しでは、引数のインスタンスが `{…}` と表示される（クラス名ではない。JS 版の表示と同じ部品を使うため）
- 対象外：クラスメソッド・静的メソッド（`@classmethod`・`@staticmethod`。デコレーター全般）、プロパティ、`__slots__`、メタクラス、例外の連鎖（`raise … from …` の `from` は評価するが記録しない）
