/**
 * oracle.test.js — CPython を正解とした比較テスト（docs/development-plan.md 4.3 節）
 *
 * samples/*.py と tests/cases/*.py を CPython（python3）と PyDebugger の両方で実行し、
 * 標準出力が一致すること、例外で終わるプログラムは例外の種類が一致することを確かめる。
 * さらに英語表示で実行し（ADR-010）、出力と例外のメッセージ（CPython の最後の行「型: メッセージ」）が一致することを確かめる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPython } from '../src/engine/py-debugger.js';
import { joinConsoleLines } from 'js-interpreter/core';
import { messageToEnglish } from '../src/engine/messages-en.js';

/** 英語のメッセージが CPython と違うことを意図したもの（PyVisualizer 固有の案内を足している） */
const MESSAGE_DIFFERS = new Map([
  ['error_import_unknown.py', 'import できるのは math だけであることを案内する'],
  ['error_input_eof.py', '画面の「入力」の欄に書くよう案内する'],
]);

const ROOT = new URL('..', import.meta.url).pathname;
const files = [
  ...readdirSync(join(ROOT, 'samples')).map(f => join(ROOT, 'samples', f)),
  ...readdirSync(join(ROOT, 'tests/cases')).map(f => join(ROOT, 'tests/cases', f)),
].filter(f => f.endsWith('.py'));

/** input() で読む行（program.py と同じ名前の program.stdin があれば、その内容） */
const stdinOf = (file) => (existsSync(file.replace(/\.py$/, '.stdin')) ? readFileSync(file.replace(/\.py$/, '.stdin'), 'utf8') : '');

function runCPython(file) {
  const stdin = stdinOf(file);
  try {
    // input() は端末と同じく読んだ行を表示する形にそろえる（tools/run_echo.py）
    const args = stdin ? ['-I', join(ROOT, 'tests/tools/run_echo.py'), file] : ['-I', file];
    return { out: execFileSync('python3', args, { encoding: 'utf8', input: stdin, stdio: ['pipe', 'pipe', 'pipe'] }), errType: null, errLine: null };
  } catch (e) {
    const last = e.stderr.trim().split('\n').pop();
    return { out: e.stdout, errType: last.split(':')[0], errLine: last };
  }
}

function runPy(file, lang = 'ja') {
  const src = readFileSync(file, 'utf8');
  try {
    const { consoleLogs } = runPython(src, { maxSteps: 2_000_000, stdin: stdinOf(file), lang });
    return { out: joinConsoleLines(consoleLogs).map(l => l.text + '\n').join(''), errType: null, errLine: null };
  } catch (e) {
    const logs = joinConsoleLines(e.partialConsoleLogs ?? []);
    // 表示欄と同じく英語にし、行番号（ (line N)）を除いて CPython の最後の行と比べる
    const errLine = (messageToEnglish(e.message) ?? e.message).replace(/ \(line \d+\)$/, '');
    return { out: logs.map(l => l.text + '\n').join(''), errType: e.cause?.pyType ?? e.cause?.exc?.cls?.name ?? `(host) ${e.message}`, errLine };
  }
}

for (const file of files) {
  test(file.slice(ROOT.length), () => {
    const expected = runCPython(file);
    const actual = runPy(file);
    assert.equal(actual.errType, expected.errType);
    // 改行なしで終わる出力は、joinConsoleLines が最後に 1 行としてまとめるので改行を足してそろえる
    const norm = (s) => (s === '' || s.endsWith('\n') ? s : s + '\n');
    assert.equal(norm(actual.out), norm(expected.out));

    // 英語表示：出力（print(e) を含む）と例外のメッセージが CPython と一致する
    const en = runPy(file, 'en');
    assert.equal(norm(en.out), norm(expected.out), '英語表示の出力');
    const name = file.split('/').pop();
    if (expected.errLine && !MESSAGE_DIFFERS.has(name)) assert.equal(en.errLine, expected.errLine, '英語のメッセージ');
  });
}
