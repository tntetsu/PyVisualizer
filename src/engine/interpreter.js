/**
 * interpreter.js — Python 評価器（Phase 0 スパイク）
 *
 * JSInterpreter の共通コア（js-interpreter/core：Recorder・制御シグナル・Scope・クローン）を使い、
 * Python の意味論（スコープ・演算・真偽・反復）だけをここで実装する。
 * 対象範囲は docs/development-plan.md 4.1 節の MVP のうち、スパイクで確かめたい部分。
 */
import {
  Recorder, Scope, createCloner, ReturnSignal, BreakSignal, ContinueSignal, ThrowSignal,
} from 'js-interpreter/core';
import {
  PyError, PyRange, makeFloat, makeTuple, makeDict, dictSet, dictGet, dictDelete, dictEntries, dictHas, intOp, normInt, big,
  makeSet, setAdd, setHas, isSet, isSeq, NOT_IMPLEMENTED,
  isFloat, isInt, isBool, isNum, isStr, isTuple, isList, isDict, num, typeName,
  truthy, repr, str, pyEq, pyCmp, richCompare, iterate, contains, pyCloneHook, PyTraceback,
} from './values.js';
import { BUILTINS, getAttr, setAttr, delAttr, formatValue, percentFormat } from './builtins.js';
import {
  PyClass, ObjectClass, isClass, isInstance, isExceptionClass, isException, makeInstance, makeException,
  classLookup, PyRaise, toPyException, setInvoker, EXCEPTIONS, callSpecial,
} from './objects.js';
import { importModule } from './modules.js';

const MAX_RECURSION = 1000;

/** スナップショット用のクローン（tuple の印を保つ） */
export const cloneValue = createCloner(pyCloneHook);

/** Python 用の Recorder：値のクローンに cloneValue を使う。print は recorder.write() で出力の断片として記録する */
export function createRecorder(maxSteps = 0) {
  return new Recorder(maxSteps, { clone: cloneValue });
}

/** Python のスコープ（関数の呼び出しごと・モジュール）。pyScope に静的に集めたローカル・global・nonlocal を持つ */
export class PyScope extends Scope {
  constructor(parent = null, kind = 'function', pyScope = null) {
    super(parent, kind);
    this.pyScope = pyScope;
  }
}

// ── スコープ ──────────────────────────────────────────────────────────────────

/** 関数本体で代入される名前（ローカル）と global/nonlocal 宣言を静的に集める */
function analyzeScope(fnNode) {
  const locals = new Set(), globals = new Set(), nonlocals = new Set();
  const addTarget = (t) => {
    if (!t) return;
    if (t.type === 'Identifier') locals.add(t.name);
    else if (t.type === 'SpreadElement') addTarget(t.argument);
    else if (t.type === 'TupleExpression' || t.type === 'ArrayExpression') t.elements.forEach(addTarget);
  };
  // 内包表記の中の n := … は、内包表記を含む関数のローカル（PEP 572）
  const walrusIn = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walrusIn); return; }
    if (n.type === 'NamedExpression') locals.add(n.target.name);
    if (n.type === 'FunctionDeclaration' || n.type === 'ArrowFunctionExpression') return;
    for (const k of Object.keys(n)) if (k !== 'loc' && k !== 'end' && k !== 'range' && k !== 'pyScope') walrusIn(n[k]);
  };
  for (const p of fnNode.params) { const name = paramName(p); if (name) locals.add(name); }
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    switch (n.type) {
      case 'FunctionDeclaration': locals.add(n.id.name); n.params.forEach(p => p.type === 'AssignmentPattern' && walk(p.right)); return;
      case 'ArrowFunctionExpression': n.params.forEach(p => p.type === 'AssignmentPattern' && walk(p.right)); return;
      case 'GlobalStatement': {
        const set = n.kind === 'global' ? globals : nonlocals;
        n.names.forEach(x => set.add(x));
        return;
      }
      case 'AssignmentExpression':
        for (const t of [n.left, ...(n.extraTargets ?? [])]) { addTarget(t); if (t.type !== 'Identifier') walk(t); }
        walk(n.right);
        return;
      case 'ForOfStatement': addTarget(n.left); walk(n.right); walk(n.body); walk(n.orelse); return;
      case 'NamedExpression': locals.add(n.target.name); walk(n.value); return;
      case 'WithStatement': for (const it of n.items) { walk(it.context); addTarget(it.target); } walk(n.body); return;
      case 'MatchCase': patternNames(n.pattern).forEach(x => locals.add(x)); walk(n.guard); walk(n.body); return;
      case 'EmptyStatement': if (n.annotated) locals.add(n.annotated); return;   // 関数の中の「x: int」（ADR-011）
      case 'DeleteStatement': n.targets.forEach(t => (t.type === 'Identifier' ? locals.add(t.name) : walk(t))); return;
      case 'ExceptHandler': if (n.name) locals.add(n.name); walk(n.exType); walk(n.body); return;
      case 'ImportStatement': n.names.forEach(x => locals.add(x.alias ?? x.name)); return;
      case 'ImportFromStatement': n.names.forEach(x => locals.add(x.alias ?? x.name)); return;
      // クラスの名前はローカル。クラスの本体は別のスコープなので、基底クラスの式だけを見る
      case 'ClassDeclaration': locals.add(n.id.name); walk(n.bases); return;
      // 内包表記は自分のスコープを持つ。外側のスコープで評価されるのは最初の iter だけ
      case 'ListComprehension': case 'SetComprehension': case 'DictComprehension': case 'GeneratorExpression':
        walk(n.generators[0].iter); walrusIn(n); return;
    }
    for (const k of Object.keys(n)) if (k !== 'loc' && k !== 'end' && k !== 'range') walk(n[k]);
  };
  walk(fnNode.expression ? fnNode.body : fnNode.body.body);
  for (const g of [...globals, ...nonlocals]) locals.delete(g);
  return { locals, globals, nonlocals };
}

const rootOf = (env) => { let e = env; while (e.parent) e = e.parent; return e; };

function lookupGlobal(name, env, loc) {
  const root = rootOf(env);
  if (root.bindings.has(name)) return root.bindings.get(name);
  if (Object.prototype.hasOwnProperty.call(BUILTINS, name)) return BUILTINS[name];
  throw new PyError('NameError', `'${name}' という名前は定義されていません`, loc);
}

function lookup(name, env, loc) {
  const scope = env.pyScope;
  if (!scope) return lookupGlobal(name, env, loc);
  if (scope.globals.has(name)) return lookupGlobal(name, env, loc);
  if (scope.locals.has(name)) {
    if (env.bindings.has(name)) return env.bindings.get(name);
    // クラスの本体では、まだ代入していない名前は外側（グローバル・組み込み）を探す
    if (env.kind !== 'class') throw new PyError('UnboundLocalError', `ローカル変数 '${name}' に値を入れる前に使っています`, loc);
  }
  for (let e = env.parent; e && e.pyScope; e = e.parent) {
    if (e.bindings.has(name)) return e.bindings.get(name);
  }
  return lookupGlobal(name, env, loc);
}

