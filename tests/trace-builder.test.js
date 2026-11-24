/**
 * trace-builder.test.js — PyDebugger のトレースを JSVisualizer の TraceBuilder に通す（Phase 0 の確認）
 *
 * JSVisualizer のコードは改変せずに import する。ここで落ちるメソッドは Phase 3 で言語非依存化が必要な箇所。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TraceBuilder } from 'js-visualizer/src/core/trace-builder.js';
import { PyDebugger } from '../src/engine/py-debugger.js';

const ROOT = new URL('..', import.meta.url).pathname;
const samples = readdirSync(join(ROOT, 'samples')).filter(f => f.endsWith('.py'));

for (const f of samples) {
  test(`TraceBuilder: ${f}`, () => {
    const src = readFileSync(join(ROOT, 'samples', f), 'utf8');
    const dbg = new PyDebugger(src, { maxSteps: 50_000 });
    const b = new TraceBuilder(dbg.trace, src, dbg.ast);
    // 停止点の定義は JSDebugger._getHumanIndices と TraceBuilder で JS 版でも元々少し違う（phase0-report 参照）ので、作られることだけ確かめる
    assert.ok(b.buildHumanIndices().size > 0);
    assert.ok(dbg._getHumanIndices().size > 0);
    assert.ok(b.buildHeatmap().size > 0);
    b.buildCallTree();
    b.buildRecursionTree();
    b.buildLifetime();
    const cfg = b.buildCFG();
    assert.ok(cfg.length > 0);
  });
}

test('TraceBuilder: 再帰（fib）の呼び出しツリーが作られる', () => {
  const src = readFileSync(join(ROOT, 'samples', '01_fibonacci.py'), 'utf8');
  const dbg = new PyDebugger(src);
  const tree = new TraceBuilder(dbg.trace, src, dbg.ast).buildCallTree();
  const count = (nodes) => nodes.reduce((s, n) => s + 1 + count(n.children ?? []), 0);
  assert.equal(count(tree), 9); // fib(5) の呼び出しは 9 回（print は組み込みなので数えない）
});
