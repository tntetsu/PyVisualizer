/**
 * py-debugger.js — PyDebugger
 *
 * 共通コアの TraceDebugger の派生クラス。プログラムを最後まで実行してトレースを作り、ステップ操作
 * （stepIn/Over/Out/Back・humanStep・continue）は TraceDebugger のものを使う。humanStep の停止点は
 * PY_NODE_CATEGORIES で決まる。
 *
 * JSVisualizer の debugger-adapter.js は `import { JSDebugger, ExecutionError } from '../../web/interpreter.bundle.js'`
 * しているので、その名前でも export する（scripts/build-spike.mjs が差し込む）。
 */
import { TraceDebugger, ExecutionError, finalizePartialTrace } from 'js-interpreter/core';
import { parse } from './parse.js';
import { evaluate, createRecorder, PyScope, installInvoker } from './interpreter.js';
import { PyError } from './values.js';
import { setRuntimeLang } from './messages-en.js';

/**
 * Python のノード型の役割（共通コアの NodeCategories）
 * - for x in ... の各回のループ変数への代入（LoopBinding）、except で捕まえたところ（ExceptBinding）で止まる
 * - while は毎回の条件式で止まる（condLoop）。C 形式の for はないので forLoop は空
 */
export const PY_NODE_CATEGORIES = Object.freeze({
  // LoopBinding：for・内包表記の各回のループ変数への代入（ADR-003）。ExceptBinding：except で例外を捕まえたところ（ADR-006）
  stopOnExit: ['AssignmentExpression', 'ReturnStatement', 'LoopBinding', 'ExceptBinding'],
  call:       ['CallExpression'],
  block:      ['BlockStatement'],
  branch:     ['IfStatement', 'ConditionalExpression'],
  condLoop:   ['WhileStatement'],
  forLoop:    [],
  forInit:    [],
  // raise・assert は、例外で中断したら（exit がない）その文の enter で止まる（式文と同じ扱い）
  exprStmt:   ['ExpressionStatement', 'RaiseStatement', 'AssertStatement'],
});

/**
 * Python のソースを実行してトレースを作る。
 * @returns {{ ast, trace, consoleLogs }}
 * @throws {PySyntaxError|ExecutionError}
 */
/**
 * @param {string} source
 * @param {{ maxSteps?: number, stdin?: string, lang?: 'ja'|'en' }} [options] stdin：input() で読む内容（改行区切り）。
 *   lang：except で捕まえた例外の str(e) の言語（画面の表示言語。ADR-010）
 */
export function runPython(source, { maxSteps = 100_000, stdin = '', lang = 'ja' } = {}) {
  setRuntimeLang(lang);
  const ast = parse(source);
  const recorder = createRecorder(maxSteps);
  const env = new PyScope(null, 'global');
  // 末尾の改行は空の行として数えない（入力欄の最後で改行しても、余分な行にしない）
  const rt = { recorder, stdin: stdin === '' ? [] : stdin.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n') };
  installInvoker(rt);
  try {
    evaluate(ast, env, rt, 0, 0);
  } catch (e) {
    // ホストの JS のスタックがあふれた場合は、Python の RecursionError として扱う
    // （Node の既定のスタックで約 290 段。CPython の上限 1000 段より浅い。docs/phase0-report.md 3.2 節 g）
    const err = e instanceof RangeError && /call stack|too much recursion/i.test(e.message)
      ? new PyError('RecursionError', '関数の呼び出しが深くなりすぎたため停止しました（再帰が止まっていない可能性があります）')
      : e;
    throw new ExecutionError(err, source, finalizePartialTrace(recorder.trace), ast, recorder.consoleLogs);
  }
  return { ast, trace: recorder.trace, consoleLogs: recorder.consoleLogs };
}

export class PyDebugger extends TraceDebugger {
  static nodeCategories = PY_NODE_CATEGORIES;

  /**
   * @param {string} source
   * @param {{maxSteps?: number, stdin?: string, lang?: 'ja'|'en'}} [options] lang：str(e) の言語（ADR-010）
   */
  constructor(source, options = {}) {
    const maxSteps = options.maxSteps ?? 100_000;
    const { ast, trace, consoleLogs } = runPython(source, { maxSteps, stdin: options.stdin ?? '', lang: options.lang });
    super({ source, trace, ast, consoleLogs, maxSteps });
  }
}

// debugger-adapter.js が使う名前で公開する
export { PyDebugger as JSDebugger, ExecutionError };