function assignName(name, value, env, loc) {
  const scope = env.pyScope;
  if (scope?.globals.has(name)) { rootOf(env).bindings.set(name, value); return; }
  if (scope?.nonlocals.has(name)) {
    for (let e = env.parent; e && e.pyScope; e = e.parent) {
      if (e.bindings.has(name)) { e.bindings.set(name, value); return; }
    }
    throw new PyError('SyntaxError', `nonlocal '${name}' に対応する外側の変数がありません`, loc);
  }
  env.bindings.set(name, value);
}

// ── 演算 ──────────────────────────────────────────────────────────────────────

const zeroDiv = (loc) => new PyError('ZeroDivisionError', '0 で割ることはできません', loc);

/** float を含む演算：JS の number で計算して float にする */
const fl = (a, b, f) => makeFloat(f(num(a), num(b)));
/** int（bool を含む）どうしか */
const bothInt = (a, b) => (isInt(a) || isBool(a)) && (isInt(b) || isBool(b));
const isZero = (v) => num(v) === 0;

const OP_METHODS = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'truediv', '//': 'floordiv', '%': 'mod', '**': 'pow' };

export function binop(op, a, b, loc) {
  if ((isInstance(a) || isInstance(b)) && OP_METHODS[op]) {
    const r = callSpecial(a, `__${OP_METHODS[op]}__`, [b]);
    if (r !== undefined && r !== NOT_IMPLEMENTED) return r;
    const rr = callSpecial(b, `__r${OP_METHODS[op]}__`, [a]);
    if (rr !== undefined && rr !== NOT_IMPLEMENTED) return rr;
  }
  const nums = isNum(a) && isNum(b);
  const ints = bothInt(a, b);
  switch (op) {
    case '+':
      if (ints) return intOp('+', a, b);
      if (nums) return fl(a, b, (x, y) => x + y);
      if (isStr(a) && isStr(b)) return a + b;
      if (isList(a) && isList(b)) return [...a, ...b];
      if (isTuple(a) && isTuple(b)) return makeTuple([...a, ...b]);
      break;
    case '-':
      if (isSet(a) && isSet(b)) return makeSet(a.filter(x => !setHas(b, x)));
      if (ints) return intOp('-', a, b);
      if (nums) return fl(a, b, (x, y) => x - y);
      break;
    case '*':
      if (ints) return intOp('*', a, b);
      if (nums) return fl(a, b, (x, y) => x * y);
      for (const [s, n] of [[a, b], [b, a]]) {
        if ((isInt(n) || isBool(n)) && (isStr(s) || isSeq(s))) {
          const k = Math.max(0, num(n));
          if (isStr(s)) return s.repeat(k);
          const out = [];
          for (let i = 0; i < k; i++) out.push(...s);
          return isTuple(s) ? makeTuple(out) : out;
        }
      }
      break;
    case '/':
      if (nums) {
        if (isZero(b)) throw zeroDiv(loc);
        // int どうしの割り算は、大きな整数でも正確な商に近い値になるよう BigInt で割ってから小数部を足す
        if (ints && (typeof a === 'bigint' || typeof b === 'bigint')) {
          const A = big(a), B = big(b), q = A / B;
          return makeFloat(Number(q) + Number(A - q * B) / Number(B));
        }
        return makeFloat(num(a) / num(b));
      }
      break;
    case '//':
      if (nums) {
        if (isZero(b)) throw zeroDiv(loc);
        return ints ? intOp('//', a, b) : fl(a, b, (x, y) => Math.floor(x / y));
      }
      break;
    case '%':
      if (isStr(a)) return percentFormat(a, b, loc);
      if (nums) {
        if (isZero(b)) throw zeroDiv(loc);
        return ints ? intOp('%', a, b) : fl(a, b, (x, y) => x - y * Math.floor(x / y));
      }
      break;
    case '**':
      if (nums) {
        if (isZero(a) && num(b) < 0) throw zeroDiv(loc);
        if (ints) return num(b) < 0 ? makeFloat(num(a) ** num(b)) : intOp('**', a, b);
        return fl(a, b, (x, y) => x ** y);
      }
      break;
    case '&': case '|': case '^': case '<<': case '>>':
      if (isSet(a) && isSet(b) && op !== '<<' && op !== '>>') {
        if (op === '|') return makeSet([...a, ...b]);
        if (op === '&') return makeSet(a.filter(x => setHas(b, x)));
        return makeSet([...a.filter(x => !setHas(b, x)), ...b.filter(x => !setHas(a, x))]);
      }
      if (ints) {
        if ((op === '<<' || op === '>>') && num(b) < 0) throw new PyError('ValueError', 'シフトする量に負の数は使えません', loc);
        return intOp(op, a, b);
      }
      break;
  }
  throw new PyError('TypeError', `「${op}」は ${typeName(a)} と ${typeName(b)} の組み合わせには使えません`, loc);
}

function compare(op, a, b, loc) {
  switch (op) {
    case '==': return pyEq(a, b);
    case '!=': return !pyEq(a, b);
    case '<': case '>': case '<=': case '>=':
      if (isSet(a) && isSet(b)) {
        const sub = (x, y) => x.every(e => setHas(y, e));
        return { '<': sub(a, b) && a.length < b.length, '<=': sub(a, b), '>': sub(b, a) && b.length < a.length, '>=': sub(b, a) }[op];
      }
      break;
  }
  switch (op) {
    case '<': case '>': case '<=': case '>=': return richCompare(a, b, op, loc);
    case 'in':     return contains(b, a, loc);
    case 'not in': return !contains(b, a, loc);
    case 'is':     return a === b || (a == null && b == null);
    case 'is not': return !(a === b || (a == null && b == null));
  }
  throw new PyError('SyntaxError', `未知の比較演算子 ${op}`, loc);
}

// ── 添字・スライス ────────────────────────────────────────────────────────────

/** @param {boolean} [assign] 代入・削除の添字か（範囲外のメッセージを CPython の list assignment index out of range に対応させる） */
function normIndex(seq, key, loc, assign = false) {
  if (!(isInt(key) || isBool(key))) {
    throw new PyError('TypeError', `${typeName(seq)} の添字は整数でなければなりません（${typeName(key)} が指定されました）`, loc);
  }
  const n = seq instanceof PyRange ? seq.length : seq.length;
  const i = num(key) < 0 ? num(key) + n : num(key);
  if (i < 0 || i >= n) {
    throw new PyError('IndexError', assign
      ? `${typeName(seq)} の範囲外の位置 ${num(key)} は変更・削除できません（長さ ${n}）`
      : `${typeName(seq)} の範囲外の位置 ${num(key)} を指定しています（長さ ${n}）`, loc);
  }
  return i;
}

