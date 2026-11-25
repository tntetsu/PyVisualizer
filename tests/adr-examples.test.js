/**
 * adr-examples.test.js — 利用者に見える ADR の例をそのままテストにしたもの
 *
 * ADR に書いた「入力のプログラム」と「表示される結果」を、PyDebugger で確かめる（テスト名に ADR 番号を入れる）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinConsoleLines } from 'js-interpreter/core';
import { PyDebugger } from '../src/engine/py-debugger.js';

const output = (src) => joinConsoleLines(new PyDebugger(src).consoleLogs).map(l => l.text);

test('ADR-002 例1：大きな整数を正確に計算して表示する', () => {
  assert.deepEqual(output('print(2 ** 64)\nprint(1 << 40)\n'), ['18446744073709551616', '1099511627776']);
});

test('ADR-002 例2：辞書のキーに数・タプル・None を使え、入れた順に表示される', () => {
  assert.deepEqual(output('d = {2: "two", "b": "bee", (1, 2): "pair", None: "none"}\nprint(d)\n'),
    ["{2: 'two', 'b': 'bee', (1, 2): 'pair', None: 'none'}"]);
});

test('ADR-002 例3：1 と 1.0 と True は同じキーで、最初に入れたキーのまま値が変わる', () => {
  assert.deepEqual(output('d = {}\nd[1] = "a"\nd[1.0] = "b"\nd[True] = "c"\nprint(d)\n'), ["{1: 'c'}"]);
});

test('ADR-003 例：for の各回で「人」のステップが止まり、ループ変数がその回の値になっている', () => {
  const dbg = new PyDebugger('total = 0\nfor i in range(3):\n    total += i\n');
  const stops = [];
  while (!dbg.humanStep().done) {
    const ev = dbg.getCurrentEvent();
    stops.push(`${ev.loc.line}行目 i=${ev.env[0].i ?? '-'} total=${ev.env[0].total}`);
  }
  assert.deepEqual(stops, [
    '1行目 i=- total=0',
    '2行目 i=0 total=0', '3行目 i=0 total=0',
    '2行目 i=1 total=0', '3行目 i=1 total=1',
    '2行目 i=2 total=1', '3行目 i=2 total=3',
  ]);
});

// ── ADR-004：JSVisualizer の画面での Python の値・行・出力の見せ方 ─────────────
import { setLanguage } from 'js-visualizer/src/lang/index.js';
import { formatValue } from 'js-visualizer/src/utils/format.js';
import { TraceBuilder } from 'js-visualizer/src/core/trace-builder.js';
import { joinConsoleLines as joinForView } from 'js-visualizer/src/utils/console-lines.js';
import { createPythonProfile } from '../src/lang/python.js';

setLanguage(createPythonProfile({}));

/** プログラムを最後まで実行したときの変数 name の、変数ビューでの表示（HTML のタグを除く） */
const shown = (src, name) => {
  const dbg = new PyDebugger(src);
  const last = dbg.trace[dbg.trace.length - 1];
  return formatValue(last.env[0][name]).replace(/<[^>]+>/g, '');
};

test('ADR-004 例1：小数は 79.0 と表示される', () => {
  assert.equal(shown('avg = sum([72, 88, 95, 61]) / 4\n', 'avg'), '79.0');
});

test('ADR-004 例2：真偽値・None・文字列は Python の書き方で表示される', () => {
  const src = 'found = 3 > 5\nx = None\ns = "the"\n';
  assert.deepEqual(['found', 'x', 's'].map(n => shown(src, n)), ['False', 'None', "'the'"]);
});

test('ADR-004 例3：辞書とタプルは中身が Python の書き方で表示される（かっこの内側の空白は ADR-009 でなくした）', () => {
  assert.equal(shown('d = {"a": 1, 2: None}\n', 'd'), "{'a': 1, 2: None}");
  assert.equal(shown('t = (1, "x")\n', 't'), "(1, 'x')");
});

