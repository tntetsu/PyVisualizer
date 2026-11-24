/**
 * py-debugger.js — PyDebugger（Phase 0 スパイク）
 *
 * JSDebugger と同じ API を持つ。プログラムを最後まで実行してトレースを作ったあと、
 * JSDebugger.fromTrace() でインスタンスを作るので、ステップ操作（stepIn/Over/Out/Back・humanStep・continue）は
 * JSInterpreter のものを無改造で使う。
 *
 * JSVisualizer の debugger-adapter.js は `import { JSDebugger, ExecutionError } from '../../web/interpreter.bundle.js'`
 * しているので、スパイクのビルドではこのモジュールをその名前で差し込む（scripts/build-spike.mjs）。
 */
import { JSDebugger, ExecutionError } from 'js-interpreter/src/interpreter/debugger.js';
import { Environment } from 'js-interpreter/src/interpreter/environment.js';
import { parse } from './parse.js';
import { evaluate, PyRecorder } from './interpreter.js';
import { PyError } from './values.js';

/**
 * Python のソースを実行してトレースを作る。
 * @returns {{ ast, trace, consoleLogs }}
 * @throws {PySyntaxError|ExecutionError}
 */
export function runPython(source, { maxSteps = 100_000 } = {}) {
  const ast = parse(source);
  const recorder = new PyRecorder(maxSteps);
  const env = new Environment(null, 'global');
  try {
    evaluate(ast, env, { recorder }, 0, 0);
    recorder.flush();
  } catch (e) {
    recorder.flush();
    // ホストの JS のスタックがあふれた場合は、Python の RecursionError として扱う
    // （Node の既定のスタックで約 290 段。CPython の上限 1000 段より浅い。docs/phase0-report.md）
    const err = e instanceof RangeError && /call stack|too much recursion/i.test(e.message)
      ? new PyError('RecursionError', '関数の呼び出しが深くなりすぎたため停止しました（再帰が止まっていない可能性があります）')
      : e;
    // JSDebugger と同じく、末尾の閉じていない enter を除き、外側の matchIdx をトレースの末尾にそろえる
    const tr = recorder.trace;
    let tail = tr.length - 1;
    while (tail >= 0 && tr[tail].matchIdx === -1) tail--;
    tr.length = tail + 1;
    for (const ev of tr) if (ev.matchIdx === -1) ev.matchIdx = tr.length;
    throw new ExecutionError(err, source, tr, ast, recorder.consoleLogs);
  }
  return { ast, trace: recorder.trace, consoleLogs: recorder.consoleLogs };
}

export class PyDebugger extends JSDebugger {
  /**
   * @param {string} source
   * @param {{maxSteps?: number}} [options]
   */
  // eslint-disable-next-line constructor-super
  constructor(source, options = {}) {
    const { ast, trace, consoleLogs } = runPython(source, options);
    const inst = JSDebugger.fromTrace(source, trace, ast, consoleLogs);
    inst.maxSteps = options.maxSteps ?? 100_000;
    Object.setPrototypeOf(inst, new.target.prototype);
    return inst; // 派生クラスのコンストラクターは super() を呼ばずにオブジェクトを返せる
  }
}

// debugger-adapter.js が使う名前で公開する
export { PyDebugger as JSDebugger, ExecutionError };
