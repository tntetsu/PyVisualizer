/**
 * interpreter.js — Python 評価器（Phase 0 スパイク）
 *
 * JSInterpreter の Recorder・制御シグナル・Environment を「改変せずに」import して使い、
 * Python の意味論（スコープ・演算・真偽・反復）だけをここで実装する。
 * 対象範囲は docs/development-plan.md 4.1 節の MVP のうち、スパイクで確かめたい部分。
 */
import {
  Recorder, ReturnSignal, BreakSignal, ContinueSignal, ThrowSignal,
} from 'js-interpreter/src/interpreter/interpreter.js';
import { Environment, deepClone } from 'js-interpreter/src/interpreter/environment.js';
import {
  PyError, PyRange, makeFloat, makeTuple, makeDict, dictSet, dictKey,
  isFloat, isInt, isBool, isNum, isStr, isTuple, isList, isDict, num, typeName,
  truthy, repr, str, pyEq, pyCmp, iterate, contains,
} from './values.js';
import { BUILTINS, getAttr, formatValue } from './builtins.js';

const MAX_RECURSION = 1000;

/** print の出力を JSInterpreter の consoleLogs（1 行 1 件）に合わせる記録器。端末への転送はしない */
export class PyRecorder extends Recorder {
  constructor(maxSteps) {
    super(maxSteps);
    this.pendingOut = '';
  }
  captureLog(level, args) {
    this.consoleLogs.push({ atIndex: this.trace.length, level, text: args.join(' ') });
  }
  /** print の出力を受け取る。改行までたまったら 1 行として記録する（docs/phase0-report.md: 改行なしの print） */
  write(text) {
    const lines = (this.pendingOut + text).split('\n');
    this.pendingOut = lines.pop();
    for (const l of lines) this.captureLog('log', [l]);
  }
  flush() {
    if (this.pendingOut !== '') { this.captureLog('log', [this.pendingOut]); this.pendingOut = ''; }
  }
}

// ── スコープ ──────────────────────────────────────────────────────────────────

