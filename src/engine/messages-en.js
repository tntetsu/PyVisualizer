/**
 * messages-en.js — エラーメッセージの英語化（ADR-010）
 *
 * PyVisualizer のエンジンは、エラーメッセージを初学者向けの日本語で作る。英語表示のときは、ここで既知の文型を
 * 英語に置き換える（JSVisualizer の ADR-046 と同じ方式）。英語の文面は、なるべく CPython 3.12 のメッセージと同じにする。
 * CPython にない PyVisualizer 固有のもの（入力欄・import できるモジュール・未対応の構文）は説明文にする。
 *
 * - 表示：言語プロファイルの localizeError()（src/lang/python.js）が、エラーの表示欄の文字列を置き換える
 * - 実行時：英語表示で実行したときは、except で捕まえた例外の str(e)（args）も英語にする（objects.js の toPyException）
 * - 文型が見つからない本文（raise で書いたメッセージなど）はそのまま返す
 * - エンジンのメッセージを増やしたら、ここにも文型を足す
 *   （tests/messages-en.test.js がエンジンのソースから日本語のメッセージを集めて、漏れを検出する）
 */

/** 実行中のメッセージの言語（runPython が実行の間だけ設定する。except で捕まえた例外の str(e) に使う） */
let runtimeLang = 'ja';
/** @param {'ja'|'en'} lang */
export function setRuntimeLang(lang) { runtimeLang = lang === 'en' ? 'en' : 'ja'; }
/** エンジンのメッセージの本文を、実行中の言語にする */
export const runtimeBody = (pyType, body) => (runtimeLang === 'en' ? bodyToEnglish(pyType, body) : body);

const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
const wasWere = (n) => (Number(n) === 1 ? 'was' : 'were');

/** 未対応の構文の名前（PyUnsupportedError の what） */
const UNSUPPORTED = [
  [/^式「(.*)」$/s,                     (x) => `the expression '${x}'`],
  [/^型注釈$/,                          () => 'type annotations'],
  [/^基底クラスの指定「(.*)」$/s,        (x) => `the base class specification '${x}'`],
  [/^with 文$/,                         () => "the 'with' statement"],
  [/^ドットを含むモジュール名$/,          () => 'module names containing dots'],
  [/^この形の from … import$/,          () => 'this form of from … import'],
  [/^del の対象「(.*)」$/s,             (x) => `deleting '${x}'`],
  [/^match 文$/,                        () => "the 'match' statement"],
  [/^デコレーター$/,                     () => 'decorators'],
  [/^文「(.*)」$/s,                     (x) => `the statement '${x}'`],
  [/^引数「(.*)」$/s,                   (x) => `the parameter '${x}'`],
  [/^引数の型注釈$/,                     () => 'parameter type annotations'],
  [/^async の内包表記$/,                 () => 'async comprehensions'],
  [/^f 文字列の !r などの変換$/,          () => 'conversions such as !r in f-strings'],
  [/^f 文字列の入れ子の書式指定$/,        () => 'nested format specifications in f-strings'],
  [/^複素数$/,                          () => 'complex numbers'],
  [/^リストの中の \*$/,                  () => '* inside a list'],
  [/^辞書の \*\* 展開$/,                 () => '** unpacking inside a dict'],
  [/^@ 演算子$/,                         () => "the '@' operator"],
  [/^この形のスライス$/,                  () => 'this form of slice'],
  [/^この形の辞書の内包表記$/,            () => 'this form of dict comprehension'],
  [/^集合の中の \*$/,                    () => '* inside a set'],
  [/^デコレーター「(.*)」$/s,             (x) => `the decorator '${x}'`],
  [/^パターン「(.*)」$/s,                 (x) => `the pattern '${x}'`],
  [/^async def$/,                        () => "'async def'"],
];

/**
 * 本文全体に一致させる文型と英訳。[例外の型（null ならどれでも）, 文型, 英訳]。
 * 同じ日本語で型によって英語が違うもの（モジュールに名前がない：ImportError と AttributeError）は型で分ける。
 * @type {Array<[string|null, RegExp, (...groups: string[]) => string]>}
 */
