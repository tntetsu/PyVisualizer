/**
 * compare-js-core.mjs — JSInterpreter の共通コア切り出し（Phase 1）で、JS 版の挙動が変わっていないことを確かめる
 *
 * main（master）の作業ディレクトリ ../JSInterpreter と、作業ブランチの worktree ../JSInterpreter-core の
 * 両方の JSDebugger で同じ JS プログラムを実行し、次を 1 件ずつ比べる：
 *   - 全 TraceEvent（phase・nodeType・loc・end・depth・callDepth・matchIdx・callStack・env・frameEnvs・
 *     globalBlockVars・domSnapshot・value）
 *   - consoleLogs、humanStep の停止点（_getHumanIndices）、getResult()
 *   - 例外（ExecutionError の場合は message と部分トレース・部分ログ）、fromTrace() のクラス
 *
 * 対象：JSVisualizer の組み込みサンプル・記事の題材、JSInterpreter の examples、BhvVisualizer の授業の演習、
 * およびエラー・DOM モードなどの追加ケース。
 *
 *   node scripts/compare-js-core.mjs [旧の JSInterpreter] [新の JSInterpreter]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROJECTS = resolve(new URL('../..', import.meta.url).pathname);
const OLD = resolve(process.argv[2] ?? join(PROJECTS, 'JSInterpreter'));
const NEW = resolve(process.argv[3] ?? join(PROJECTS, 'JSInterpreter-core'));

const oldMod = await import(join(OLD, 'src/interpreter/debugger.js'));
const newMod = await import(join(NEW, 'src/interpreter/debugger.js'));

// ── 比較対象のプログラム ───────────────────────────────────────────────────
const programs = [];
const add = (name, code, options = {}) => programs.push({ name, code, options });

const { SAMPLES } = await import(join(PROJECTS, 'JSVisualizer/src/components/code-editor.js'));
for (const [k, v] of Object.entries(SAMPLES)) add(`JSVisualizer sample ${k}`, v.code);

const articles = join(PROJECTS, 'JSVisualizer/web/samples/articles');
for (const f of readdirSync(articles).filter(f => f.endsWith('.json') && !f.includes('.en.'))) {
  add(`article ${f}`, JSON.parse(readFileSync(join(articles, f), 'utf8')).code);
}

const examples = join(OLD, 'examples');
for (const f of readdirSync(examples).filter(f => f.endsWith('.js'))) add(`example ${f}`, readFileSync(join(examples, f), 'utf8'));

const exercises = join(PROJECTS, 'BhvVisualizer/its/exercices');
if (existsSync(exercises)) {
  for (const f of readdirSync(exercises).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(exercises, f), 'utf8'));
    (j.codes ?? []).forEach((c, i) => add(`exercise ${f}#${i}`, c.sourceCode ?? c.code ?? ''));
  }
}

// 追加ケース：エラー（部分トレース）、上限超過、console の各レベル、try/catch、クラス、Promise、DOM モード
add('runtime error', 'let a = [1, 2];\nconsole.log(a[0]);\nnull.x;');
add('max steps', 'let i = 0;\nwhile (true) { i++; }', { maxSteps: 2000 });
add('stack overflow', 'function f(n) { return f(n + 1); }\nf(0);');
add('console levels', 'console.log(1, "a", [1, {b: 2}], null, undefined);\nconsole.warn("w");\nconsole.error("e");\nconsole.info({x: [1]});');
add('try/catch host error', 'let r = 0;\ntry {\n  r = 1;\n  null.foo;\n  r = 2;\n} catch (e) {\n  r = 3;\n}\nr;');
add('class', 'class A { constructor(x) { this.x = x; } get2() { return this.x * 2; } }\nclass B extends A { constructor() { super(5); this.y = [1]; } }\nconst b = new B();\nb.get2();');
add('promise/async', 'async function f() { return 1; }\nasync function g() { const v = await f(); return v + 1; }\ng();');
add('closure/for-let', 'const fs = [];\nfor (let i = 0; i < 3; i++) { fs.push(() => i); }\nfs.map(f => f());');
add('sort with guest fn', 'const xs = [3, 1, 2];\nxs.sort((a, b) => a - b);\nxs.map(x => x * 2).filter(x => x > 2);');
add('syntax error', 'let = ;');
add('dom mode', 'const b = document.createElement("button");\nb.id = "btn";\nlet n = 0;\nb.addEventListener("click", () => { n++; });\ndocument.body.appendChild(b);',
  { dom: true, events: [{ type: 'click', target: '#btn' }, { type: 'click', target: '#btn' }] });

// ── 比較 ───────────────────────────────────────────────────────────────────
/** 循環・関数・Symbol・undefined を含む値を、比較用の安定した文字列にする */
function stable(v, depth = 0, path = new WeakSet()) {
  if (v === undefined) return '⟨undefined⟩';
  if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v) ?? String(v);
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'symbol') return `⟨${String(v)}⟩`;
  if (typeof v === 'function') return `⟨fn ${v.name}⟩`;
  if (depth > 12) return '⟨deep⟩';
  if (path.has(v)) return '⟨cycle⟩';
  if (v.__type__ === 'JSFunction') return `⟨JSFunction ${v.name}/${v.params?.length}⟩`;
  if (v.__type__ === 'JSClass') return `⟨JSClass ${v.name}⟩`;
  path.add(v);
  let out;
  if (Array.isArray(v)) out = `[${v.map(x => stable(x, depth + 1, path)).join(',')}]`;
  else if (v instanceof Map || v instanceof Set) out = `⟨${v.constructor.name} ${v.size}⟩`;
  else {
    const proto = Object.getPrototypeOf(v);
    const tag = proto && proto !== Object.prototype ? `${proto.constructor?.name ?? '?'}` : '';
    out = `${tag}{${Object.keys(v).sort().map(k => `${k}:${stable(v[k], depth + 1, path)}`).join(',')}}`;
  }
  path.delete(v);
  return out;
}