/** 関数本体で代入される名前（ローカル）と global/nonlocal 宣言を静的に集める */
function analyzeScope(fnNode) {
  const locals = new Set(), globals = new Set(), nonlocals = new Set();
  const addTarget = (t) => {
    if (!t) return;
    if (t.type === 'Identifier') locals.add(t.name);
    else if (t.type === 'TupleExpression' || t.type === 'ArrayExpression') t.elements.forEach(addTarget);
  };
  for (const p of fnNode.params) addTarget(p.type === 'AssignmentPattern' ? p.left : p);
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
      case 'AssignmentExpression': addTarget(n.left); walk(n.right); if (n.left.type !== 'Identifier') walk(n.left); return;
      case 'ForOfStatement': addTarget(n.left); walk(n.right); walk(n.body); return;
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
    throw new PyError('UnboundLocalError', `ローカル変数 '${name}' に値を入れる前に使っています`, loc);
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

function arith(a, b, f) {
  const r = f(num(a), num(b));
  return isFloat(a) || isFloat(b) ? makeFloat(r) : r;
}

export function binop(op, a, b, loc) {
  const nums = isNum(a) && isNum(b);
  switch (op) {
    case '+':
      if (nums) return arith(a, b, (x, y) => x + y);
      if (isStr(a) && isStr(b)) return a + b;
      if (isList(a) && isList(b)) return [...a, ...b];
      if (isTuple(a) && isTuple(b)) return makeTuple([...a, ...b]);
      break;
    case '-': if (nums) return arith(a, b, (x, y) => x - y); break;
    case '*':
      if (nums) return arith(a, b, (x, y) => x * y);
      for (const [s, n] of [[a, b], [b, a]]) {
        if ((isInt(n) || isBool(n)) && (isStr(s) || Array.isArray(s))) {
          const k = Math.max(0, num(n));
          if (isStr(s)) return s.repeat(k);
          const out = [];
          for (let i = 0; i < k; i++) out.push(...s);
          return isTuple(s) ? makeTuple(out) : out;
        }
      }
      break;
    case '/':
      if (nums) { if (num(b) === 0) throw zeroDiv(loc); return makeFloat(num(a) / num(b)); }
      break;
    case '//':
      if (nums) { if (num(b) === 0) throw zeroDiv(loc); return arith(a, b, (x, y) => Math.floor(x / y)); }
      break;
    case '%':
      if (isStr(a)) throw new PyError('NotImplemented', '文字列の % 書式はまだ対応していません', loc);
      if (nums) { if (num(b) === 0) throw zeroDiv(loc); return arith(a, b, (x, y) => x - y * Math.floor(x / y)); }
      break;
    case '**':
      if (nums) {
        if (num(a) === 0 && num(b) < 0) throw zeroDiv(loc);
        if (!isFloat(a) && !isFloat(b) && num(b) < 0) return makeFloat(num(a) ** num(b));
        return arith(a, b, (x, y) => x ** y);
      }
      break;
    case '&': case '|': case '^': case '<<': case '>>':
      if ((isInt(a) || isBool(a)) && (isInt(b) || isBool(b))) {
        const x = num(a), y = num(b);
        return { '&': x & y, '|': x | y, '^': x ^ y, '<<': x << y, '>>': x >> y }[op];
      }
      break;
  }
  throw new PyError('TypeError', `「${op}」は ${typeName(a)} と ${typeName(b)} の組み合わせには使えません`, loc);
}

function compare(op, a, b, loc) {
  switch (op) {
    case '==': return pyEq(a, b);
    case '!=': return !pyEq(a, b);
    case '<':  return pyCmp(a, b, op, loc) < 0;
    case '>':  return pyCmp(a, b, op, loc) > 0;
    case '<=': return pyCmp(a, b, op, loc) <= 0;
    case '>=': return pyCmp(a, b, op, loc) >= 0;
    case 'in':     return contains(b, a, loc);
    case 'not in': return !contains(b, a, loc);
    case 'is':     return a === b || (a == null && b == null);
    case 'is not': return !(a === b || (a == null && b == null));
  }
  throw new PyError('SyntaxError', `未知の比較演算子 ${op}`, loc);
}

// ── 添字・スライス ────────────────────────────────────────────────────────────

function normIndex(seq, key, loc) {
  if (!(isInt(key) || isBool(key))) {
    throw new PyError('TypeError', `${typeName(seq)} の添字は整数でなければなりません（${typeName(key)} が指定されました）`, loc);
  }
  const n = seq instanceof PyRange ? seq.length : seq.length;
  const i = num(key) < 0 ? num(key) + n : num(key);
  if (i < 0 || i >= n) {
    throw new PyError('IndexError', `${typeName(seq)} の範囲外の位置 ${num(key)} を指定しています（長さ ${n}）`, loc);
  }
  return i;
}

export function getItem(obj, key, loc) {
  if (isDict(obj)) {
    const k = dictKey(key, loc);
    if (!Object.prototype.hasOwnProperty.call(obj, k)) throw new PyError('KeyError', `辞書にキー ${repr(key)} がありません`, loc);
    return obj[k];
  }
  if (obj instanceof PyRange) return obj.at(normIndex(obj, key, loc));
  if (isStr(obj) || Array.isArray(obj)) return obj[normIndex(obj, key, loc)];
  throw new PyError('TypeError', `${typeName(obj)} には [ ] で添字を付けられません`, loc);
}

function setItem(obj, key, value, loc) {
  if (isDict(obj)) { dictSet(obj, key, value, loc); return; }
  if (isList(obj)) { obj[normIndex(obj, key, loc)] = value; return; }
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
  if (Array.isArray(obj)) {
    const out = sliceIndices(obj.length, ...ints, loc).map(i => obj[i]);
    return isTuple(obj) ? makeTuple(out) : out;
  }
  throw new PyError('TypeError', `${typeName(obj)} はスライスできません`, loc);
}

// ── 関数 ──────────────────────────────────────────────────────────────────────

function makeFunction(node, env, rt, depth, callDepth) {
  if (!node.pyScope) node.pyScope = analyzeScope(node);
  // デフォルト引数は def の時点で 1 回だけ評価する（Python の意味論）
  const defaults = node.params.map(p => (p.type === 'AssignmentPattern' ? evaluate(p.right, env, rt, depth, callDepth) : undefined));
  return {
    __type__: 'JSFunction',
    name: node.id ? node.id.name : '<lambda>',
    params: node.params,
    paramNames: node.params.map(p => (p.type === 'AssignmentPattern' ? p.left.name : p.name)),
    defaults,
    body: node.body,
    expression: !!node.expression,
    isLambda: !!node.isLambda,
    closure: env,
    scope: node.pyScope,
  };
}

function bindArgs(fn, args, kwargs, env, loc) {
  const names = fn.paramNames;
  if (args.length > names.length) {
    throw new PyError('TypeError', `${fn.name}() の引数は ${names.length} 個までですが、${args.length} 個渡されました`, loc);
  }
  const vals = new Array(names.length);
  const given = new Array(names.length).fill(false);
  args.forEach((a, i) => { vals[i] = a; given[i] = true; });
  for (const [k, v] of Object.entries(kwargs)) {
    const i = names.indexOf(k);
    if (i < 0) throw new PyError('TypeError', `${fn.name}() に ${k} という名前の引数はありません`, loc);
    if (given[i]) throw new PyError('TypeError', `${fn.name}() の引数 ${k} が 2 回指定されています`, loc);
    vals[i] = v; given[i] = true;
  }
  names.forEach((n, i) => {
    if (!given[i]) {
      if (fn.defaults[i] === undefined) throw new PyError('TypeError', `${fn.name}() の引数 '${n}' が渡されていません`, loc);
      vals[i] = fn.defaults[i];
    }
    env.bindings.set(n, vals[i]);
  });
  return vals;
}

export function callFunction(callee, args, kwargs, rt, depth, callDepth, loc) {
  if (typeof callee === 'function') {
    return callee(args, kwargs, {
      rt, loc,
      call: (fn, a, kw = {}) => callFunction(fn, a, kw, rt, depth, callDepth, loc),
    });
  }
  if (!callee || callee.__type__ !== 'JSFunction') {
    throw new PyError('TypeError', `${typeName(callee)} は関数ではないので呼び出せません`, loc);
  }
  if (callDepth + 1 > MAX_RECURSION) {
    throw new PyError('RecursionError', `関数の呼び出しが ${MAX_RECURSION} 段を超えました（再帰が止まっていない可能性があります）`, loc);
  }
  const env = new Environment(callee.closure, 'function');
  env.pyScope = callee.scope;
  const vals = bindArgs(callee, args, kwargs, env, loc);
  const recorder = rt.recorder;
  if (recorder) {
    recorder.pushFrame({ name: callee.name, loc: loc || { line: 0, column: 0 }, args: vals.map(a => deepClone(a)) }, env);
  }
  let result;
  try {
    result = evaluate(callee.body, env, rt, depth, callDepth + 1);
  } finally {
    if (recorder) recorder.popFrame();
  }
  if (callee.expression) return result;
  if (result instanceof ReturnSignal) return result.value;
  if (result instanceof ThrowSignal) return result;
  return null;
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

function assignTarget(target, value, env, rt, d, callDepth) {
  switch (target.type) {
    case 'Identifier': assignName(target.name, value, env, target.loc); return;
    case 'TupleExpression':
    case 'ArrayExpression': {
      const items = unpack(value, target.elements.length, target.loc);
      target.elements.forEach((t, i) => assignTarget(t, items[i], env, rt, d, callDepth));
      return;
    }
    case 'MemberExpression': {
      if (!target.computed) throw new PyError('NotImplemented', '属性への代入（obj.x = ...）はまだ対応していません', target.loc);
      if (target.property.type === 'SliceExpression') throw new PyError('NotImplemented', 'スライスへの代入はまだ対応していません', target.loc);
      const obj = evaluate(target.object, env, rt, d, callDepth);
      const key = evaluate(target.property, env, rt, d, callDepth);
      setItem(obj, key, value, target.loc);
      return;
    }
  }
  throw new PyError('SyntaxError', 'ここには代入できません', target.loc);
}

// ── 評価 ──────────────────────────────────────────────────────────────────────

const isSignal = (r) => r instanceof ReturnSignal || r instanceof BreakSignal || r instanceof ContinueSignal || r instanceof ThrowSignal;

/**
 * @param {object} node
 * @param {Environment} env
 * @param {{recorder: PyRecorder|null}} rt
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
    case 'BreakStatement':      return new BreakSignal();
    case 'ContinueStatement':   return new ContinueSignal();
    case 'ReturnStatement':     return new ReturnSignal(node.argument ? ev(node.argument) : null);

    case 'IfStatement':
      if (truthy(ev(node.test))) return ev(node.consequent);
      return node.alternate ? ev(node.alternate) : undefined;

    case 'WhileStatement':
      while (truthy(ev(node.test))) {
        const r = ev(node.body);
        if (r instanceof BreakSignal) break;
        if (r instanceof ContinueSignal) continue;
        if (isSignal(r)) return r;
      }
      return undefined;

    case 'ForOfStatement': {
      const iterable = ev(node.right);
      for (const item of iterate(iterable, node.right.loc)) {
        assignTarget(node.left, item, env, rt, d, callDepth);
        const r = ev(node.body);
        if (r instanceof BreakSignal) break;
        if (r instanceof ContinueSignal) continue;
        if (isSignal(r)) return r;
      }
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
      throw new PyError('NotImplemented', 'この形の複合代入はまだ対応していません', node.loc);
    }

    // ── 式 ────────────────────────────────────────────────────────────────────
    case 'Literal':
      return node.pyKind === 'float' ? makeFloat(node.value) : node.value;
    case 'Identifier':
      return lookup(node.name, env, node.loc);
    case 'TemplateLiteral': {
      let s = node.quasis[0].value.cooked;
      node.expressions.forEach((e, i) => {
        s += formatValue(ev(e), node.formatSpecs[i], e.loc) + node.quasis[i + 1].value.cooked;
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
        case '-': if (isNum(v)) return isFloat(v) ? makeFloat(-v.v) : -num(v); break;
        case '+': if (isNum(v)) return isFloat(v) ? v : num(v); break;
        case '~': if (isInt(v) || isBool(v)) return ~num(v); break;
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
        else args.push(ev(a));
      }
      return callFunction(callee, args, kwargs, rt, d, callDepth, node.loc);
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
    case 'ArrayExpression':  return node.elements.map(e => ev(e));
    case 'TupleExpression':  return makeTuple(node.elements.map(e => ev(e)));
    case 'DictExpression': {
      const d2 = makeDict();
      for (const { key, value } of node.entries) dictSet(d2, ev(key), ev(value), key.loc);
      return d2;
    }
  }
  throw new PyError('NotImplemented', `${node.type} はまだ評価できません`, node.loc);
}

export { str, repr };
