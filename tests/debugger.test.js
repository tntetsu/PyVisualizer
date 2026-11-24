/**
 * debugger.test.js — PyDebugger と共通コア（js-interpreter/core）の組み合わせ（Phase 1 で解消した点）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TraceDebugger } from 'js-interpreter/core';
import { PyDebugger, JSDebugger } from '../src/engine/py-debugger.js';

const stops = (src) => {
  const dbg = new PyDebugger(src);
  const out = [];
  while (!dbg.humanStep().done) {
    const e = dbg.getCurrentEvent();
    out.push(`L${e.loc.line}:${e.nodeType}`);
  }
  return { dbg, out };
};

test('for x in ... の各回で humanStep が止まる（LoopBinding）', () => {
  const { dbg, out } = stops('total = 0\nfor i in range(3):\n    total += i\n');
  assert.deepEqual(out, [
    'L1:AssignmentExpression',
    'L2:LoopBinding', 'L3:AssignmentExpression',
    'L2:LoopBinding', 'L3:AssignmentExpression',
    'L2:LoopBinding', 'L3:AssignmentExpression',
  ]);
  // LoopBinding の exit では、ループ変数がその回の値になっている
  const bindings = dbg.trace.filter(e => e.phase === 'exit' && e.nodeType === 'LoopBinding');
  assert.deepEqual(bindings.map(e => [e.value, e.env[0].i]), [[0, 0], [1, 1], [2, 2]]);
});

test('while は毎回の条件式で止まる', () => {
  const { out } = stops('n = 0\nwhile n < 2:\n    n += 1\n');
  assert.deepEqual(out, [
    'L1:AssignmentExpression', 'L2:BinaryExpression', 'L3:AssignmentExpression',
    'L2:BinaryExpression', 'L3:AssignmentExpression', 'L2:BinaryExpression',
  ]);
});

test('tuple はスナップショットでも tuple のまま（クローンの hook）', () => {
  const dbg = new PyDebugger('t = (1, [2])\nt[1].append(3)\n');
  const last = dbg.trace[dbg.trace.length - 1];
  const t = last.env[0].t;
  assert.equal(t.__pytuple__, true);
  assert.deepEqual([...t[1]], [2, 3]);
  // 途中のスナップショットは、その時点の値（append 前）
  const afterAssign = dbg.trace.find(e => e.phase === 'exit' && e.nodeType === 'AssignmentExpression');
  assert.deepEqual([...afterAssign.env[0].t[1]], [2]);
});

test('print(..., end=" ") は出力の断片（eol: false）として記録される', () => {
  const dbg = new PyDebugger('for i in range(2):\n    print(i, end=" ")\nprint("!")\n');
  assert.deepEqual(dbg.consoleLogs.map(l => [l.text, l.eol]), [['0 ', false], ['1 ', false], ['!', true]]);
});

test('PyDebugger は TraceDebugger の派生クラスで、fromTrace も PyDebugger を返す', () => {
  const dbg = new PyDebugger('x = 1\n');
  assert.ok(dbg instanceof TraceDebugger);
  assert.equal(JSDebugger, PyDebugger);
  assert.ok(PyDebugger.fromTrace(dbg.source, dbg.trace, dbg.ast, dbg.consoleLogs) instanceof PyDebugger);
});