export function getItem(obj, key, loc) {
  if (isDict(obj)) return dictGet(obj, key, loc);
  if (obj instanceof PyRange) return obj.at(normIndex(obj, key, loc));
  if (isStr(obj) || isSeq(obj)) return obj[normIndex(obj, key, loc)];
  throw new PyError('TypeError', `${typeName(obj)} には [ ] で添字を付けられません`, loc);
}

function setItem(obj, key, value, loc) {
  if (isDict(obj)) { dictSet(obj, key, value, loc); return; }
  if (isList(obj)) { obj[normIndex(obj, key, loc, true)] = value; return; }
  throw new PyError('TypeError', `${typeName(obj)} の要素は変更できません`, loc);
}

function sliceIndices(len, lo, hi, st, loc) {
  const step = st ?? 1;
  if (step === 0) throw new PyError('ValueError', 'スライスの step に 0 は使えません', loc);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const adj = (v) => (v < 0 ? v + len : v);
  let start, stop;
  if (step > 0) {
    start = lo == null ? 0 : clamp(adj(lo), 0, len);
    stop = hi == null ? len : clamp(adj(hi), 0, len);
  } else {
    start = lo == null ? len - 1 : clamp(adj(lo), -1, len - 1);
    stop = hi == null ? -1 : clamp(adj(hi), -1, len - 1);
  }
  const out = [];
  for (let i = start; step > 0 ? i < stop : i > stop; i += step) out.push(i);
  return out;
}

function getSlice(obj, lo, hi, st, loc) {
  const ints = [lo, hi, st].map(v => (v === null || v === undefined ? null : num(v)));
  if (isStr(obj)) return sliceIndices(obj.length, ...ints, loc).map(i => obj[i]).join('');
  if (isSeq(obj)) {
    const out = sliceIndices(obj.length, ...ints, loc).map(i => obj[i]);
    return isTuple(obj) ? makeTuple(out) : out;
  }
  throw new PyError('TypeError', `${typeName(obj)} はスライスできません`, loc);
}

// ── 関数 ──────────────────────────────────────────────────────────────────────

/** 引数の名前（KwOnlyMarker は null） */
function paramName(p) {
  switch (p.type) {
    case 'Identifier': return p.name;
    case 'AssignmentPattern': return p.left.name;
    case 'RestElement': case 'KeywordRestElement': return p.argument.name;
  }
  return null;
}

function makeFunction(node, env, rt, depth, callDepth) {
  if (!node.pyScope) node.pyScope = analyzeScope(node);
  // 引数の仕様：pos（位置・キーワードどちらでも）・rest（*args）・kwonly（* の後ろ）・kwrest（**kwargs）。
  // デフォルト引数は def の時点で 1 回だけ評価する（Python の意味論）
  const spec = [];
  let afterStar = false;
  for (const p of node.params) {
    if (p.type === 'KwOnlyMarker') { afterStar = true; continue; }
    if (p.type === 'RestElement') { spec.push({ name: p.argument.name, kind: 'rest' }); afterStar = true; continue; }
    if (p.type === 'KeywordRestElement') { spec.push({ name: p.argument.name, kind: 'kwrest' }); continue; }
    spec.push({
      name: paramName(p), kind: afterStar ? 'kwonly' : 'pos',
      default: p.type === 'AssignmentPattern' ? evaluate(p.right, env, rt, depth, callDepth) : undefined,
    });
  }
  return {
    __type__: 'JSFunction',
    name: node.id ? node.id.name : '<lambda>',
    params: node.params,
    paramSpec: spec,
    body: node.body,
    expression: !!node.expression,
    isLambda: !!node.isLambda,
    closure: env.kind === 'class' ? env.parent : env,
    classEnv: env.kind === 'class' ? env : null,   // クラスができたら ownerClass を決める（super() のため）
    scope: node.pyScope,
  };
}

/**
 * 引数を束縛する。戻り値は引数の宣言順の値（コールスタックの表示用）。
 * 位置引数 → pos、余りは rest（なければ TypeError）。キーワード引数 → pos・kwonly、余りは kwrest（なければ TypeError）。
 */
function bindArgs(fn, args, kwargs, env, loc) {
  const spec = fn.paramSpec;
  const fname = fn.qualName ?? fn.name;   // メッセージに使う名前（メソッドは A.f）
  const vals = new Map();
  const pos = spec.filter(p => p.kind === 'pos');
  const rest = spec.find(p => p.kind === 'rest');
  const kwrest = spec.find(p => p.kind === 'kwrest');
  args.slice(0, pos.length).forEach((a, i) => vals.set(pos[i].name, a));
  if (args.length > pos.length) {
    if (!rest) throw new PyError('TypeError', `${fname}() の位置引数は ${pos.length} 個までですが、${args.length} 個渡されました`, loc);
  }
  if (rest) vals.set(rest.name, makeTuple(args.slice(pos.length)));
  const extra = makeDict();
  for (const [k, v] of Object.entries(kwargs)) {
    const p = spec.find(q => q.name === k && (q.kind === 'pos' || q.kind === 'kwonly'));
    if (!p) {
      if (!kwrest) throw new PyError('TypeError', `${fname}() に ${k} という名前の引数はありません`, loc);
      dictSet(extra, k, v, loc);
      continue;
    }
    if (vals.has(p.name)) throw new PyError('TypeError', `${fname}() の引数 ${k} が 2 回指定されています`, loc);
    vals.set(p.name, v);
  }
  if (kwrest) vals.set(kwrest.name, extra);
  // 変数は CPython と同じ順（位置引数 → キーワード専用引数 → *args → **kwargs）で作る（変数のビューの列の順になる）
  const order = { pos: 0, kwonly: 1, rest: 2, kwrest: 3 };
  for (const p of [...spec].sort((x, y) => order[x.kind] - order[y.kind])) {
    if (!vals.has(p.name)) {
      if (p.default === undefined) {
        throw new PyError('TypeError', `${fname}() の${p.kind === 'kwonly' ? 'キーワード専用' : ''}引数 '${p.name}' が渡されていません`, loc);
      }
      vals.set(p.name, p.default);
    }
    env.bindings.set(p.name, vals.get(p.name));
  }
  return spec.map(p => vals.get(p.name));
}