test('ADR-004 例4：実行トレースに for の行が、range(3) を求める 1 回と各回の 3 回現れる', () => {
  const src = 'total = 0\nfor i in range(3):\n    total += i\n';
  const dbg = new PyDebugger(src);
  const rows = [...new TraceBuilder(dbg.trace, src, dbg.ast).buildHumanIndices()].sort((a, b) => a - b)
    .map(i => dbg.trace[i]).filter(ev => ev.loc.line === 2).map(ev => ev.env[0].i ?? '-');
  assert.deepEqual(rows, ['-', 0, 1, 2]);
});

test('ADR-004 例5：print(..., end=" ") の出力はコンソールで 1 行につながる', () => {
  const dbg = new PyDebugger('for i in range(3):\n    print(i, end=" ")\nprint()\n');
  dbg.cursor = dbg.trace.length;
  assert.deepEqual(joinForView(dbg.getConsoleOutput()).map(l => l.text), ['0 1 2 ']);
});

// ── ADR-005：Python の対象拡大（基本）で、CPython と違う・PyVisualizer 独自の見え方 ─────────────

test('ADR-005 例1：内包表記は「人」のステップで各回に止まり、終わるとループ変数は残らない', () => {
  const dbg = new PyDebugger('squares = [x * x for x in range(3)]\n');
  const xs = [];
  while (!dbg.humanStep().done) {
    const ev = dbg.getCurrentEvent();
    if (ev.nodeType === 'LoopBinding') xs.push(ev.env[0].x);
  }
  assert.deepEqual(xs, [0, 1, 2]);
  const last = dbg.trace[dbg.trace.length - 1];
  assert.equal('x' in last.env[0], false);
  assert.deepEqual([...last.env[0].squares], [0, 1, 4]);
});

test('ADR-005 例2：集合は入れた順に表示される（CPython の表示順とは違う）', () => {
  assert.deepEqual(output('s = {3, 1, 2}\ns.add(0)\nprint(s)\n'), ['{3, 1, 2, 0}']);
});

test('ADR-005 例3：ジェネレーター式は、その場で全部計算したリストになる', () => {
  assert.deepEqual(output('g = (x * 2 for x in range(3))\nprint(g, sum(x for x in [1, 2, 3]))\n'), ['[0, 2, 4] 6']);
});

// ── ADR-006：クラスと例外 ─────────────────────────────────────────────

test('ADR-006 例1：PyVisualizer が出す例外のメッセージは日本語の説明になる（型の名前は CPython と同じ）', () => {
  assert.deepEqual(output('try:\n    int("x")\nexcept ValueError as e:\n    print(type(e).__name__, e)\n'),
    ["ValueError 'x' は整数に変換できません"]);
});

test('ADR-006 例2：raise で投げた例外のメッセージは、書いたとおりに出る', () => {
  assert.deepEqual(output('try:\n    raise ValueError("no scores")\nexcept ValueError as e:\n    print("error:", e, e.args)\n'),
    ["error: no scores ('no scores',)"]);
});

test('ADR-006 例3：例外を捕まえたとき、「人」のステップは except の行で止まり、e がその例外になる', () => {
  const dbg = new PyDebugger('try:\n    x = 1 // 0\nexcept ZeroDivisionError as e:\n    x = -1\n');
  const stops = [];
  while (!dbg.humanStep().done) {
    const ev = dbg.getCurrentEvent();
    stops.push(`${ev.loc.line}:${ev.nodeType}${ev.env[0].e ? `(e=${ev.env[0].e.cls.name})` : ''}`);
  }
  assert.deepEqual(stops, ['2:ExpressionStatement', '3:ExceptBinding(e=ZeroDivisionError)', '4:AssignmentExpression(e=ZeroDivisionError)']);
});

test('ADR-006 例4：__str__ も __repr__ もないインスタンスの表示には、アドレスを付けない', () => {
  assert.deepEqual(output('class Dog:\n    pass\nprint(Dog())\n'), ['<__main__.Dog object>']);
});

