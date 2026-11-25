/**
 * modules.js — import できるモジュール（ADR-007・ADR-013）
 *
 * math・random・time・datetime・collections・copy・statistics・string。
 * モジュールは PyModule（名前と属性）。スナップショットでは参照を保持する。
 * random（乱数の状態）・time（仮の時計）は実行ごとに状態を持つので、モジュールは実行ごとに作り、
 * 同じ実行の中では同じものを返す（import を 2 回しても同じモジュール）。
 */
import { makeRandomModule } from './lib/random.js';
import { makeDatetimeModule, makeTimeModule } from './lib/datetime.js';
import { makeCollectionsModule, makeCopyModule, makeStatisticsModule, makeStringModule } from './lib/collections.js';
import {
  PyError, makeFloat, isInt, isBool, isNum, num, normInt, intOp, typeName, iterate,
} from './values.js';

export class PyModule {
  constructor(name, attrs) { this.name = name; this.attrs = attrs; Object.freeze(this); }
  toString() { return `<module '${this.name}'>`; }
}

const def = (name, fn) => { fn.pyName = name; return fn; };

/** 引数を JS の数値にする（数でなければ TypeError） */
function x(v, fname, loc) {
  if (!isNum(v)) throw new PyError('TypeError', `math.${fname}() には数を渡します（${typeName(v)} が渡されました）`, loc);
  return num(v);
}
const domain = (loc) => new PyError('ValueError', '数学の関数の定義域の外の値です（math domain error）', loc);
/** 小数を、Python と同じく int にする（大きければ BigInt） */
const toInt = (f, loc) => {
  if (!Number.isFinite(f)) throw new PyError(Number.isNaN(f) ? 'ValueError' : 'OverflowError', '整数にできない値です', loc);
  return normInt(BigInt(f));
};
function intArg(v, fname, loc) {
  if (!(isInt(v) || isBool(v))) throw new PyError('TypeError', `math.${fname}() には整数を渡します（${typeName(v)} が渡されました）`, loc);
  return isBool(v) ? (v ? 1 : 0) : v;
}

function factorial(n, loc) {
  if (n < 0) throw new PyError('ValueError', 'math.factorial() に負の数は使えません', loc);
  let r = 1;
  for (let i = 2; i <= n; i++) r = intOp('*', r, i);
  return r;
}

/** 1 引数の小数の関数（定義域を調べる） */
const f1 = (name, f, ok = () => true) => def(name, (args, _k, ctx) => {
  const v = x(args[0], name, ctx.loc);
  if (!ok(v)) throw domain(ctx.loc);
  return makeFloat(f(v));
});

