# 多言語化の計画（各リポジトリの計画書の出発点）（初版 2026-11-25）

PyVisualizer（Python 版）を作った経験をもとに、Java・C・C++・TypeScript への展開と、JS 版のパーサーの Lezer 化を計画する。この文書は、各リポジトリの開発計画書（`docs/development-plan.md`）を書くときの出発点にする。各リポジトリの計画書を作ったら、この文書からはその計画書へリンクする。

## 1. 結論（2026-11-25 の方針）

| 対象 | 置き場所 | 進め方 |
|---|---|---|
| Java | 新しいリポジトリ **JavaVisualizer** | 評価器を新しく書く。PyVisualizer と同じ構成 |
| C と C++ | 新しいリポジトリ 1 つ（名前は 7 節で決める） | 評価器を 1 つ書き、言語プロファイルを C と C++ の 2 つにする。**C を先に作り、C++ はその上に足す** |
| TypeScript | **JSInterpreter**（JS の仲間） | JS の評価器を使い、型は読み飛ばす。JS の Lezer 化の上に足す |
| JS の Lezer 化 | **JSInterpreter** | 手書きのパーサーを Lezer（`@lezer/javascript`）に置き換える。授業で使っているので、作業ブランチで進めて学期後にマージ |
| 共通の土台（共通コア・画面） | 今は JSInterpreter・JSVisualizer の作業ブランチ | 各言語は**タグかコミットで固定して参照**する。学期後に独立させる（3 節） |

C と C++ を 1 つにする理由：

- Lezer に C 専用の文法はなく、C++ の文法（`@lezer/cpp`）で C もほぼ読める（CodeMirror も C を C++ の文法で扱う）
- いちばん大きな部分であるメモリのモデル（アドレス・ポインタ・配列・構造体・`malloc`/`free`）と、その見せ方（ポインタの矢印・スタックとヒープ）が共通
- C++ で増えるもの（クラス・参照・`new`/`delete`・`std::string`・`std::vector`・`cout`/`cin`・多重定義）は、C の土台の上に足せる
- 違いは細部（C の `void *` の暗黙の変換、C では変数名にできる `new`・`class` など）なので、言語プロファイルで切り替える（`gcc` と `g++` の関係と同じ）

TypeScript を JS の仲間にする理由：実行時の意味は JS と同じで、型を取り除けば JS の評価器で動く。`@lezer/javascript` は TypeScript の dialect（`ts`）を持つので、JS を Lezer にすれば TypeScript は「型を読み飛ばす」小さな追加になる。

## 2. 今の構成（2026-11-25）

```
JSInterpreter（main）           JS のインタプリタ。授業の JS 版が使う
JSInterpreter-core              ↑ の作業ブランチ feature/interp-core（共通コア js-interpreter/core）
JSVisualizer（main）            JS 版のサイト。授業（BhvVisualizer の iframe）で使う
JSVisualizer-multilang          ↑ の作業ブランチ feature/multilang（言語プロファイル。画面を言語で共有）
PyVisualizer                    Python のエンジン＋言語プロファイル＋サイト
```

PyVisualizer は、土台を兄弟ディレクトリ（`file:../JSInterpreter-core`・`file:../JSVisualizer-multilang`）で参照し、CI では作業ブランチの最新を clone してビルドしている。

## 3. 共通の土台の扱い

### 3.1 今すぐ：参照を固定する

言語が増えると、作業ブランチに push しただけで、すべての言語のサイトが次のデプロイで変わる（あるいはビルドが壊れる）。また、各言語の CI が兄弟リポジトリを 3 つずつ clone することになる。そこで、

- 作業ブランチに、区切りのよいところでタグを付ける（例：`multilang-2026.11.25`）
- 各言語のリポジトリは、CI でそのタグ（またはコミット）を clone する。土台を変えたら、各言語が自分の都合で参照を上げる
- 手元の開発は、今までどおり worktree（`file:` 参照）でよい

PyVisualizer の CI（`.github/workflows/deploy.yml`）も、ブランチの最新からタグの参照に変える。

### 3.2 学期後：土台を独立させる

JSInterpreter・JSVisualizer の作業ブランチを main にマージするとき（2027 年 2 月以降）に、どちらかに決める。

- **案 A**：共通コアと画面を 1 つのリポジトリ（例：`ExecVisualizer`）にまとめ、パッケージ（GitHub Packages か npm）として公開する。JSVisualizer も含め、各言語はバージョンを指定して使う
- **案 B**：JSVisualizer を「画面と JS 版」の本拠地のまま残し、画面をパッケージとして公開する。共通コアは JSInterpreter から公開する

どちらでも、BhvVisualizer が埋め込んでいる JSVisualizer の公開 URL は変えない。

### 3.3 画面（JSVisualizer）に足すもの

言語ごとに必要になる画面の機能は、JSVisualizer の作業ブランチ `feature/multilang` に足す（JS 版の画面が変わらないことを `scripts/capture-js-dom.mjs` で確かめる）。