test('ADR-006 例5：インスタンスは、画面ではクラス名と属性で表示される', () => {
  const dbg = new PyDebugger('class Dog:\n    def __init__(self, name):\n        self.name = name\nd = Dog("Rex")\n');
  const d = dbg.trace[dbg.trace.length - 1].env[0].d;
  const m = createPythonProfile({}).valueModel;
  assert.equal(m.kind(d), 'object');
  assert.equal(m.label(d), 'Dog');
  assert.deepEqual(m.entries(d), [['name', 'Rex']]);
  assert.equal(formatValue(d).replace(/<[^>]+>/g, ''), "Dog{name: 'Rex'}");   // ADR-009 でクラス名を付けた
});

// ── ADR-007：import math と input() ─────────────────────────────────────────────
import { DebuggerAdapter } from 'js-visualizer/src/core/debugger-adapter.js';

/** フロントエンドの DebuggerAdapter で、入力欄の内容を渡して実行し、最後の時点のコンソールの表示を返す */
const consoleWith = (src, stdin) => {
  const adapter = new DebuggerAdapter();
  let error = null;
  adapter.addEventListener('error', (e) => { error = e.detail.message; });
  adapter.load(src, { stdin });
  adapter.moveTo(adapter.getTrace().length);
  return { lines: adapter.getState().consoleOutput.map(l => l.text), error };
};

test('ADR-007 例1：input() は入力欄の行を読み、プロンプトの後に読んだ行が表示される', () => {
  const { lines } = consoleWith('name = input("名前: ")\nage = int(input("年齢: "))\nprint(name, age + 1)\n', '太郎\n20\n');
  assert.deepEqual(lines, ['名前: 太郎', '年齢: 20', '太郎 21']);
});

test('ADR-007 例2：入力欄の行が足りないと EOFError になり、入力欄に書くよう案内する', () => {
  const { lines, error } = consoleWith('a = input("1つ目: ")\nb = input("2つ目: ")\n', 'x');
  assert.deepEqual(lines, ['1つ目: x', '2つ目: ']);
  assert.match(error, /^EOFError: 入力が足りません（画面の「入力」の欄に/);
});

test('ADR-007 例3：import できるのは math だけで、ほかのモジュールは ModuleNotFoundError になる', () => {
  assert.deepEqual(output('import math\nfrom math import sqrt\nprint(math.floor(2.5), sqrt(2) ** 2 > 1.99)\n'), ['2 True']);
  assert.throws(() => new PyDebugger('import random\n'), (e) => {
    assert.match(e.message, /^ModuleNotFoundError: モジュール 'random' は使えません（PyVisualizer で import できるのは math だけです）/);
    return true;
  });
});

// ── ADR-008：コード表示のオレンジ（評価中の式）は式にだけ付ける ─────────────

/**
 * 式単位で最初から最後まで進め、各ステップでコード表示にオレンジで示される文字列を返す
 * （コード表示は、イベントに end があるときだけ loc〜end をオレンジにする。JSVisualizer の views/code-view）
 */
const orangeAtEachStep = (src) => {
  const lines = src.split('\n');
  const text = (loc, end) => loc.line === end.line
    ? lines[loc.line - 1].slice(loc.column - 1, end.column)
    : [lines[loc.line - 1].slice(loc.column - 1), ...lines.slice(loc.line, end.line - 1), lines[end.line - 1].slice(0, end.column)].join('\n');
  const dbg = new PyDebugger(src);
  const shown = [];
  for (;;) {
    const ev = dbg.getCurrentEvent();
    shown.push(ev?.loc && ev?.end ? text(ev.loc, ev.end) : null);
    if (dbg.cursor >= dbg.trace.length - 1) break;
    dbg.stepIn();
  }
  return shown;
};

const ADR008_SRC = 'total = 0\nfor i in range(2):\n    if i > 0:\n        total += i\nprint(total)\n';