const MATH = {
  pi: makeFloat(Math.PI),
  e: makeFloat(Math.E),
  tau: makeFloat(2 * Math.PI),
  inf: makeFloat(Infinity),
  nan: makeFloat(NaN),
  sqrt: f1('sqrt', Math.sqrt, (v) => v >= 0),
  exp: f1('exp', Math.exp),
  log2: f1('log2', Math.log2, (v) => v > 0),
  log10: f1('log10', Math.log10, (v) => v > 0),
  sin: f1('sin', Math.sin), cos: f1('cos', Math.cos), tan: f1('tan', Math.tan),
  asin: f1('asin', Math.asin, (v) => v >= -1 && v <= 1), acos: f1('acos', Math.acos, (v) => v >= -1 && v <= 1),
  atan: f1('atan', Math.atan),
  fabs: f1('fabs', Math.abs),
  degrees: f1('degrees', (v) => v * 180 / Math.PI),
  radians: f1('radians', (v) => v * Math.PI / 180),
  log: def('log', (args, _k, ctx) => {
    const v = x(args[0], 'log', ctx.loc);
    if (v <= 0) throw domain(ctx.loc);
    if (args.length < 2) return makeFloat(Math.log(v));
    const b = x(args[1], 'log', ctx.loc);
    if (b <= 0 || b === 1) throw domain(ctx.loc);
    return makeFloat(Math.log(v) / Math.log(b));
  }),
  pow: def('pow', (args, _k, ctx) => makeFloat(x(args[0], 'pow', ctx.loc) ** x(args[1], 'pow', ctx.loc))),
  atan2: def('atan2', (args, _k, ctx) => makeFloat(Math.atan2(x(args[0], 'atan2', ctx.loc), x(args[1], 'atan2', ctx.loc)))),
  hypot: def('hypot', (args, _k, ctx) => makeFloat(Math.hypot(...args.map(a => x(a, 'hypot', ctx.loc))))),
  floor: def('floor', (args, _k, ctx) => (isInt(args[0]) ? args[0] : toInt(Math.floor(x(args[0], 'floor', ctx.loc)), ctx.loc))),
  ceil: def('ceil', (args, _k, ctx) => (isInt(args[0]) ? args[0] : toInt(Math.ceil(x(args[0], 'ceil', ctx.loc)), ctx.loc))),
  trunc: def('trunc', (args, _k, ctx) => (isInt(args[0]) ? args[0] : toInt(Math.trunc(x(args[0], 'trunc', ctx.loc)), ctx.loc))),
  isqrt: def('isqrt', (args, _k, ctx) => {
    const n = BigInt(intArg(args[0], 'isqrt', ctx.loc));
    if (n < 0n) throw new PyError('ValueError', 'math.isqrt() に負の数は使えません', ctx.loc);
    if (n < 2n) return normInt(n);
    let r = BigInt(Math.floor(Math.sqrt(Number(n))));
    while (r * r > n) r -= 1n;
    while ((r + 1n) * (r + 1n) <= n) r += 1n;
    return normInt(r);
  }),
  gcd: def('gcd', (args, _k, ctx) => {
    let g = 0n;
    for (const a of args) {
      let b = BigInt(intArg(a, 'gcd', ctx.loc));
      if (b < 0n) b = -b;
      while (b) [g, b] = [b, g % b];
    }
    return normInt(g);
  }),
  factorial: def('factorial', (args, _k, ctx) => factorial(intArg(args[0], 'factorial', ctx.loc), ctx.loc)),
  comb: def('comb', (args, _k, ctx) => {
    const n = intArg(args[0], 'comb', ctx.loc), k = intArg(args[1], 'comb', ctx.loc);
    if (n < 0 || k < 0) throw new PyError('ValueError', 'math.comb() に負の数は使えません', ctx.loc);
    if (k > n) return 0;
    let r = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) r = intOp('//', intOp('*', r, n - Math.min(k, n - k) + i), i);
    return r;
  }),
  perm: def('perm', (args, _k, ctx) => {
    const n = intArg(args[0], 'perm', ctx.loc), k = args.length > 1 ? intArg(args[1], 'perm', ctx.loc) : n;
    if (n < 0 || k < 0) throw new PyError('ValueError', 'math.perm() に負の数は使えません', ctx.loc);
    if (k > n) return 0;
    let r = 1;
    for (let i = n - k + 1; i <= n; i++) r = intOp('*', r, i);
    return r;
  }),
  isclose: def('isclose', (args, kw, ctx) => {
    const a = x(args[0], 'isclose', ctx.loc), b = x(args[1], 'isclose', ctx.loc);
    const rel = kw.rel_tol !== undefined ? num(kw.rel_tol) : 1e-9, abs = kw.abs_tol !== undefined ? num(kw.abs_tol) : 0;
    return a === b || Math.abs(a - b) <= Math.max(rel * Math.max(Math.abs(a), Math.abs(b)), abs);
  }),
  isfinite: def('isfinite', (args, _k, ctx) => Number.isFinite(x(args[0], 'isfinite', ctx.loc))),
  isinf: def('isinf', (args, _k, ctx) => { const v = x(args[0], 'isinf', ctx.loc); return v === Infinity || v === -Infinity; }),
  isnan: def('isnan', (args, _k, ctx) => Number.isNaN(x(args[0], 'isnan', ctx.loc))),
  fsum: def('fsum', (args, _k, ctx) => {
    let s = 0;
    for (const v of iterate(args[0], ctx.loc)) s += x(v, 'fsum', ctx.loc);
    return makeFloat(s);
  }),
};

/** モジュールの名前 → 属性を作る関数 */
const FACTORIES = {
  math: () => MATH,
  random: makeRandomModule,
  time: makeTimeModule,
  datetime: makeDatetimeModule,
  collections: makeCollectionsModule,
  copy: makeCopyModule,
  statistics: makeStatisticsModule,
  string: makeStringModule,
};
export const AVAILABLE_MODULES = Object.keys(FACTORIES);

/**
 * モジュールを読み込む。ないものは ModuleNotFoundError。
 * @param {object} [rt] 実行の状態（rt.modules に、この実行で読み込んだモジュールを覚える）
 */
export function importModule(name, loc, rt = {}) {
  if (!Object.prototype.hasOwnProperty.call(FACTORIES, name)) {
    throw new PyError('ModuleNotFoundError',
      `モジュール '${name}' は使えません（PyVisualizer で import できるのは ${AVAILABLE_MODULES.join('・')} です）`, loc);
  }
  rt.modules ??= new Map();
  if (!rt.modules.has(name)) rt.modules.set(name, new PyModule(name, FACTORIES[name]()));
  return rt.modules.get(name);
}

export const isModule = (v) => v instanceof PyModule;