| 言語 | 画面に要るもの（見込み） |
|---|---|
| Java | 型の付いた変数の表示（`int x = 3`）、配列の既定値（`0`・`null`）、`null` の表示 |
| C・C++ | アドレスとポインタの値（`0x7ffd…` の代わりに、図の上の矢印と短い番号）、スタックのフレームとヒープの区別、未初期化の値の表示、構造体の表示 |
| TypeScript | なし（JS と同じ）。型注釈はコード表示の色分けだけ |

## 4. 各リポジトリの計画の出発点

各リポジトリは、PyVisualizer と同じ段階（Phase 0〜5）で進める。

| Phase | 内容（PyVisualizer での例） |
|---|---|
| 0. スパイク | Lezer → AST の変換と小さな評価器を作り、画面に載せて全ビューを確認する。共通の契約（TraceEvent・ESTree 名の AST・言語プロファイル）で進めてよいかを判断する |
| 1. 土台の調整 | 共通コア・画面に足りないものを作業ブランチに足す |
| 2. エンジンの MVP | 入門の範囲を実装し、正解の処理系との比較テスト（出力・例外・変数の状態の変化）を作る |
| 3. 言語プロファイル | 値の見せ方・色分け・実行トレースの行など |
| 4. アプリ | サンプル（JS 版の 21 本に対応）、マニュアル、デプロイ |
| 5. 対象の拡大 | 授業で使う範囲まで広げる |

どのリポジトリでも、次の約束を引き継ぐ。

- **正解の処理系と比べる**：同じプログラムを本物の処理系で実行し、出力・例外（実行時エラー）・変数の状態の変化の列を比べる（PyVisualizer の `tests/oracle.test.js`・`tests/line-state.test.js`。変数の状態は、デバッガーのインターフェースで取り出す）
- **利用者に見える ADR には、例とテストを付ける**（直す前のコードで失敗することを確かめてから足す）
- **エラーメッセージ**：日本語は初学者向けの説明、英語は正解の処理系と同じ文面（PyVisualizer の ADR-010）。訳し漏れを検出するテストを最初から作る
- **AST の型名**：意味が同じ構文は ESTree の名前を使い、言語に固有の構文には新しい型を足す（画面のビューがそのまま使える）

### 4.1 JS の Lezer 化と TypeScript（JSInterpreter）

**目的**：手書きのパーサーを `@lezer/javascript` に置き換え、その上に TypeScript を足す。エディタの色分けと実行が同じ文法になり、構文エラーの説明も PyVisualizer と同じ作りにできる。

- **置き場所**：JSInterpreter の作業ブランチ（`feature/interp-core` から分けるか、その続きにするかは計画書で決める）。main へのマージは学期後
- **いちばん大事なこと**：授業の学生に見える JS 版の動きを変えない。Phase 1 と同じく、master と作業ブランチのトレースを全プログラム（約 200 本・約 24 万イベント）で比べる（`scripts/compare-js-core.mjs`）。構文エラーのメッセージと位置も比べる（変わるなら ADR で決め、評価計画に記録する）
- **TypeScript**：型注釈・`interface`・`type`・`enum`・ジェネリクス・`as` を読み飛ばす（`enum` は値を作るので評価器が要る）。型の誤り（`tsc` のエラー）を出すかは決める（7 節）。正解は `tsc`＋`node`（または型を外して `node`）
- **サイト**：TypeScript を JSVisualizer の中で言語として選べるようにするか、別のサイトにするかを決める（7 節）
- **リスク**：手書きのパーサーが持つ細かな挙動（ASI・正規表現リテラルの判定・エラーの位置）の違い。JSInterpreter の既存のテスト 266 件と、トレースの比較で見つける

### 4.2 JavaVisualizer

**目的**：入門の Java（`public static void main`・基本の型・配列・`String`・クラス・`ArrayList`・`HashMap`・例外・`Scanner`）を可視化する。

- **パーサー**：`@lezer/java`（1.2.0）、エディタは `@codemirror/lang-java`。新しい構文（`record`・`switch` 式・`var`・テキストブロック）にどこまで対応しているかを Phase 0 で確かめる
- **値の表現（Phase 0 で決める）**
  - `int`・`short`・`byte`・`char` は 32 ビットなどであふれる（`Integer.MAX_VALUE + 1` は `-2147483648`）。`long` は BigInt
  - `double` の表示は Java の規則（`1.0E10`・`0.1+0.2` の桁）。`float` も分ける
  - 配列は長さが決まり、既定値で埋まる。`null` と、`NullPointerException`
  - `String` は不変。`==` と `equals` の違い（参照の比較）をメモリのビューで見せられる
  - `HashMap`・`HashSet` の繰り返しの順序は、Java の `hashCode` とバケットの順序で決まる。正解と比べるなら、`String.hashCode`・`Integer.hashCode` と `HashMap` の並びを同じにする必要がある