test('ADR-008 例1：実行した直後は、コードにオレンジの範囲が表示されない', () => {
  assert.equal(orangeAtEachStep(ADR008_SRC)[0], null);
});

test('ADR-008 例2：for 文・if 文に止まっても、文全体はオレンジにならない（オレンジは式だけ）', () => {
  const shown = new Set(orangeAtEachStep(ADR008_SRC).filter(s => s !== null));
  assert.deepEqual([...shown].filter(s => s.includes('\n')), []);
  assert.deepEqual([...shown].sort(), [
    '0', '2', 'i', 'i > 0', 'print', 'print(total)', 'range', 'range(2)', 'total', 'total += i', 'total = 0',
  ]);
});

// ── ADR-009：値の表記の細部と、制御フローのループの else ─────────────

import { formatPlain, formatFrameLabel } from 'js-visualizer/src/utils/format.js';

test('ADR-009 例1：辞書はかっこの内側に空白を入れず、空の辞書は {}、空の集合は set() と表示される', () => {
  const src = 'd = {"a": 1}\ne = {}\ns = set()\n';
  assert.deepEqual(['d', 'e', 's'].map(n => shown(src, n)), ["{'a': 1}", '{}', 'set()']);
});

test('ADR-009 例2：1 要素のタプルは (5,) と表示される（変数のビューと式評価・置換の式の中）', () => {
  const dbg = new PyDebugger('t = (5,)\n');
  const t = dbg.trace[dbg.trace.length - 1].env[0].t;
  assert.equal(shown('t = (5,)\n', 't'), '(5,)');
  assert.equal(formatPlain(t), '(5,)');
});

test('ADR-009 例3：インスタンスはクラス名を付けて Dog{name: \'Rex\'} と表示され、コールスタックの見出しでは Dog{…} になる', () => {
  const src = 'class Dog:\n    def __init__(self, name):\n        self.name = name\nclass Cat:\n    pass\nd = Dog("Rex")\nc = Cat()\n';
  assert.deepEqual(['d', 'c'].map(n => shown(src, n)), ["Dog{name: 'Rex'}", 'Cat{}']);
  const d = new PyDebugger(src).trace.at(-1).env[0].d;
  assert.equal(formatFrameLabel({ name: 'bark', args: [d] }), 'bark(Dog{…})');
});

test('ADR-009 例4：制御フローのビューに for の else が表示され、break で抜けたときは else の中の行が実行されていない', () => {
  const src = 'for x in [1, 2, 3]:\n    if x == 2:\n        break\nelse:\n    print("not found")\nprint("done")\n';
  const dbg = new PyDebugger(src);
  const [global] = new TraceBuilder(dbg.trace, src, dbg.ast).buildCFG();
  const loop = global.items[0];
  assert.equal(loop.type, 'for');
  assert.deepEqual(loop.else_.map(it => [it.label, it.execCount]), [['print("not found")', 0]]);
});

// ── ADR-010：エラーメッセージを表示言語に合わせる（英語は CPython と同じ文面） ─────────────

/** エラーの表示欄に出る文字列（code-editor は言語プロファイルの localizeError で表示言語に合わせる） */
const errorBox = (src, lang, opts = {}) => {
  const profile = createPythonProfile({});
  try { new profile.Debugger(src, { lang, ...opts }); } catch (e) { return profile.localizeError(e.message, lang); }
  return null;
};

test('ADR-010 例1：英語表示では、実行時のエラーが CPython と同じ文面で表示される（日本語表示では従来どおり）', () => {
  const src = 'x = [1, 2, 3]\nprint(x[5])\n';
  assert.equal(errorBox(src, 'en'), 'IndexError: list index out of range (line 2)');
  assert.equal(errorBox(src, 'ja'), 'IndexError: list の範囲外の位置 5 を指定しています（長さ 3）（2行目）');
});

test('ADR-010 例2：英語表示では、構文エラーも英語で表示される', () => {
  assert.equal(errorBox('if x > 1\n    print(x)\n', 'en'), "SyntaxError (line 1): expected ':'");
});