export function callFunction(callee, args, kwargs, rt, depth, callDepth, loc, env = null) {
  if (typeof callee === 'function') {
    return callee(args, kwargs, {
      rt, loc, env,
      call: (fn, a, kw = {}) => callFunction(fn, a, kw, rt, depth, callDepth, loc, env),
      binop: (op, a, b) => binop(op, a, b, loc),   // divmod・pow が演算子と同じ規則で計算するため
    });
  }
  if (isClass(callee)) return instantiate(callee, args, kwargs, rt, depth, callDepth, loc, env);
  if (!callee || callee.__type__ !== 'JSFunction') {
    throw new PyError('TypeError', `${typeName(callee)} は関数ではないので呼び出せません`, loc);
  }
  if (callDepth + 1 > MAX_RECURSION) {
    throw new PyError('RecursionError', `関数の呼び出しが ${MAX_RECURSION} 段を超えました（再帰が止まっていない可能性があります）`, loc);
  }
  const fenv = new PyScope(callee.closure, 'function', callee.scope);
  fenv.fn = callee;   // super() が、実行中の関数（定義したクラス）と self を知るため
  const vals = bindArgs(callee, args, kwargs, fenv, loc);
  const recorder = rt.recorder;
  if (recorder) {
    // callId：呼び出しごとの番号。組み込み関数から同じ深さで続けて呼ばれる場合（sorted の key など）も区別できる
    rt.callCount = (rt.callCount ?? 0) + 1;
    recorder.pushFrame({
      name: callee.name, loc: loc || { line: 0, column: 0 }, args: vals.map(a => cloneValue(a)), callId: rt.callCount,
    }, fenv);
  }
  let result;
  try {
    result = evaluate(callee.body, fenv, rt, depth, callDepth + 1);
  } finally {
    if (recorder) recorder.popFrame();
  }
  if (callee.expression) return result;
  if (result instanceof ReturnSignal) return result.value;
  if (result instanceof ThrowSignal) return result;
  return null;
}

/**
 * 特殊メソッド（__str__・__eq__ など）を values.js から呼べるようにする（実行の開始時に呼ぶ）。
 * 呼び出しの深さは、記録中のコールスタックの長さ（ユーザー定義の関数の呼び出しの数）から求める。
 */
export function installInvoker(rt) {
  setInvoker((fn, args) => {
    const rec = rt.recorder;
    const callDepth = rec ? rec.callStack.length : 0;
    const last = rec?.trace[rec.trace.length - 1];
    const depth = last ? last.depth + 1 : 0;
    const r = callFunction(fn, args, {}, rt, depth, callDepth, last?.loc);
    if (r instanceof ThrowSignal) throw r.value;
    return r;
  });
}

/** クラスを呼んでインスタンスを作る（__init__ があれば呼ぶ） */
function instantiate(cls, args, kwargs, rt, depth, callDepth, loc, env) {
  const inst = isExceptionClass(cls) ? makeException(cls, args) : makeInstance(cls);
  const init = classLookup(cls, '__init__');
  if (init !== undefined) {
    const r = callFunction(init, [inst, ...args], kwargs, rt, depth, callDepth, loc, env);
    if (r !== null && r !== undefined) throw new PyError('TypeError', '__init__() は None を返さなければなりません', loc);
  } else if (args.length || Object.keys(kwargs).length) {
    throw new PyError('TypeError', `${cls.name}() は引数を受け取りません`, loc);
  }
  return inst;
}

/** 例外を送出する（JS の例外 PyRaise として投げる） */
function raise(exc, loc) {
  const text = str(exc);
  throw new PyRaise(exc, loc, `${exc.cls.name}${text ? `: ${text}` : ''}${loc ? `（${loc.line}行目）` : ''}`);
}

/**
 * try の本体で例外が起きたあと、トレースを整える（JSInterpreter の _trimFailedTryBlock と同じ方式）。
 * 例外で中断した評価は exit を持たない enter（matchIdx === -1）を残すので、
 * ① 末尾の、完了した子を持たない enter を除き、② 残った enter の matchIdx を except の先頭（trace.length）にする。
 */
function trimFailedTry(trace, start) {
  if (trace.length <= start) return;
  let tail = trace.length - 1;
  while (tail >= start && trace[tail].matchIdx === -1) tail--;
  trace.length = tail + 1;
  for (let j = start; j < trace.length; j++) if (trace[j].matchIdx === -1) trace[j].matchIdx = trace.length;
}

/** except 節の型に例外が当てはまるか（型は例外のクラスか、そのタプル） */
function exceptMatches(t, exc, loc) {
  if (isTuple(t)) return t.some(x => exceptMatches(x, exc, loc));
  if (!isExceptionClass(t)) throw new PyError('TypeError', 'except の後ろには例外のクラスを書きます', loc);
  return exc.cls.mro.includes(t);
}

// ── with・match（ADR-012） ─────────────────────────────────────────────────────

/** with の items[i] 以降を実行する（複数の項目は入れ子の with と同じ） */
function runWith(node, i, env, rt, d, callDepth) {
  if (i === node.items.length) return evaluate(node.body, env, rt, d, callDepth);
  const item = node.items[i];
  const mgr = evaluate(item.context, env, rt, d, callDepth);
  if (!isInstance(mgr) || classLookup(mgr.cls, '__enter__') === undefined || classLookup(mgr.cls, '__exit__') === undefined) {
    throw new PyError('TypeError', `${typeName(mgr)} は with で使えません（__enter__ と __exit__ がありません）`, item.loc);
  }
  const value = callSpecial(mgr, '__enter__');
  if (item.target) {
    // as の代入を WithBinding として記録する（「人」のステップが止まる）
    const binding = { type: 'WithBinding', loc: item.loc, end: item.end };
    const bind = () => { assignTarget(item.target, value, env, rt, d, callDepth); return value; };
    if (rt.recorder) rt.recorder.record(binding, env, d, callDepth, bind); else bind();
  }
  let r;
  try {
    r = runWith(node, i + 1, env, rt, d, callDepth);
  } catch (err) {
    const exc = toPyException(err);
    if (!exc) throw err;
    // __exit__ が真を返したら、例外をここで止める
    if (truthy(callSpecial(mgr, '__exit__', [exc.cls, exc, new PyTraceback()]))) return undefined;
    throw err;
  }
  callSpecial(mgr, '__exit__', [null, null, null]);
  return r;
}

/** パターンが取り込む名前 */
function patternNames(p) {
  switch (p?.type) {
    case 'CapturePattern': return [p.name];
    case 'StarPattern': return p.name ? [p.name] : [];
    case 'AsPattern': return [...patternNames(p.pattern), p.name];
    case 'OrPattern': return p.patterns.flatMap(patternNames);
    case 'SequencePattern': return p.elements.flatMap(patternNames);
    case 'MappingPattern': return [...p.values.flatMap(patternNames), ...(p.rest ? [p.rest] : [])];
    case 'ClassPattern': return [...p.args.flatMap(patternNames), ...p.keywords.flatMap(k => patternNames(k.pattern))];
    default: return [];
  }
}

/** 組み込みの型で、クラスのパターンの位置引数 1 つが値そのものに当てはまるもの（str(x)・int(n) など） */
const SELF_MATCH_TYPES = new Set(['bool', 'int', 'float', 'str', 'list', 'tuple', 'dict', 'set']);

