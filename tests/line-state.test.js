/**
 * line-state.test.js — 変数の状態の変化の列を CPython と比べる（docs/development-plan.md 4.3 節の後半）
 *
 * CPython 側（tests/tools/trace_states.py）は、各行の実行前と関数を抜けるときに、そのフレームの変数の
 * repr を取り、前回から変わったものを「関数名:変数名=repr」として順に記録する。
 * PyDebugger 側は、トレースのうち同じ時点に当たるイベント（各文の enter、for の各回のループ変数への代入
 * （LoopBinding）の enter、関数を抜ける直前のイベント）で同じように記録する。呼び出しはフレームの callId で区別する。チェックする時点の細かさが少し違っても、各文の効果は次の文の前に確かめられるので、
 * 変化の列は一致する（1 行に複数の文を書いた場合は一致しないので、テストのプログラムでは書かない）。
 * 内包表記の中ではどちらもチェックしない（CPython 3.12 は内包表記を呼び出し元のフレームの中で実行するため、
 * 途中の変数が一時的に見える。PEP 709）。集合は要素を並べ替えて比べる（CPython の集合の順序はハッシュ値で決まる）。
 * 例外は型だけを比べる（エンジンが投げた例外のメッセージは日本語で、CPython と違う。ADR-006）。
 *
 * 出力の比較（oracle.test.js）では見えない、途中の変数の値の誤りを見つけるためのテスト。
 * 例外で終わるプログラムは、例外の直前の変化の扱いが両者で異なるので対象外。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PyDebugger } from '../src/engine/py-debugger.js';
import { repr, isSet, isTuple, isDict } from '../src/engine/values.js';
import { isException, isInstance, isClass } from '../src/engine/objects.js';

const ROOT = new URL('..', import.meta.url).pathname;
const files = [
  ...readdirSync(join(ROOT, 'samples')).map(f => join(ROOT, 'samples', f)),
  // error_（例外で終わる）・output_（出力だけを比べる）で始まるテストケースは対象外
  ...readdirSync(join(ROOT, 'tests/cases')).filter(f => !f.startsWith('error_') && !f.startsWith('output_')).map(f => join(ROOT, 'tests/cases', f)),
].filter(f => f.endsWith('.py'));

/** CPython の line イベントに当たる文 */
const STATEMENTS = new Set([
  'ExpressionStatement', 'IfStatement', 'WhileStatement', 'ForOfStatement', 'ReturnStatement',
  'FunctionDeclaration', 'BreakStatement', 'ContinueStatement', 'EmptyStatement', 'DeleteStatement',
  'TryStatement', 'RaiseStatement', 'AssertStatement', 'ClassDeclaration',
  'WithStatement', 'DecoratedStatement', 'MatchStatement', 'ImportStatement', 'ImportFromStatement',
]);

const isFunctionValue = (v) => v && (v.__type__ === 'JSFunction' || typeof v === 'function' || isClass(v) || v.constructor?.name === 'PyModule');

/** repr と同じだが、集合は要素の repr を並べ替えて出す（tools/trace_states.py の srepr と同じ規則） */
function srepr(v) {
  if (isException(v)) return `<${v.cls.name}>`;   // エンジンが投げた例外のメッセージは日本語なので、型だけを比べる
  if (isInstance(v)) {   // ユーザーの __repr__ を呼ばずに属性から作る（tools/trace_states.py と同じ形）
    return `<${v.cls.name} {${Object.entries(v.attrs).map(([k, x]) => `${repr(k)}: ${srepr(x)}`).join(', ')}}>`;
  }
  if (isSet(v)) return v.length ? `{${v.map(srepr).sort().join(', ')}}` : 'set()';
  if (isTuple(v)) return v.length === 1 ? `(${srepr(v[0])},)` : `(${v.map(srepr).join(', ')})`;
  if (Array.isArray(v)) return `[${v.map(srepr).join(', ')}]`;
  if (isDict(v)) return `{${v.keys.map((k, i) => `${srepr(k)}: ${srepr(v.values[i])}`).join(', ')}}`;
  return repr(v);
}

/** イベントがどの呼び出しのフレームに属するか（モジュールは 0） */
const frameKey = (ev) => (ev.callDepth === 0 ? 0 : ev.callStack[ev.callStack.length - 1].callId);

/** PyDebugger のトレースから、変数の状態の変化の列を作る */
export function stateChanges(trace) {
  const changes = [];
  const prev = new Map();   // frameKey → そのフレームの前回のスナップショット（{ 名前: repr }）
  const baseLen = new Map(); // frameKey → そのフレームの最初のイベントのスコープの深さ（env.length）
  for (let i = 0; i < trace.length; i++) {
    const ev = trace[i];
    const key = frameKey(ev);
    if (!prev.has(key)) { prev.set(key, {}); baseLen.set(key, ev.env.length); }
    // 内包表記の中（フレームのスコープより深いスコープ）ではチェックしない（CPython 側も内包表記の繰り返しではチェックしない）
    if (ev.env.length > baseLen.get(key)) continue;
    const next = trace[i + 1];
    const leaving = !next || next.callDepth < ev.callDepth
      || (next.callDepth === ev.callDepth && frameKey(next) !== key);   // 関数（またはプログラム）を抜ける直前
    const checkpoint = leaving
      || (ev.phase === 'enter' && (STATEMENTS.has(ev.nodeType) || ev.nodeType === 'LoopBinding'));
    if (!checkpoint) continue;
    const frameName = ev.callDepth === 0 ? '<module>' : ev.callStack[ev.callStack.length - 1].name;
    const cur = {};
    for (const [k, v] of Object.entries(ev.env[0] ?? {})) {
      if (!k.startsWith('__') && !isFunctionValue(v)) cur[k] = srepr(v);
    }
    const old = prev.get(key);
    for (const [k, v] of Object.entries(cur)) {
      if (old[k] !== v) changes.push(`${frameName}:${k}=${v}`);
    }
    prev.set(key, cur);
  }
  return changes;
}

for (const file of files) {
  test(`変数の状態の変化: ${file.slice(ROOT.length)}`, () => {
    const stdinFile = file.replace(/\.py$/, '.stdin');
    const stdin = existsSync(stdinFile) ? readFileSync(stdinFile, 'utf8') : '';
    const expected = JSON.parse(execFileSync('python3', ['-I', join(ROOT, 'tests/tools/trace_states.py'), file], { encoding: 'utf8', input: stdin }));
    assert.equal(expected.error, null);
    const dbg = new PyDebugger(readFileSync(file, 'utf8'), { maxSteps: 2_000_000, stdin });
    assert.deepEqual(stateChanges(dbg.trace), expected.changes);
  });
}