test('ADR-010 例3：英語表示で実行すると、except で捕まえた例外を print した内容も英語になる', () => {
  const src = 'try:\n    int("x")\nexcept ValueError as e:\n    print(e)\n';
  const out = (lang) => joinConsoleLines(new (createPythonProfile({}).Debugger)(src, { lang }).consoleLogs).map(l => l.text);
  assert.deepEqual(out('en'), ["invalid literal for int() with base 10: 'x'"]);
  assert.deepEqual(out('ja'), ["'x' は整数に変換できません"]);
});

test('ADR-010 例4：表示言語を切り替えると、表示中のエラーはもう一度実行しなくても切り替わる', () => {
  const profile = createPythonProfile({});
  let message = null;
  try { new profile.Debugger('print(totl)\n', { lang: 'ja' }); } catch (e) { message = e.message; }
  assert.equal(profile.localizeError(message, 'ja'), "NameError: 'totl' という名前は定義されていません（1行目）");
  assert.equal(profile.localizeError(message, 'en'), "NameError: name 'totl' is not defined (line 1)");
});

test('ADR-010 例5：メソッドの引数の誤りは、CPython と同じくクラス名を付けて表示される', () => {
  const src = 'class A:\n    def __init__(self, x):\n        self.x = x\na = A()\n';
  assert.equal(errorBox(src, 'en'), "TypeError: A.__init__() missing 1 required positional argument: 'x' (line 4)");
  assert.equal(errorBox(src, 'ja'), "TypeError: A.__init__() の引数 'x' が渡されていません（4行目）");
});

// ── ADR-011：入門でよく使う書き方 ─────────────

test('ADR-011 例1：型注釈を付けた関数・変数が、そのまま実行できる', () => {
  assert.deepEqual(output('def area(w: int, h: int = 2) -> int:\n    return w * h\nsize: int = area(3)\nprint(size)\n'), ['6']);
});

test('ADR-011 例2：* のアンパック・:=・f"{x=}" が使える', () => {
  const src = 'first, *rest = [1, 2, 3]\nif (n := len(rest)) > 1:\n    print(first, rest, n)\npi = 3.14159\nprint(f"{pi=} {pi = :.2f}")\n';
  assert.deepEqual(output(src), ['1 [2, 3] 2', 'pi=3.14159 pi = 3.14']);
});

test('ADR-011 例3：str.format・map・filter・any・divmod・hex・int(s, 16) などが使える', () => {
  const src = 'print("{} + {} = {:.1f}".format(1, 2, 3))\nprint(list(map(str, [1, 2])), list(filter(None, [0, 3])), any([0, 1]), divmod(7, 2), hex(255), int("ff", 16))\n';
  assert.deepEqual(output(src), ['1 + 2 = 3.0', "['1', '2'] [3] True (3, 1) 0xff 255"]);
});

test('ADR-011 例4：exit() を呼ぶと、エラーにならずにそこで終わる', () => {
  assert.deepEqual(output('print("start")\nexit()\nprint("not reached")\n'), ['start']);
});

test('ADR-011 例5：map に渡した関数は、map を呼んだときに全部呼ばれる（CPython は値を取り出すときに呼ぶ）', () => {
  const src = 'def show(x):\n    print("call", x)\n    return x\nm = map(show, [1, 2])\nprint("made")\nprint(list(m))\n';
  assert.deepEqual(output(src), ['call 1', 'call 2', 'made', '[1, 2]']);
});

test('ADR-011 例6：大きな小数・小さな小数は CPython と同じく指数表記になり、書式の丸めも CPython と同じ', () => {
  assert.deepEqual(output('print(1e20, 0.00001, 2.0 ** 70)\nprint(f"{2.675:.2f} {2.5:.0f}")\n'), ['1e+20 1e-05 1.1805916207174113e+21', '2.67 2']);
});

// ── ADR-012：デコレーター・with・match ─────────────