/** subject がパターン p に当てはまるか。当てはまれば、取り込んだ名前と値を binds に入れる */
function matchPattern(p, v, binds, env, rt, d, callDepth) {
  const ev = (n) => evaluate(n, env, rt, d, callDepth);
  switch (p.type) {
    case 'WildcardPattern': return true;
    case 'CapturePattern': binds.set(p.name, v); return true;
    case 'LiteralPattern': {
      const lit = ev(p.value);
      // None・True・False は is で比べる（1 は case True: に当てはまらない）
      return lit === null || typeof lit === 'boolean' ? v === lit : pyEq(v, lit);
    }
    case 'ValuePattern': return pyEq(v, ev(p.value));
    case 'AsPattern': {
      if (!matchPattern(p.pattern, v, binds, env, rt, d, callDepth)) return false;
      binds.set(p.name, v);
      return true;
    }
    case 'OrPattern':
      for (const alt of p.patterns) {
        const b = new Map(binds);
        if (matchPattern(alt, v, b, env, rt, d, callDepth)) { for (const [k, x] of b) binds.set(k, x); return true; }
      }
      return false;
    case 'SequencePattern': {
      // 文字列・辞書・集合は並びのパターンに当てはまらない（CPython と同じ）
      if (!(isList(v) || isTuple(v) || v instanceof PyRange)) return false;
      const items = [...iterate(v, p.loc)];
      const star = p.elements.findIndex(e => e.type === 'StarPattern');
      if (star < 0 ? items.length !== p.elements.length : items.length < p.elements.length - 1) return false;
      const after = p.elements.length - star - 1;
      return p.elements.every((e, i) => {
        if (e.type === 'StarPattern') { if (e.name) binds.set(e.name, items.slice(star, items.length - after)); return true; }
        const x = star < 0 || i < star ? items[i] : items[items.length - (p.elements.length - i)];
        return matchPattern(e, x, binds, env, rt, d, callDepth);
      });
    }
    case 'MappingPattern': {
      if (!isDict(v)) return false;
      const used = [];
      for (let i = 0; i < p.keys.length; i++) {
        const k = ev(p.keys[i].value);
        if (!dictHas(v, k, p.loc)) return false;
        used.push(k);
        if (!matchPattern(p.values[i], dictGet(v, k, p.loc), binds, env, rt, d, callDepth)) return false;
      }
      if (p.rest) binds.set(p.rest, makeDict(dictEntries(v).filter(([k]) => !used.some(u => pyEq(u, k)))));
      return true;
    }
    case 'ClassPattern': {
      const cls = ev(p.cls);
      if (!truthy(BUILTINS.isinstance([v, cls], {}, { loc: p.loc }))) return false;
      if (p.args.length) {
        if (typeof cls === 'function' && SELF_MATCH_TYPES.has(cls.pyName)) {
          if (p.args.length > 1) throw new PyError('TypeError', `${cls.pyName}() のパターンの位置引数は 1 つまでです`, p.loc);
          if (!matchPattern(p.args[0], v, binds, env, rt, d, callDepth)) return false;
        } else {
          const names = isClass(cls) ? classLookup(cls, '__match_args__') : undefined;
          if (!isTuple(names) || names.length < p.args.length) {
            throw new PyError('TypeError', `${isClass(cls) ? cls.name : typeName(cls)}() のパターンに位置引数を使うには __match_args__ が必要です`, p.loc);
          }
          for (let i = 0; i < p.args.length; i++) {
            if (!matchAttr(v, names[i], p.args[i], binds, env, rt, d, callDepth)) return false;
          }
        }
      }
      return p.keywords.every(k => matchAttr(v, k.name, k.pattern, binds, env, rt, d, callDepth));
    }
  }
  throw new PyError('NotImplemented', `${p.type} はまだ評価できません`, p.loc);
}

/** クラスのパターンの属性 name が pattern に当てはまるか（属性がなければ当てはまらない） */
function matchAttr(v, name, pattern, binds, env, rt, d, callDepth) {
  let x;
  try { x = getAttr(v, name, pattern.loc); } catch (err) { if (err instanceof PyError && err.pyType === 'AttributeError') return false; throw err; }
  return matchPattern(pattern, x, binds, env, rt, d, callDepth);
}

/** 並びの要素を評価する。*xs は中身を展開する（[*a, 1]。ADR-011） */
function spreadElements(elements, ev) {
  const out = [];
  for (const e of elements) {
    if (e.type === 'SpreadElement') out.push(...iterate(ev(e.argument), e.loc));
    else out.push(ev(e));
  }
  return out;
}

// ── 代入 ──────────────────────────────────────────────────────────────────────

function unpack(value, n, loc) {
  const items = [...iterate(value, loc)];
  if (items.length !== n) {
    throw new PyError('ValueError', items.length > n
      ? `値が多すぎて ${n} 個の変数に分けられません（${items.length} 個）`
      : `値が足りず ${n} 個の変数に分けられません（${items.length} 個）`, loc);
  }
  return items;
}

/** a, *b, c = value：* の付いた代入先が残りをリストで受け取る（ADR-011） */
function unpackStar(value, elements, star, loc) {
  const items = [...iterate(value, loc)];
  const fixed = elements.length - 1;
  if (items.length < fixed) {
    throw new PyError('ValueError', `値が足りず 少なくとも ${fixed} 個の変数に分けられません（${items.length} 個）`, loc);
  }
  const after = elements.length - star - 1;
  return [...items.slice(0, star), items.slice(star, items.length - after), ...items.slice(items.length - after)];
}

function assignTarget(target, value, env, rt, d, callDepth) {
  switch (target.type) {
    case 'Identifier': assignName(target.name, value, env, target.loc); return;
    case 'TupleExpression':
    case 'ArrayExpression': {
      const star = target.elements.findIndex(t => t.type === 'SpreadElement');
      const items = star < 0 ? unpack(value, target.elements.length, target.loc) : unpackStar(value, target.elements, star, target.loc);
      target.elements.forEach((t, i) => assignTarget(t.type === 'SpreadElement' ? t.argument : t, items[i], env, rt, d, callDepth));
      return;
    }
    case 'MemberExpression': {
      if (!target.computed) {
        setAttr(evaluate(target.object, env, rt, d, callDepth), target.property.name, value, target.loc);
        return;
      }
      if (target.property.type === 'SliceExpression') {
        const obj = evaluate(target.object, env, rt, d, callDepth);
        const p = target.property;
        const bounds = [p.lower, p.upper, p.step].map(x => (x ? num(evaluate(x, env, rt, d, callDepth)) : null));
        setSlice(obj, bounds, value, target.loc);
        return;
      }
      const obj = evaluate(target.object, env, rt, d, callDepth);
      const key = evaluate(target.property, env, rt, d, callDepth);
      setItem(obj, key, value, target.loc);
      return;
    }
  }
  throw new PyError('SyntaxError', 'ここには代入できません', target.loc);
}

/** obj[lo:hi:st] = value（list だけ）。step が 1 なら長さが変わってよい。拡張スライスは同じ長さのときだけ */
function setSlice(obj, [lo, hi, st], value, loc) {
  if (!isList(obj)) throw new PyError('TypeError', `${typeName(obj)} の要素は変更できません`, loc);
  const items = [...iterate(value, loc)];
  const idx = sliceIndices(obj.length, lo, hi, st, loc);
  if ((st ?? 1) === 1) {
    const start = idx.length ? idx[0] : Math.max(0, Math.min(obj.length, lo == null ? 0 : (lo < 0 ? lo + obj.length : lo)));
    obj.splice(start, idx.length, ...items);
    return;
  }
  if (idx.length !== items.length) {
    throw new PyError('ValueError', `長さ ${idx.length} の拡張スライスに、長さ ${items.length} の並びは代入できません`, loc);
  }
  idx.forEach((i, k) => { obj[i] = items[k]; });
}