const PATTERNS = [
  // ── 構文エラー（parse.js） ──
  [null, /^インデントにタブと空白が混ざっています（どちらかに統一してください）$/, () => 'inconsistent use of tabs and spaces in indentation'],
  [null, /^「:」の次の行はインデント（字下げ）が必要です$/, () => 'expected an indented block'],
  [null, /^行末に「:」がありません$/,                     () => "expected ':'"],
  [null, /^予期しないインデントがあります（前の行と同じ深さにそろえてください）$/, () => 'unexpected indent'],
  [null, /^インデントの深さが、外側のどの行ともそろっていません$/, () => 'unindent does not match any outer indentation level'],
  [null, /^対応する if がない (.*) があります$/s,          () => 'invalid syntax'],
  [null, /^条件で等しいかを調べるときは「=」ではなく「==」を使います$/, () => "invalid syntax. Maybe you meant '==' or ':=' instead of '='?"],
  [null, /^Python ではブロックを \{ \} ではなく「:」とインデントで表します$/, () => "invalid syntax (Python uses ':' and indentation instead of { } for blocks)"],
  [null, /^文字列の引用符が閉じていません$/,               () => 'unterminated string literal'],
  [null, /^閉じ括弧が多すぎます$/,                         () => 'unmatched closing bracket'],
  [null, /^括弧が閉じていません$/,                         () => 'bracket was never closed'],
  [null, /^書き方に誤りがあります$/,                       () => 'invalid syntax'],
  [null, /^0 で始まる整数は書けません（8 進数は 0o を付けます）$/,
    () => 'leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers'],
  [null, /^(.*) はまだ対応していません$/s, (what) => {
    for (const [re, en] of UNSUPPORTED) { const m = what.match(re); if (m) return `${en(...m.slice(1))} is not supported yet`; }
    return null;
  }],

  // ── 名前・スコープ ──
  [null, /^'(.*)' という名前は定義されていません$/s,        (n) => `name '${n}' is not defined`],
  [null, /^ローカル変数 '(.*)' に値を入れる前に使っています$/s,
    (n) => `cannot access local variable '${n}' where it is not associated with a value`],
  [null, /^nonlocal '(.*)' に対応する外側の変数がありません$/s, (n) => `no binding for nonlocal '${n}' found`],

  // ── 演算 ──
  [null, /^0 で割ることはできません$/,                     () => 'division by zero'],
  [null, /^シフトする量に負の数は使えません$/,              () => 'negative shift count'],
  [null, /^「(.*)」は (\S+) と (\S+) の組み合わせには使えません$/s,
    (op, a, b) => (op === '+' && ['str', 'list', 'tuple'].includes(a)
      ? `can only concatenate ${a} (not "${b}") to ${a}`
      : `unsupported operand type(s) for ${op}: '${a}' and '${b}'`)],
  [null, /^未知の比較演算子 (.*)$/s,                       (op) => `unknown comparison operator ${op}`],
  [null, /^(\S+) と (\S+) は「(.*)」で比べられません$/s,
    (a, b, op) => `'${op}' not supported between instances of '${a}' and '${b}'`],
  [null, /^単項の「(.*)」は (\S+) には使えません$/s,         (op, t) => `bad operand type for unary ${op}: '${t}'`],
  [null, /^文字列の in の左側は文字列でなければなりません（(.*)）$/s,
    (t) => `'in <string>' requires string as left operand, not ${t}`],

  // ── 添字・スライス・代入 ──
  [null, /^(\S+) の添字は整数でなければなりません（(\S+) が指定されました）$/,
    (t, k) => (t === 'str' ? `string indices must be integers, not '${k}'` : `${t} indices must be integers or slices, not ${k}`)],
  [null, /^(\S+) の範囲外の位置 (\S+) は変更・削除できません（長さ (\d+)）$/, (t) => `${t} assignment index out of range`],
  [null, /^(\S+) の範囲外の位置 (\S+) を指定しています（長さ (\d+)）$/,
    (t) => (t === 'str' ? 'string index out of range' : `${t} index out of range`)],
  [null, /^(\S+) には \[ \] で添字を付けられません$/,       (t) => `'${t}' object is not subscriptable`],
  [null, /^(\S+) の要素は変更できません$/,                 (t) => `'${t}' object does not support item assignment`],
  [null, /^(\S+) の要素は消せません$/,                     (t) => `'${t}' object doesn't support item deletion`],
  [null, /^スライスの step に 0 は使えません$/,             () => 'slice step cannot be zero'],
  [null, /^(\S+) はスライスできません$/,                    (t) => `'${t}' object is not subscriptable`],
  [null, /^値が多すぎて (\d+) 個の変数に分けられません（(\d+) 個）$/, (n) => `too many values to unpack (expected ${n})`],
  [null, /^値が足りず 少なくとも (\d+) 個の変数に分けられません（(\d+) 個）$/,
    (n, got) => `not enough values to unpack (expected at least ${n}, got ${got})`],
  [null, /^値が足りず (\d+) 個の変数に分けられません（(\d+) 個）$/,
    (n, got) => `not enough values to unpack (expected ${n}, got ${got})`],
  [null, /^ここには代入できません$/,                       () => 'cannot assign to expression'],
  [null, /^長さ (\d+) の拡張スライスに、長さ (\d+) の並びは代入できません$/,
    (a, b) => `attempt to assign sequence of size ${b} to extended slice of size ${a}`],
  [null, /^この形の複合代入はまだ対応していません$/,         () => 'this form of augmented assignment is not supported yet'],

  // ── 辞書・集合・反復 ──
  [null, /^(\S+) は辞書のキーに使えません（unhashable type: '(.*)'）$/s, (t) => `unhashable type: '${t}'`],
  [null, /^辞書にキー (.*) がありません$/s,                 (k) => k],   // CPython の KeyError の str はキーの repr
  [null, /^集合に (.*) がありません$/s,                     (k) => k],
  [null, /^(\S+) は繰り返し（for など）に使えません$/,       (t) => `'${t}' object is not iterable`],

  // ── 関数の呼び出し ──
  [null, /^(.*)\(\) の位置引数は (\d+) 個までですが、(\d+) 個渡されました$/s,
    (f, n, m) => `${f}() takes ${plural(n, 'positional argument')} but ${m} ${wasWere(m)} given`],
  [null, /^(.*)\(\) に (.*) という名前の引数はありません$/s, (f, k) => `${f}() got an unexpected keyword argument '${k}'`],
  [null, /^(.*)\(\) の引数 (.*) が 2 回指定されています$/s,  (f, k) => `${f}() got multiple values for argument '${k}'`],
  [null, /^(.*)\(\) のキーワード専用引数 '(.*)' が渡されていません$/s,
    (f, p) => `${f}() missing 1 required keyword-only argument: '${p}'`],
  [null, /^(.*)\(\) の引数 '(.*)' が渡されていません$/s,
    (f, p) => `${f}() missing 1 required positional argument: '${p}'`],
  [null, /^(\S+) は関数ではないので呼び出せません$/,         (t) => `'${t}' object is not callable`],
  [null, /^関数の呼び出しが (\d+) 段を超えました（再帰が止まっていない可能性があります）$/,
    () => 'maximum recursion depth exceeded'],
  [null, /^関数の呼び出しが深くなりすぎたため停止しました（再帰が止まっていない可能性があります）$/,
    () => 'maximum recursion depth exceeded'],
  [null, /^\*\* の後ろは辞書でなければなりません（(.*)）$/s, (t) => `argument after ** must be a mapping, not ${t}`],
  [null, /^キーワード引数の名前は文字列でなければなりません$/, () => 'keywords must be strings'],
  [null, /^(.*)\(\) の引数は (\d+) 個ですが、(\d+) 個渡されました$/s,
    (f, n, m) => `${f}() takes exactly ${plural(n, 'argument')} (${m} given)`],
  [null, /^(.*)\(\) の引数は (\d+)〜(\d+) 個ですが、(\d+) 個渡されました$/s,
    (f, lo, hi, m) => `${f}() takes from ${lo} to ${hi} arguments (${m} given)`],

  // ── クラス・例外 ──
  [null, /^__init__\(\) は None を返さなければなりません$/,  () => '__init__() should return None'],
  [null, /^(.*)\(\) は引数を受け取りません$/s,               (c) => `${c}() takes no arguments`],
  [null, /^except の後ろには例外のクラスを書きます$/,
    () => 'catching classes that do not inherit from BaseException is not allowed'],
  [null, /^基底クラスには クラスを書きます（(.*) が書かれています）$/s, (t) => `bases must be classes, not ${t}`],
  [null, /^クラス (.*) の基底クラスの順序が矛盾しています（MRO を作れません）$/s,
    (c) => `Cannot create a consistent method resolution order (MRO) for bases of ${c}`],
  [null, /^投げ直す例外がありません（raise だけの文は except の中で使います）$/, () => 'No active exception to reraise'],
  [null, /^raise できるのは例外だけです（(.*)）$/s,          () => 'exceptions must derive from BaseException'],
  [null, /^(\S+) はまだ評価できません$/,                    (t) => `${t} cannot be evaluated yet`],

  // ── 属性・モジュール ──
  [null, /^(.*) の property '(.*)' には代入できません（setter がありません）$/s, (c, n) => `property '${n}' of '${c}' object has no setter`],
  [null, /^(.*) の property '(.*)' は読み出せません（getter がありません）$/s, (c, n) => `property '${n}' of '${c}' object has no getter`],
  [null, /^(\S+) は with で使えません（__enter__ と __exit__ がありません）$/, (t) => `'${t}' object does not support the context manager protocol`],
  [null, /^(.*)\(\) のパターンの位置引数は 1 つまでです$/s,          (c) => `${c}() accepts 1 positional sub-pattern`],
  [null, /^(.*)\(\) のパターンに位置引数を使うには __match_args__ が必要です$/s, (c) => `${c}() accepts 0 positional sub-patterns`],
  [null, /^open\(\) によるファイルの読み書きはまだ対応していません（データはプログラムの中に書いてください）$/,
    () => 'reading and writing files with open() is not supported yet (write the data in the program)'],
  [null, /^super\(\) の先に (.*) という属性はありません$/s,   (n) => `'super' object has no attribute '${n}'`],
  [null, /^(\S+) に (.*) という属性はありません$/s,           (t, n) => `'${t}' object has no attribute '${n}'`],
  [null, /^(\S+) には属性を追加できません$/,                  (t) => `cannot set attributes on '${t}' objects`],
  ['ImportError', /^モジュール '(.*)' に (.*) はありません$/s, (m, n) => `cannot import name '${n}' from '${m}'`],
  [null, /^モジュール '(.*)' に (.*) はありません$/s,         (m, n) => `module '${m}' has no attribute '${n}'`],
  [null, /^モジュール '(.*)' は使えません（PyVisualizer で import できるのは (.*) です）$/s,
    (m, list) => `No module named '${m}' (PyVisualizer can import only ${list.split('・').join(', ')})`],

  // ── 組み込み関数・メソッド（builtins.js） ──
  [null, /^isinstance\(\) の 2 番目の引数は、クラスか型（またはそのタプル）です$/,
    () => 'isinstance() arg 2 must be a type, a tuple of types, or a union'],
  [null, /^issubclass\(\) の最初の引数はクラスです$/,         () => 'issubclass() arg 1 must be a class'],
  [null, /^(.*)\(\) に空の並びが渡されました$/s,               (f) => `${f}() arg is an empty sequence`],
  [null, /^書式指定「(.*)」はまだ対応していません$/s,           (s) => `the format specification '${s}' is not supported yet`],
  [null, /^書式「(.*)」は数値にしか使えません$/s,               (s) => `the format '${s}' can only be used with numbers`],
  [null, /^書式「(.*)」の符号・桁区切り・= ・# は数値にしか使えません$/s, () => 'Sign, grouping, \'=\' alignment and \'#\' are not allowed in string format specifier'],
  [null, /^書式「(.*)」は数値には使えません$/s,                 (s) => `the format '${s}' cannot be used with numbers`],
  [null, /^整数の書式に精度（\.(\d+)）は指定できません$/,        () => 'Precision not allowed in integer format specifier'],
  [null, /^書式「c」に使える文字の番号の範囲外です（(.*)）$/s,   () => '%c arg not in range(0x110000)'],
  [null, /^(.*) は (\d+) 進数の整数に変換できません$/s,          (r, b) => `invalid literal for int() with base ${b}: ${r}`],
  [null, /^書式の名前 (.*) に対応する引数がありません$/s,         (k) => k],   // KeyError の str はキーの repr
  [null, /^書式の \{\} に対して引数が足りません$/,              () => 'Replacement index out of range for positional args tuple'],
  [null, /^(\S+) はイテレーターではありません$/,                 (t) => `'${t}' object is not an iterator`],
  [null, /^pow\(\) の 3 番目の引数に 0 は使えません$/,           () => 'pow() 3rd argument cannot be 0'],
  [null, /^pow\(\) の底が、法に対して逆元を持ちません$/,         () => 'base is not invertible for the given modulus'],
  [null, /^文字列の中に (.*) が見つかりません$/s,                 () => 'substring not found'],
  [null, /^書式「(.*)」は整数にしか使えません$/s,               (s) => `the format '${s}' can only be used with integers`],
  [null, /^% 書式に対して値が足りません$/,                     () => 'not enough arguments for format string'],
  [null, /^% 書式に対して値が多すぎます$/,                     () => 'not all arguments converted during string formatting'],
  [null, /^%\(名前\)s の形の書式はまだ対応していません$/,       () => '%(name)s formats are not supported yet'],
  [null, /^%(\S) には数が必要です（(\S+) が渡されました）$/,    (c, t) => `%${c} format: a real number is required, not ${t}`],
  [null, /^%(\S) には整数が必要です（(\S+) が渡されました）$/,  (c, t) => `%${c} format: an integer is required, not ${t}`],
  [null, /^(.*) には整数が必要です（(\S+) が渡されました）$/s, (_, t) => `'${t}' object cannot be interpreted as an integer`],
  [null, /^(\S+) には len\(\) を使えません$/,                   (t) => `object of type '${t}' has no len()`],
  [null, /^range\(\) の step に 0 は使えません$/,               () => 'range() arg 3 must not be zero'],
  [null, /^(\S+) には abs\(\) を使えません$/,                   (t) => `bad operand type for abs(): '${t}'`],
  [null, /^sum\(\) は数値の並びにしか使えません（(\S+) が含まれています）$/,
    (t) => `unsupported operand type(s) for +: 'int' and '${t}'`],
  [null, /^(.*) は整数に変換できません$/s, (r) => (/^-?inf$/.test(r) ? 'cannot convert float infinity to integer'
    : r === 'nan' ? 'cannot convert float NaN to integer' : `invalid literal for int() with base 10: ${r}`)],
  [null, /^(.*) は小数に変換できません$/s,                     (r) => `could not convert string to float: ${r}`],
  [null, /^dict\(\) の要素は \(キー, 値\) の 2 つ組でなければなりません$/,
    () => 'dictionary update sequence element has wrong length; 2 is required'],
  [null, /^ord\(\) には 1 文字の文字列が必要です$/,             () => 'ord() expected a character'],
  [null, /^(\S+) は呼び出せません$/,                           (t) => `cannot create '${t}' instances`],
  [null, /^super\(\) は、クラスの中で定義したメソッドの中で使います$/, () => 'super(): no arguments'],
  [null, /^super\(\) を使うメソッドには self の引数が必要です$/,     () => 'super(): no arguments'],
  [null, /^入力が足りません（画面の「入力」の欄に、input\(\) で読む行を書いてください）$/,
    () => 'EOF when reading a line (write the lines for input() in the "Input" box)'],
  [null, /^空のリストから pop\(\) しようとしました$/,           () => 'pop from empty list'],
  [null, /^pop\(\) の位置 (\S+) がリストの範囲外です$/,         () => 'pop index out of range'],
  [null, /^リストに (.*) がありません$/s,                       () => 'list.remove(x): x not in list'],
  [null, /^(.*) はリストにありません$/s,                        (r) => `${r} is not in list`],
  [null, /^join\(\) に文字列でない値（(\S+)）が含まれています$/, (t) => `sequence item: expected str instance, ${t} found`],
  [null, /^update\(\) には辞書を渡してください$/,               () => 'update() requires a dict'],
  [null, /^空の集合から pop\(\) しようとしました$/,             () => 'pop from an empty set'],

  // ── モジュール（lib/。ADR-013） ──
  [null, /^空の deque から (pop|popleft)\(\) しようとしました$/,      () => 'pop from an empty deque'],
  [null, /^有限でない数は statistics で使えません$/,                  () => 'statistics functions require finite numbers'],
  [null, /^statistics\.(\w+)\(\) には数のデータが必要です（(\S+) が含まれています）$/, (f, t) => `statistics.${f}() requires numeric data, not '${t}'`],
  [null, /^mode\(\) に空のデータが渡されました$/,                      () => 'no mode for empty data'],
  [null, /^(\w+)\(\) に空のデータが渡されました$/,                     (f) => `${f} requires at least one data point`],
  [null, /^(\w+)\(\) には少なくとも (\d+) 個のデータが必要です$/,      (f) => `${f} requires at least two data points`],
  [null, /^年 (-?\d+) は範囲外です（1〜9999）$/,                       (y) => `year ${y} is out of range`],
  [null, /^月は 1〜12 でなければなりません$/,                          () => 'month must be in 1..12'],
  [null, /^その月にない日です$/,                                       () => 'day is out of range for month'],
  [null, /^時は 0〜23 でなければなりません$/,                          () => 'hour must be in 0..23'],
  [null, /^分は 0〜59 でなければなりません$/,                          () => 'minute must be in 0..59'],
  [null, /^秒は 0〜59 でなければなりません$/,                          () => 'second must be in 0..59'],
  [null, /^マイクロ秒は 0〜999999 でなければなりません$/,              () => 'microsecond must be in 0..999999'],
  [null, /^timedelta の日数が範囲外です$/,                             () => 'days must have magnitude <= 999999999'],
  [null, /^strptime の書式 %(.) はまだ対応していません$/,              (c) => `the strptime directive '%${c}' is not supported yet`],
  [null, /^(.*) は書式 (.*) に合いません$/s,                           (d, f) => `time data ${d} does not match format ${f}`],
  [null, /^日付の書き方として正しくありません: (.*)$/s,                (s) => `Invalid isoformat string: ${s}`],
  [null, /^日付が範囲外です$/,                                         () => 'date value out of range'],
  [null, /^timedelta の (\w+) には数が必要です（(\S+) が渡されました）$/, (k, t) => `unsupported type for timedelta ${k} component: ${t}`],
  [null, /^time\.sleep\(\) には数が必要です（(\S+) が渡されました）$/, (t) => `'${t}' object cannot be interpreted as an integer`],
  [null, /^time\.sleep\(\) に負の数は使えません$/,                     () => 'sleep length must be non-negative'],
  [null, /^random\.(\w+)\(\) には list・tuple・文字列・range を渡します（(\S+) が渡されました）$/, (f, t) => `random.${f}() requires a list, tuple, str or range, not '${t}'`],
  [null, /^random\.seed\(\) には整数を渡してください（(\S+) はまだ対応していません）$/, (t) => `random.seed() accepts only integers in PyVisualizer ('${t}' is not supported yet)`],
  [null, /^random\.uniform\(\) には数が必要です（(\S+) が渡されました）$/, (t) => `random.uniform() requires numbers, not '${t}'`],
  [null, /^空の並びからは選べません$/,                                 () => 'Cannot choose from an empty sequence'],
  [null, /^random\.shuffle\(\) にはリストを渡します（(\S+) が渡されました）$/, (t) => `'${t}' object does not support item assignment`],
  [null, /^取り出す数が、並びの長さより大きいか負です$/,               () => 'Sample larger than population or is negative'],
  [null, /^重みの数が、並びの長さと違います$/,                         () => 'The number of weights does not match the population'],
  [null, /^重みの合計は 0 より大きくなければなりません$/,              () => 'Total of weights must be greater than zero'],
  [null, /^random\.(\w+)\(\) の範囲が空です（(.*)）$/s,                (_, r) => `empty range in randrange(${r})`],
  [null, /^random\.(\w+)\(\) の範囲が空です$/,                         () => 'empty range for randrange()'],
  [null, /^random\.randrange\(\) の step に 0 は使えません$/,          () => 'zero step for randrange()'],

  // ── math（modules.js） ──
  [null, /^math\.(\w+)\(\) には数を渡します（(\S+) が渡されました）$/, (_, t) => `must be real number, not ${t}`],
  [null, /^math\.(\w+)\(\) には整数を渡します（(\S+) が渡されました）$/, (_, t) => `'${t}' object cannot be interpreted as an integer`],
  [null, /^数学の関数の定義域の外の値です（math domain error）$/, () => 'math domain error'],
  [null, /^整数にできない値です$/,                             () => 'cannot convert float NaN or infinity to integer'],
  [null, /^math\.factorial\(\) に負の数は使えません$/,          () => 'factorial() not defined for negative values'],
  [null, /^math\.isqrt\(\) に負の数は使えません$/,              () => 'isqrt() argument must be nonnegative'],
  [null, /^math\.(comb|perm)\(\) に負の数は使えません$/,        () => 'n and k must be non-negative integers'],
];

/**
 * 例外のメッセージの本文（型や行番号を含まない部分）を英語にする。文型が見つからなければそのまま返す。
 * @param {string|null} pyType 例外の型（'TypeError' など。構文エラーは null）
 * @param {string} body
 * @returns {string}
 */
export function bodyToEnglish(pyType, body) {
  if (typeof body !== 'string') return body;
  for (const [type, re, toEnglish] of PATTERNS) {
    if (type && type !== pyType) continue;
    const m = body.match(re);
    if (!m) continue;
    const en = toEnglish(...m.slice(1));
    if (en != null) return en;
  }
  return body;
}

/** 構文エラー：「構文エラー（3行目）: 本文」 */
const SYNTAX_RE = /^構文エラー（(\d+)行目）: (.*)$/s;
/** 実行時の例外：「ValueError: 本文（3行目）」「ValueError（3行目）」（本文がない raise） */
const RUNTIME_RE = /^([A-Za-z_]\w*)(?:: (.*?))?（(\d+)行目）$/s;
const RUNTIME_NO_LINE_RE = /^([A-Za-z_]\w*): (.*)$/s;

/**
 * エラーの表示欄の文字列を英語にする。文型が見つからない部分はそのまま残す。
 * @param {string} message
 * @returns {string|null} 英語にした文字列（PyVisualizer の形のメッセージでなければ null）
 */
export function messageToEnglish(message) {
  if (typeof message !== 'string') return null;
  let m = message.match(SYNTAX_RE);
  if (m) return `SyntaxError (line ${m[1]}): ${bodyToEnglish(null, m[2])}`;
  m = message.match(RUNTIME_RE);
  if (m) return `${m[1]}${m[2] != null ? `: ${bodyToEnglish(m[1], m[2])}` : ''} (line ${m[3]})`;
  m = message.match(RUNTIME_NO_LINE_RE);
  if (m) return `${m[1]}: ${bodyToEnglish(m[1], m[2])}`;
  return null;
}
