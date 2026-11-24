/**
 * oracle.test.js — CPython を正解とした比較テスト（docs/development-plan.md 4.3 節）
 *
 * samples/*.py と tests/cases/*.py を CPython（python3）と PyDebugger の両方で実行し、
 * 標準出力が一致すること、例外で終わるプログラムは例外の種類が一致することを確かめる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPython } from '../src/engine/py-debugger.js';

const ROOT = new URL('..', import.meta.url).pathname;
const files = [
  ...readdirSync(join(ROOT, 'samples')).map(f => join(ROOT, 'samples', f)),
  ...readdirSync(join(ROOT, 'tests/cases')).map(f => join(ROOT, 'tests/cases', f)),
].filter(f => f.endsWith('.py'));

function runCPython(file) {
  try {
    return { out: execFileSync('python3', ['-I', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), errType: null };
  } catch (e) {
    const last = e.stderr.trim().split('\n').pop();
    return { out: e.stdout, errType: last.split(':')[0] };
  }
}

function runPy(file) {
  const src = readFileSync(file, 'utf8');
  try {
    const { consoleLogs } = runPython(src, { maxSteps: 2_000_000 });
    return { out: consoleLogs.map(l => l.text + '\n').join(''), errType: null };
  } catch (e) {
    const logs = e.partialConsoleLogs ?? [];
    return { out: logs.map(l => l.text + '\n').join(''), errType: e.cause?.pyType ?? `(host) ${e.message}` };
  }
}

for (const file of files) {
  test(file.slice(ROOT.length), () => {
    const expected = runCPython(file);
    const actual = runPy(file);
    assert.equal(actual.errType, expected.errType);
    // 改行なしで終わる出力は、PyRecorder が最後に 1 行として記録するので改行を足してそろえる
    const norm = (s) => (s === '' || s.endsWith('\n') ? s : s + '\n');
    assert.equal(norm(actual.out), norm(expected.out));
  });
}