/** del の対象を消す */
function deleteTarget(t, env, rt, d, callDepth) {
  if (t.type === 'Identifier') {
    const scope = env.pyScope;
    const home = scope?.globals.has(t.name) ? rootOf(env) : env;
    if (!home.bindings.has(t.name)) throw new PyError('NameError', `'${t.name}' という名前は定義されていません`, t.loc);
    home.bindings.delete(t.name);
    return;
  }
  const obj = evaluate(t.object, env, rt, d, callDepth);
  if (!t.computed) { delAttr(obj, t.property.name, t.loc); return; }
  if (t.property.type === 'SliceExpression') {
    if (!isList(obj)) throw new PyError('TypeError', `${typeName(obj)} の要素は消せません`, t.loc);
    const p = t.property;
    const bounds = [p.lower, p.upper, p.step].map(x => (x ? num(evaluate(x, env, rt, d, callDepth)) : null));
    const idx = new Set(sliceIndices(obj.length, ...bounds, t.loc));
    const keep = obj.filter((_, i) => !idx.has(i));
    obj.splice(0, obj.length, ...keep);
    return;
  }
  const key = evaluate(t.property, env, rt, d, callDepth);
  if (isDict(obj)) { dictDelete(obj, key, t.loc); return; }
  if (isList(obj)) { obj.splice(normIndex(obj, key, t.loc, true), 1); return; }
  throw new PyError('TypeError', `${typeName(obj)} の要素は消せません`, t.loc);
}

/**
 * 内包表記を評価する。内包表記ごとのスコープ（ループ変数が外に漏れない）を作り、
 * 最初の iter だけを外側のスコープで評価する。各回のループ変数への代入は LoopBinding として記録する。
 * emit(cenv) は、すべての for と if を通った組み合わせごとに呼ばれる。
 */
function comprehend(node, env, rt, d, callDepth, emit) {
  if (!node.pyScope) {
    const locals = new Set();
    const add = (t) => {
      if (t.type === 'Identifier') locals.add(t.name);
      else if (t.type === 'SpreadElement') add(t.argument);
      else if (t.type === 'TupleExpression' || t.type === 'ArrayExpression') t.elements.forEach(add);
    };
    node.generators.forEach(g => add(g.target));
    node.pyScope = { locals, globals: new Set(), nonlocals: new Set() };
  }
  const cenv = new PyScope(env, 'comprehension', node.pyScope);
  const loop = (gi) => {
    if (gi === node.generators.length) { emit(cenv); return; }
    const g = node.generators[gi];
    const iterable = evaluate(g.iter, gi === 0 ? env : cenv, rt, d, callDepth);
    const binding = { type: 'LoopBinding', loc: g.target.loc, end: g.target.end };
    for (const item of iterate(iterable, g.iter.loc)) {
      const bind = () => { assignTarget(g.target, item, cenv, rt, d + 1, callDepth); return item; };
      if (rt.recorder) rt.recorder.record(binding, cenv, d, callDepth, bind); else bind();
      if (g.ifs.every(c => truthy(evaluate(c, cenv, rt, d, callDepth)))) loop(gi + 1);
    }
  };
  loop(0);
}

// ── 評価 ──────────────────────────────────────────────────────────────────────

const isSignal = (r) => r instanceof ReturnSignal || r instanceof BreakSignal || r instanceof ContinueSignal || r instanceof ThrowSignal;

/**
 * @param {object} node
 * @param {PyScope} env
 * @param {{recorder: Recorder|null}} rt
 */
export function evaluate(node, env, rt, depth = 0, callDepth = 0) {
  if (!node) return undefined;
  if (rt.recorder) return rt.recorder.record(node, env, depth, callDepth, () => _eval(node, env, rt, depth, callDepth));
  return _eval(node, env, rt, depth, callDepth);
}

