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

test('ADR-004 例3：辞書とタプルは中身が Python の書き方で表示される', () => {
  assert.equal(shown('d = {"a": 1, 2: None}\n', 'd'), "{ 'a': 1, 2: None }");
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
  assert.equal(formatValue(d).replace(/<[^>]+>/g, ''), "{ name: 'Rex' }");
});