function run(mod, { code, options }) {
  try {
    const dbg = new mod.JSDebugger(code, { maxSteps: 100_000, ...options });
    return {
      ok: true,
      trace: dbg.trace,
      logs: dbg.consoleLogs,
      human: [...dbg._getHumanIndices()].sort((a, b) => a - b),
      result: dbg.getResult(),
      fromTraceIsJSDebugger: mod.JSDebugger.fromTrace(code, dbg.trace, dbg.ast, dbg.consoleLogs) instanceof mod.JSDebugger,
    };
  } catch (e) {
    return {
      ok: false, name: e.name, message: e.message,
      trace: e.partialTrace ?? [], logs: e.partialConsoleLogs ?? [],
      isExecutionError: e instanceof mod.ExecutionError,
    };
  }
}

const quiet = console.log; const quietWarn = console.warn; const quietErr = console.error;
let failures = 0, events = 0;
for (const p of programs) {
  console.log = console.warn = console.error = () => {};   // 評価中の console 出力（echo）を抑える
  const a = run(oldMod, p), b = run(newMod, p);
  console.log = quiet; console.warn = quietWarn; console.error = quietErr;
  const diffs = [];
  for (const k of ['ok', 'name', 'message', 'isExecutionError', 'fromTraceIsJSDebugger']) {
    if (a[k] !== b[k]) diffs.push(`${k}: ${a[k]} ≠ ${b[k]}`);
  }
  // スタックオーバーフローで止まる深さは実行ごとに変わる（JSInterpreter ADR-014）ので、
  // 両方が同じエラーで止まった場合は、共通の長さまでの一致だけを確かめる
  const overflow = !a.ok && !b.ok && a.message === b.message && /深くなりすぎた/.test(a.message);
  const n = overflow ? Math.min(a.trace.length, b.trace.length) : a.trace.length;
  if (!overflow && a.trace.length !== b.trace.length) diffs.push(`trace.length: ${a.trace.length} ≠ ${b.trace.length}`);
  else {
    for (let i = 0; i < n; i++) {
      // 止まった位置の違いで、範囲の外（トレースの末尾）を指す matchIdx も変わるので同一視する
      const norm = (ev) => (overflow && ev.matchIdx >= n ? { ...ev, matchIdx: '⟨beyond⟩' } : ev);
      const sa = stable(norm(a.trace[i])), sb = stable(norm(b.trace[i]));
      if (sa !== sb) { diffs.push(`trace[${i}] (${a.trace[i].phase} ${a.trace[i].nodeType}) が違う`); break; }
    }
  }
  events += a.trace.length;
  if (!overflow && stable(a.logs) !== stable(b.logs)) diffs.push('consoleLogs が違う');
  if (!overflow && stable(a.human) !== stable(b.human)) diffs.push('humanStep の停止点が違う');
  if (stable(a.result) !== stable(b.result)) diffs.push('getResult() が違う');
  if (diffs.length) { failures++; console.log(`✗ ${p.name}\n    ${diffs.join('\n    ')}`); }
}
console.log(`\n${programs.length} プログラム（${events.toLocaleString()} イベント）を比較：${failures === 0 ? 'すべて一致' : `${failures} 件で不一致`}`);
console.log(`  旧: ${OLD}\n  新: ${NEW}`);
process.exit(failures === 0 ? 0 : 1);