function _eval(node, env, rt, depth, callDepth) {
  const d = depth + 1;
  const ev = (n, e = env) => evaluate(n, e, rt, d, callDepth);

  switch (node.type) {
    case 'Program':
    case 'BlockStatement': {
      let result;
      for (const s of node.body) {
        result = ev(s);
        if (isSignal(result)) return result;
      }
      return node.type === 'Program' ? result : undefined;
    }
    case 'ExpressionStatement': return ev(node.expression);
    case 'EmptyStatement':
    case 'GlobalStatement':     return undefined;
    case 'DeleteStatement':
      for (const t of node.targets) deleteTarget(t, env, rt, d, callDepth);
      return undefined;

    case 'ClassDeclaration': {
      const bases = node.bases.map(b => {
        const v = ev(b);
        if (!isClass(v)) throw new PyError('TypeError', `基底クラスには クラスを書きます（${typeName(v)} が書かれています）`, b.loc);
        return v;
      });
      // クラスの本体は自分のスコープで実行し、そこで作った名前がクラスの属性になる
      if (!node.pyScope) {
        const sc = analyzeScope({ params: [], body: node.body });
        node.pyScope = sc;
      }
      const cenv = new PyScope(env, 'class', node.pyScope);
      const r = ev(node.body, cenv);
      if (isSignal(r)) return r;
      const cls = new PyClass(node.id.name, bases.length ? bases : [ObjectClass], Object.fromEntries(cenv.bindings));
      for (const b of cenv.bindings.values()) {
        // staticmethod・classmethod・property で包んだ関数も、どのクラスのメソッドかを知らせる（super() のため。ADR-012）
        for (const v of [b, b?.fn, b?.fget, b?.fset]) {
          if (v && v.__type__ === 'JSFunction' && v.classEnv === cenv) {
            v.ownerClass = cls;
            v.qualName = `${cls.name}.${v.name}`;   // メッセージでは CPython と同じくクラス名を付ける（A.__init__()。ADR-010）
          }
        }
      }
      assignName(node.id.name, cls, env, node.loc);
      return undefined;
    }

    case 'DecoratedStatement': {   // @dec：デコレーターの式を先に評価し、定義のあと下から順に適用する（ADR-012）
      const decs = node.decorators.map(x => ev(x));
      const r = ev(node.definition);
      if (isSignal(r)) return r;
      const name = node.definition.id.name;
      let v = lookup(name, env, node.loc);
      for (let i = decs.length - 1; i >= 0; i--) v = callFunction(decs[i], [v], {}, rt, d, callDepth, node.decorators[i].loc, env);
      assignName(name, v, env, node.loc);
      return undefined;
    }

    case 'WithStatement':   // with 式 as 名前:（ADR-012）
      return runWith(node, 0, env, rt, d, callDepth);

    case 'MatchStatement': {   // match 式: case パターン:（ADR-012）
      const subject = ev(node.subject);
      for (const c of node.cases) {
        const binds = new Map();
        // case を試すたびに CaseTest として記録する（値は当てはまったか。制御フローのビューの「×N」が試した回数になる）
        const test = () => matchPattern(c.pattern, subject, binds, env, rt, d, callDepth);
        const matched = rt.recorder ? rt.recorder.record({ type: 'CaseTest', loc: c.head.loc, end: c.head.end }, env, d, callDepth, test) : test();
        if (!matched) continue;
        // 当てはまった case を CaseBinding として記録する（「人」のステップが止まる。取り込んだ名前に代入する）
        const binding = { type: 'CaseBinding', loc: c.head.loc, end: c.head.end };
        const bind = () => { for (const [k, v] of binds) assignName(k, v, env, c.loc); return subject; };
        if (rt.recorder) rt.recorder.record(binding, env, d, callDepth, bind); else bind();
        if (c.guard && !truthy(ev(c.guard))) continue;
        const r = ev(c.body);
        return isSignal(r) ? r : undefined;
      }
      return undefined;
    }

    case 'TryStatement': {
      const rec = rt.recorder;
      const traceStart = rec ? rec.trace.length : 0;
      const savedCurEnv = rec?.curEnv;
      let result;
      let pending = null;   // finally のあとで投げ直す例外
      try {
        const r = ev(node.block);
        if (isSignal(r)) result = r;
        else if (node.orelse) { const r2 = ev(node.orelse); if (isSignal(r2)) result = r2; }
      } catch (err) {
        const exc = toPyException(err);
        if (!exc) throw err;   // 上限超過・未対応の構文などは except で捕まえない
        if (rec) { trimFailedTry(rec.trace, traceStart); rec.curEnv = savedCurEnv; }
        pending = err;
        for (const h of node.handlers) {
          if (h.exType && !exceptMatches(ev(h.exType), exc, h.loc)) continue;
          pending = null;
          // 捕まえた時点（except の行）を ExceptBinding として記録する（「人」のステップが止まる）
          const binding = { type: 'ExceptBinding', loc: h.head.loc, end: h.head.end };
          const bind = () => { if (h.name) assignName(h.name, exc, env, h.loc); return exc; };
          if (rec) rec.record(binding, env, d, callDepth, bind); else bind();
          rt.excStack = [...(rt.excStack ?? []), exc];
          try {
            const r = ev(h.body);
            if (isSignal(r)) result = r;
          } catch (err2) {
            pending = err2;
          } finally {
            rt.excStack.pop();
            if (h.name) env.bindings.delete(h.name);   // Python は except の後で as の名前を消す
          }
          break;
        }
      }
      if (node.finalizer) {
        const rf = ev(node.finalizer);
        if (isSignal(rf)) return rf;   // finally の return / break は、例外や前の return より優先する
      }
      if (pending) throw pending;
      return result;
    }

    case 'RaiseStatement': {
      if (!node.exc) {
        const top = rt.excStack?.[rt.excStack.length - 1];
        if (!top) throw new PyError('RuntimeError', '投げ直す例外がありません（raise だけの文は except の中で使います）', node.loc);
        raise(top, node.loc);
      }
      let v = ev(node.exc);
      if (isExceptionClass(v)) v = instantiate(v, [], {}, rt, d, callDepth, node.loc, env);
      if (!isException(v)) throw new PyError('TypeError', `raise できるのは例外だけです（${typeName(v)}）`, node.loc);
      if (node.cause) ev(node.cause);
      raise(v, node.loc);
      return undefined;
    }

    case 'ImportStatement':
      for (const { name, alias } of node.names) assignName(alias ?? name, importModule(name, node.loc), env, node.loc);
      return undefined;
    case 'ImportFromStatement': {
      const m = importModule(node.module, node.loc);
      if (node.star) {
        for (const [k, v] of Object.entries(m.attrs)) assignName(k, v, env, node.loc);
        return undefined;
      }
      for (const { name, alias } of node.names) {
        if (!Object.prototype.hasOwnProperty.call(m.attrs, name)) {
          throw new PyError('ImportError', `モジュール '${node.module}' に ${name} はありません`, node.loc);
        }
        assignName(alias ?? name, m.attrs[name], env, node.loc);
      }
      return undefined;
    }

    case 'AssertStatement':
      if (!truthy(ev(node.test))) {
        raise(makeException(EXCEPTIONS.AssertionError, node.msg ? [ev(node.msg)] : []), node.loc);
      }
      return undefined;
    case 'BreakStatement':      return new BreakSignal();
    case 'ContinueStatement':   return new ContinueSignal();
    case 'ReturnStatement':     return new ReturnSignal(node.argument ? ev(node.argument) : null);

    case 'IfStatement':
      if (truthy(ev(node.test))) return ev(node.consequent);
      return node.alternate ? ev(node.alternate) : undefined;

    case 'WhileStatement': {
      let broke = false;
      while (truthy(ev(node.test))) {
        const r = ev(node.body);
        if (r instanceof BreakSignal) { broke = true; break; }
        if (r instanceof ContinueSignal) continue;
        if (isSignal(r)) return r;
      }
      if (!broke && node.orelse) { const r = ev(node.orelse); if (isSignal(r)) return r; }
      return undefined;
    }

    case 'ForOfStatement': {
      const iterable = ev(node.right);
      // 各回のループ変数への代入を LoopBinding として記録する（humanStep が各回で止まる。phase0-report 3.2 節 f）
      const binding = { type: 'LoopBinding', loc: node.left.loc, end: node.left.end };
      let broke = false;
      for (const item of iterate(iterable, node.right.loc)) {
        const bind = () => { assignTarget(node.left, item, env, rt, d + 1, callDepth); return item; };
        if (rt.recorder) rt.recorder.record(binding, env, d, callDepth, bind); else bind();
        const r = ev(node.body);
        if (r instanceof BreakSignal) { broke = true; break; }
        if (r instanceof ContinueSignal) continue;
        if (isSignal(r)) return r;
      }
      if (!broke && node.orelse) { const r = ev(node.orelse); if (isSignal(r)) return r; }
      return undefined;
    }

    case 'FunctionDeclaration':
      assignName(node.id.name, makeFunction(node, env, rt, d, callDepth), env, node.loc);
      return undefined;

    case 'ArrowFunctionExpression':
      return makeFunction(node, env, rt, d, callDepth);

    case 'AssignmentExpression': {
      if (node.operator === '=') {
        const value = ev(node.right);
        assignTarget(node.left, value, env, rt, d, callDepth);
        for (const t of node.extraTargets ?? []) assignTarget(t, value, env, rt, d, callDepth);
        return value;
      }
      const op = node.operator.slice(0, -1);
      const t = node.left;
      if (t.type === 'Identifier') {
        const cur = lookup(t.name, env, t.loc);
        const rhs = ev(node.right);
        // list の += はその場で延長する（別名の変数からも変化が見える）
        const value = op === '+' && isList(cur) ? (cur.push(...iterate(rhs, node.loc)), cur) : binop(op, cur, rhs, node.loc);
        assignName(t.name, value, env, t.loc);
        return value;
      }
      if (t.type === 'MemberExpression' && t.computed && t.property.type !== 'SliceExpression') {
        const obj = ev(t.object);
        const key = ev(t.property);
        const cur = getItem(obj, key, t.loc);
        const value = binop(op, cur, ev(node.right), node.loc);
        setItem(obj, key, value, t.loc);
        return value;
      }
      if (t.type === 'MemberExpression' && !t.computed) {   // self.count += 1
        const obj = ev(t.object);
        const cur = getAttr(obj, t.property.name, t.loc);
        const value = op === '+' && isList(cur) ? (cur.push(...iterate(ev(node.right), node.loc)), cur) : binop(op, cur, ev(node.right), node.loc);
        setAttr(obj, t.property.name, value, t.loc);
        return value;
      }
      throw new PyError('NotImplemented', 'この形の複合代入はまだ対応していません', node.loc);
    }

    // ── 式 ────────────────────────────────────────────────────────────────────
    case 'Literal':
      if (node.bigint) return normInt(BigInt(node.bigint));
      return node.pyKind === 'float' ? makeFloat(node.value) : node.value;
    case 'Identifier':
      return lookup(node.name, env, node.loc);
    case 'TemplateLiteral': {
      let s = node.quasis[0].value.cooked;
      node.expressions.forEach((e, i) => {
        // !r・!s・!a の変換（f"{x=}" は書式指定がなければ !r。ADR-011）
        const conv = node.conversions?.[i];
        let v = ev(e);
        if (conv === 'r' || conv === 'a') v = repr(v); else if (conv === 's') v = str(v);
        s += formatValue(v, node.formatSpecs[i], e.loc) + node.quasis[i + 1].value.cooked;
      });
      return s;
    }
    case 'BinaryExpression': {
      const l = ev(node.left);
      const r = ev(node.right);
      return ['<', '>', '<=', '>=', '==', '!=', 'in', 'not in', 'is', 'is not'].includes(node.operator)
        ? compare(node.operator, l, r, node.loc)
        : binop(node.operator, l, r, node.loc);
    }
    case 'CompareChain': {
      let l = ev(node.operands[0]);
      for (let i = 0; i < node.operators.length; i++) {
        const r = ev(node.operands[i + 1]);
        if (!compare(node.operators[i], l, r, node.loc)) return false;
        l = r;
      }
      return true;
    }
    case 'LogicalExpression': {
      const l = ev(node.left);
      if (node.operator === 'and') return truthy(l) ? ev(node.right) : l;
      return truthy(l) ? l : ev(node.right);
    }
    case 'UnaryExpression': {
      const v = ev(node.argument);
      switch (node.operator) {
        case 'not': return !truthy(v);
        case '-': if (isNum(v)) return isFloat(v) ? makeFloat(-v.v) : intOp('-', 0, v); break;
        case '+': if (isNum(v)) return isFloat(v) ? v : intOp('+', 0, v); break;
        case '~': if (isInt(v) || isBool(v)) return normInt(~big(v)); break;
      }
      throw new PyError('TypeError', `単項の「${node.operator}」は ${typeName(v)} には使えません`, node.loc);
    }
    case 'ConditionalExpression':
      return truthy(ev(node.test)) ? ev(node.consequent) : ev(node.alternate);

    case 'CallExpression': {
      let callee;
      if (node.callee.type === 'MemberExpression' && !node.callee.computed) {
        // obj.method(...)：obj を 1 回だけ評価し、メソッドを取り出す（JS 版と同じく MemberExpression 自体は記録しない）
        const obj = ev(node.callee.object);
        callee = getAttr(obj, node.callee.property.name, node.callee.loc);
      } else {
        callee = ev(node.callee);
      }
      const args = [], kwargs = {};
      for (const a of node.arguments) {
        if (a.type === 'KeywordArgument') kwargs[a.name] = ev(a.value);
        else if (a.type === 'SpreadElement') args.push(...iterate(ev(a.argument), a.loc));
        else if (a.type === 'KeywordSpreadElement') {
          const d2 = ev(a.argument);
          if (!isDict(d2)) throw new PyError('TypeError', `** の後ろは辞書でなければなりません（${typeName(d2)}）`, a.loc);
          for (const [k, v] of dictEntries(d2)) {
            if (!isStr(k)) throw new PyError('TypeError', 'キーワード引数の名前は文字列でなければなりません', a.loc);
            kwargs[k] = v;
          }
        } else args.push(ev(a));
      }
      return callFunction(callee, args, kwargs, rt, d, callDepth, node.loc, env);
    }
    case 'MemberExpression': {
      const obj = ev(node.object);
      if (!node.computed) return getAttr(obj, node.property.name, node.loc);
      if (node.property.type === 'SliceExpression') {
        const p = node.property;
        return getSlice(obj, p.lower && ev(p.lower), p.upper && ev(p.upper), p.step && ev(p.step), node.loc);
      }
      return getItem(obj, ev(node.property), node.loc);
    }
    case 'ArrayExpression':  return spreadElements(node.elements, ev);
    case 'TupleExpression':  return makeTuple(spreadElements(node.elements, ev));
    case 'NamedExpression': {   // n := 3。内包表記の中では、内包表記を含むスコープに代入する（PEP 572。ADR-011）
      const v = ev(node.value);
      let target = env;
      while (target.kind === 'comprehension') target = target.parent;
      assignName(node.target.name, v, target, node.target.loc);
      return v;
    }
    case 'ListComprehension':
    case 'GeneratorExpression': {   // ジェネレーター式は、その場で全部計算した list として扱う
      const out = [];
      comprehend(node, env, rt, d, callDepth, (cenv) => out.push(evaluate(node.element, cenv, rt, d, callDepth)));
      return out;
    }
    case 'SetComprehension': {
      const out = makeSet();
      comprehend(node, env, rt, d, callDepth, (cenv) => setAdd(out, evaluate(node.element, cenv, rt, d, callDepth), node.loc));
      return out;
    }
    case 'DictComprehension': {
      const out = makeDict();
      comprehend(node, env, rt, d, callDepth, (cenv) => {
        const k = evaluate(node.key, cenv, rt, d, callDepth);
        dictSet(out, k, evaluate(node.value, cenv, rt, d, callDepth), node.loc);
      });
      return out;
    }
    case 'SetExpression': {
      const out = makeSet();
      for (const v of spreadElements(node.elements, ev)) setAdd(out, v, node.loc);
      return out;
    }
    case 'DictExpression': {
      const d2 = makeDict();
      for (const { key, value } of node.entries) dictSet(d2, ev(key), ev(value), key.loc);
      return d2;
    }
  }
  throw new PyError('NotImplemented', `${node.type} はまだ評価できません`, node.loc);
}

export { str, repr };