test('ADR-012 例1：自作のデコレーターと、property・staticmethod・classmethod が使える', () => {
  const src = [
    'def loud(f):', '    def w(*a):', '        return f(*a).upper()', '    return w',
    '@loud', 'def greet(name):', '    return "hi " + name',
    'class C:', '    def __init__(self):', '        self._v = 1',
    '    @property', '    def v(self):', '        return self._v',
    '    @v.setter', '    def v(self, x):', '        self._v = x * 10',
    '    @staticmethod', '    def s():', '        return "s"',
    '    @classmethod', '    def k(cls):', '        return cls.__name__',
    'c = C()', 'c.v = 2', 'print(greet("ann"), c.v, C.s(), C.k())', '',
  ].join('\n');
  assert.deepEqual(output(src), ['HI ANN 20 s C']);
});

test('ADR-012 例2：with は __enter__ と __exit__ を呼び、__exit__ が True を返すと例外を止める', () => {
  const src = [
    'class Box:', '    def __enter__(self):', '        print("open")', '        return self',
    '    def __exit__(self, et, ev, tb):', '        print("close", et.__name__ if et else None)', '        return True',
    'with Box() as b:', '    print("inside")', '    1 / 0', 'print("after")', '',
  ].join('\n');
  assert.deepEqual(output(src), ['open', 'inside', 'close ZeroDivisionError', 'after']);
});

test('ADR-012 例3：match のいろいろなパターンが使える', () => {
  const src = [
    'def f(x):', '    match x:',
    '        case 0 | 1:', '            return "small"',
    '        case [a, *rest]:', '            return f"list {a} {rest}"',
    '        case {"name": n}:', '            return "name " + n',
    '        case str() as s if len(s) > 3:', '            return "long " + s',
    '        case _:', '            return "other"',
    'print(f(1), f([5, 6, 7]), f({"name": "ann"}), f("hello"), f("hi"))', '',
  ].join('\n');
  assert.deepEqual(output(src), ['small list 5 [6, 7] name ann long hello other']);
});

test('ADR-012 例4：「人」のステップは、当てはまった case と with … as の代入で止まる', () => {
  const src = [
    'class Box:', '    def __enter__(self):', '        return 7', '    def __exit__(self, *a):', '        return False',
    'with Box() as b:', '    pass',
    'match [1, 2]:', '    case [x]:', '        pass', '    case [x, y]:', '        pass', '',
  ].join('\n');
  const dbg = new PyDebugger(src);
  const stops = [];
  while (!dbg.humanStep().done) {
    const ev = dbg.getCurrentEvent();
    if (ev.nodeType === 'WithBinding' || ev.nodeType === 'CaseBinding') stops.push(`${ev.loc.line}:${ev.nodeType}`);
  }
  assert.deepEqual(stops, ['6:WithBinding', '11:CaseBinding']);
});

test('ADR-012 例5：制御フローのビューは、match の case を if … else の連なりとして描く', () => {
  const src = 'x = 2\nmatch x:\n    case 1:\n        print("one")\n    case 2:\n        print("two")\n';
  const dbg = new PyDebugger(src);
  const [global] = new TraceBuilder(dbg.trace, src, dbg.ast).buildCFG();
  const match = global.items.find(it => it.type === 'seq' && it.children[0].label === 'match x:');
  assert.ok(match, 'match の見出しがある');
  const chain = match.children[1];
  assert.deepEqual([chain.condLabel, chain.execCount, chain.else_[0].condLabel, chain.else_[0].execCount], ['case 1:', 1, 'case 2:', 1]);
  assert.deepEqual(chain.else_[0].then_.map(i => [i.label, i.execCount]), [['print("two")', 1]]);
});

test('ADR-012 例6：open() はまだ使えず、データをプログラムの中に書くよう案内する', () => {
  assert.throws(() => new PyDebugger('with open("data.txt") as f:\n    print(f.read())\n'),
    (e) => { assert.match(e.message, /open\(\) によるファイルの読み書きはまだ対応していません/); return true; });
});
