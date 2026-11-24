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
