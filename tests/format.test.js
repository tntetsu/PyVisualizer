/**
 * format.test.js — 書式指定（f 文字列・format()・str.format の {:spec}）を CPython の format() と比べる（ADR-011）
 *
 * 値 × 書式指定の組み合わせを CPython（python3）で format() し、PyVisualizer の formatValue() と一致することを確かめる。
 * CPython がエラーにする組み合わせは、PyVisualizer もエラーにすることだけを確かめる（例外の種類・文面は問わない）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatValue } from '../src/engine/builtins.js';
import { makeFloat, repr } from '../src/engine/values.js';

const VALUES = ['0', '7', '-7', '42', '255', '1234567', '3.14159', '-2.5', '0.000123', '123456789.0', '1e20', '0.5',
  '100.0', '2.675', '1e-5', 'True', "'ab'", "'hello'"];
const SPECS = ['', '5', '<5', '^6', '>6', '05', '+', '+.2f', '.2f', '.0f', '.3', '.2e', 'E', 'g', '.3g', 'G', '%', '.1%',
  ',', ',.2f', '_', '08b', '#x', '#o', 'X', '#X', 'c', 'd', 'n', 's', '.2s', '*^9', '=+8', '08.3f', ' d', 'x<6', ',d',
  'b', 'o', '10.4', 'e', '.10g', '#.3g', '.1f', '5.1f', '.2', '_x', '#b'];

const PY = `
import json, sys
vals = [${VALUES.join(', ')}]
specs = json.loads(sys.argv[1])
out = []
for v in vals:
    for sp in specs:
        try:
            r = format(v, sp)
        except Exception:
            r = None
        out.append(r)
print(json.dumps(out))
`;

/** CPython の値の書き方 → PyVisualizer の値 */
const toValue = (s) => (s === 'True' ? true : s.startsWith("'") ? s.slice(1, -1)
  : /[.e]/.test(s) ? makeFloat(Number(s)) : Number(s));

test('書式指定が CPython の format() と一致する', () => {
  const expected = JSON.parse(execFileSync('python3', ['-I', '-c', PY, JSON.stringify(SPECS)], { encoding: 'utf8' }));
  const mismatches = [];
  let k = 0;
  for (const v of VALUES) {
    for (const spec of SPECS) {
      const want = expected[k++];
      let got;
      try { got = formatValue(toValue(v), spec, null); } catch { got = null; }
      if (got !== want) mismatches.push(`format(${v}, ${JSON.stringify(spec)})：CPython ${JSON.stringify(want)}、PyVisualizer ${JSON.stringify(got)}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('小数の repr が CPython と一致する（指数が -4 未満か 16 以上なら指数表記）', () => {
  const xs = ['1e16', '1e20', '1.5e20', '1e-4', '1e-5', '0.000123', '1.23e-7', '123456789.0', '1e15', '0.1', '-2.5', '12345678901234567890.0'];
  const want = JSON.parse(execFileSync('python3', ['-I', '-c', `import json; print(json.dumps([repr(x) for x in [${xs.join(', ')}]]))`], { encoding: 'utf8' }));
  assert.deepEqual(xs.map(x => repr(makeFloat(Number(x)))), want);
});