- **正解**：`java Main.java`（JDK 11 以降の単一ファイルの実行。この環境の OpenJDK 21 で `javac` なしに動くことを確かめた）。変数の状態は JDI（Java Debug Interface）か、`jdb` で取り出す方法を Phase 0 で調べる
- **画面**：型付きの変数（3.3 節）。クラスとインスタンスの見せ方は、Python のインスタンス（ADR-009 の `Dog{…}`）と同じ作りで足りるか確かめる
- **入力**：`Scanner(System.in)` は PyVisualizer の入力欄（ADR-007）をそのまま使える

### 4.3 C と C++ のリポジトリ

**目的**：C の入門（変数・配列・文字列・ポインタ・構造体・`malloc`/`free`・`printf`/`scanf`）を可視化し、その上に C++ の入門（参照・クラス・`new`/`delete`・`std::string`・`std::vector`・`cout`/`cin`）を足す。

- **パーサー**：`@lezer/cpp`（1.1.6）で C と C++ の両方を読む。C では変数名にできる C++ のキーワード（`new`・`class`・`this` など）が読めない場合の扱いを Phase 0 で確かめる。エディタは `@codemirror/lang-cpp`
- **メモリのモデル（このリポジトリの中心。Phase 0 で決める）**
  - アドレスを持つメモリを模擬する（バイト単位か、オブジェクト単位か）。ポインタの演算・配列からポインタへの変換・`sizeof`・構造体の配置
  - 整数の型の大きさ（LP64 を前提にするか）、符号付き・符号なしのあふれ
  - 文字列は `'\0'` で終わる `char` の配列
  - **未定義動作は、まねずに検出して説明する**（範囲外の添字・解放後の使用・二重解放・未初期化の値の読み出し・ヌルポインタの参照）。本物の処理系では結果が決まらないので、比較テストの対象から外し、検出をテストする
- **正解**：`gcc`・`g++`（この環境にはまだ入っていない。入れる必要がある）。変数の状態は `gdb` で取り出す方法を Phase 0 で調べる。比較するのは、未定義動作のないプログラムだけ
- **画面**：アドレスとポインタの見せ方（3.3 節）。メモリのビューを C 用に広げるか、新しいビューを足すかを Phase 0 で決める。C はここがいちばん教育的な価値の高いところ
- **C++ の範囲**：テンプレートと STL は大きいので、入門で使うもの（`string`・`vector`・`map`・`cout`/`cin`）に絞る。例外・RAII（デストラクタの呼ばれる時期）は見せる価値が高い
- **入力**：`scanf`・`cin` は入力欄を使う

## 5. 順番の提案

学期中（〜2027 年 1 月）は、授業で使っているリポジトリ（JSInterpreter・JSVisualizer の main）を変えない。

| 時期 | 進めること |
|---|---|
| 学期中 | 3.1 節（参照の固定）。新しい言語を 1 つ始める（Java か C。7 節で決める） |
| 学期後（2027 年 2 月〜） | JSInterpreter・JSVisualizer の作業ブランチのマージ、3.2 節（土台の独立）、PyVisualizer の Phase 6（BhvVisualizer 連携）。続けて JS の Lezer 化と TypeScript |
| その後 | もう 1 つの新しい言語、C++ |

JS の Lezer 化を学期後にするのは、授業の JS 版に影響しうる変更で、学期中は main にマージできず、作業ブランチ（`feature/interp-core`）との取り込みも重なるため。

## 6. 正解の処理系（2026-11-25 の環境）

| 言語 | 処理系 | この環境 |
|---|---|---|
| Python | `python3` | あり（3.12.3） |
| Java | `java Main.java` | あり（OpenJDK 21。`javac` はないが単一ファイルの実行で足りる） |
| C・C++ | `gcc`・`g++` | なし（入れる必要がある。CI では `ubuntu-latest` に入っている） |
| TypeScript | `tsc`＋`node` | `node` はあり（22）。`tsc` は npm の開発依存で入れる |

## 7. 決めること

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| 1 | 学期中に始める言語 | Java／C | どちらでもよい。Java は静的型の土台（型・あふれ・クラス）を、C はメモリのモデルを先に作れる。授業で使う予定がある方を先にする |
| 2 | C と C++ のリポジトリの名前 | `CVisualizer`（C++ も含む）／`CppVisualizer`（C も含む）／両方を表す名前 | サイトの名前と合わせて決める |
| 3 | サイトを言語ごとに分けるか | 言語ごと（PyVisualizer と同じ）／1 つのサイトで言語を切り替える | 授業・論文で言語ごとに URL を配るなら、言語ごと。C と C++ は 1 つのサイトで切り替えてもよい |
| 4 | TypeScript のサイト | JSVisualizer の中で言語として選ぶ／別のサイト | 学期後の土台の整理（3.2 節）と一緒に決める |
| 5 | TypeScript の型の誤り | 出さない（型を読み飛ばすだけ）／`tsc` と同じ型検査をする | まずは出さない。型検査は大きな作業 |
| 6 | 土台の独立のしかた | 3.2 節の案 A／案 B | 学期後に決める |
| 7 | 変数の状態の比較の方法 | Java は JDI／`jdb`、C・C++ は `gdb` | 各リポジトリの Phase 0 で調べる |
