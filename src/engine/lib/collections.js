/**
 * lib/collections.js — collections（Counter・defaultdict・deque）、copy、statistics、string（ADR-013）
 *
 * - Counter・defaultdict は辞書（PyDict）に subtype（と defaultdict の factory）を足したもの。辞書の操作はそのまま使え、
 *   ビューでも辞書として中身が見える。ない要素を読むと、Counter は 0、defaultdict は factory() の値を入れて返す
 * - deque はリストに印 __pydeque__（と maxlen）を付けたもの。リストのメソッドに appendleft・popleft などを足す
 */
import {
  PyError, PyRange, makeFloat, makeTuple, makeDict, makeSet, dictSet, dictGet, dictHas, dictEntries, dictDelete,
  isInt, isBool, isFloat, isNum, isStr, isTuple, isList, isSet, isDict, num, normInt, intOp, typeName, repr, iterate,
  pyEq, pyCmp, truthy,
} from '../values.js';
import { PyClass, EXCEPTIONS, isInstance, makeInstance, invoke } from '../objects.js';

const def = (name, fn) => { fn.pyName = name; return fn; };
const defType = (name, fn) => { def(name, fn); fn.isType = true; return fn; };

// ── Counter ──────────────────────────────────────────────────────────────────

export const isCounter = (v) => isDict(v) && v.subtype === 'Counter';
export const isDefaultDict = (v) => isDict(v) && v.subtype === 'defaultdict';
export const isDeque = (v) => Array.isArray(v) && v.__pydeque__ === true;

function counterAdd(c, src, sign, loc) {
  if (isDict(src)) {
    for (const [k, n] of dictEntries(src)) dictSet(c, k, intOp(sign > 0 ? '+' : '-', dictHas(c, k, loc) ? dictGet(c, k, loc) : 0, n), loc);
  } else if (src !== undefined && src !== null) {
    for (const k of iterate(src, loc)) dictSet(c, k, intOp(sign > 0 ? '+' : '-', dictHas(c, k, loc) ? dictGet(c, k, loc) : 0, 1), loc);
  }
}

export function makeCounter(src, kwargs = {}, loc) {
  const c = makeDict();
  c.subtype = 'Counter';
  counterAdd(c, src, 1, loc);
  for (const [k, n] of Object.entries(kwargs)) dictSet(c, k, n, loc);
  return c;
}

/** 数の多い順（同じなら入れた順）の [キー, 数] */
const mostCommon = (c) => dictEntries(c).map((kv, i) => [kv, i]).sort((a, b) => {
  const d = num(b[0][1]) - num(a[0][1]);
  return d !== 0 ? d : a[1] - b[1];
}).map(x => x[0]);

export const COUNTER_METHODS = {
  most_common: (c, [n = null]) => {
    const all = mostCommon(c);
    return (n === null ? all : all.slice(0, Math.max(0, num(n)))).map(kv => makeTuple(kv));
  },
  elements: (c) => dictEntries(c).flatMap(([k, n]) => Array(Math.max(0, num(n))).fill(k)),
  update: (c, [src], kwargs, ctx) => { counterAdd(c, src, 1, ctx.loc); for (const [k, n] of Object.entries(kwargs)) counterAdd(c, makeCounter(null, { [k]: n }), 1, ctx.loc); return null; },
  subtract: (c, [src], _k, ctx) => { counterAdd(c, src, -1, ctx.loc); return null; },
  total: (c) => dictEntries(c).reduce((s, [, n]) => intOp('+', s, n), 0),
};

/** Counter どうしの + と -（結果は正の数だけ残す。CPython と同じ） */
export function counterBinop(op, a, b, loc) {
  const out = makeCounter(null);
  const keys = [...dictEntries(a).map(([k]) => k), ...dictEntries(b).map(([k]) => k).filter(k => !dictHas(a, k, loc))];
  for (const k of keys) {
    const x = dictHas(a, k, loc) ? dictGet(a, k, loc) : 0;
    const y = dictHas(b, k, loc) ? dictGet(b, k, loc) : 0;
    const v = intOp(op, x, y);
    if (num(v) > 0) dictSet(out, k, v, loc);
  }
  return out;
}

// ── defaultdict ──────────────────────────────────────────────────────────────

/** ない要素を読んだとき（Counter は 0、defaultdict は factory() を入れて返す）。どちらでもなければ undefined */
export function missingItem(d, key, loc) {
  if (isCounter(d)) return 0;
  if (isDefaultDict(d)) {
    if (d.factory === null) return undefined;
    const v = invoke(d.factory, []);
    dictSet(d, key, v, loc);
    return v;
  }
  return undefined;
}

// ── deque ────────────────────────────────────────────────────────────────────

export function makeDeque(items, maxlen = null) {
  const q = [...items];
  Object.defineProperty(q, '__pydeque__', { value: true, enumerable: false });
  Object.defineProperty(q, 'maxlen', { value: maxlen, enumerable: false, writable: true });
  if (maxlen !== null && q.length > maxlen) q.splice(0, q.length - maxlen);
  return q;
}

const trimLeft = (q) => { if (q.maxlen !== null && q.length > q.maxlen) q.splice(0, q.length - q.maxlen); };
const trimRight = (q) => { if (q.maxlen !== null && q.length > q.maxlen) q.length = q.maxlen; };

export const DEQUE_METHODS = {
  append: (q, [x]) => { q.push(x); trimLeft(q); return null; },
  appendleft: (q, [x]) => { q.unshift(x); trimRight(q); return null; },
  extend: (q, [it], _k, ctx) => { q.push(...iterate(it, ctx.loc)); trimLeft(q); return null; },
  extendleft: (q, [it], _k, ctx) => { for (const x of iterate(it, ctx.loc)) q.unshift(x); trimRight(q); return null; },
  pop: (q, _a, _k, ctx) => { if (!q.length) throw new PyError('IndexError', '空の deque から pop() しようとしました', ctx.loc); return q.pop(); },
  popleft: (q, _a, _k, ctx) => { if (!q.length) throw new PyError('IndexError', '空の deque から popleft() しようとしました', ctx.loc); return q.shift(); },
  rotate: (q, [n = 1]) => {
    if (!q.length) return null;
    const k = ((num(n) % q.length) + q.length) % q.length;
    q.unshift(...q.splice(q.length - k, k));
    return null;
  },
  copy: (q) => makeDeque(q, q.maxlen),
};

export const dequeRepr = (q, reprItem) => `deque([${q.map(reprItem).join(', ')}]${q.maxlen !== null ? `, maxlen=${q.maxlen}` : ''})`;

// ── collections モジュール ─────────────────────────────────────────────────────

export const CounterType = defType('Counter', (args, kwargs, ctx) => makeCounter(args[0], kwargs, ctx.loc));
export const DefaultDictType = defType('defaultdict', (args, kwargs, ctx) => {
  const d = makeDict();
  d.subtype = 'defaultdict';
  d.factory = args[0] ?? null;
  if (args[1] !== undefined) {
    const src = args[1];
    if (isDict(src)) for (const [k, v] of dictEntries(src)) dictSet(d, k, v, ctx.loc);
    else for (const kv of iterate(src, ctx.loc)) { const [k, v] = [...iterate(kv, ctx.loc)]; dictSet(d, k, v, ctx.loc); }
  }
  for (const [k, v] of Object.entries(kwargs)) dictSet(d, k, v, ctx.loc);
  return d;
});
export const DequeType = defType('deque', (args, kwargs, ctx) => {
  const maxlen = args[1] ?? kwargs.maxlen ?? null;
  return makeDeque(args[0] === undefined ? [] : [...iterate(args[0], ctx.loc)], maxlen === null ? null : num(maxlen));
});

export const makeCollectionsModule = () => ({ Counter: CounterType, defaultdict: DefaultDictType, deque: DequeType });

// ── copy ─────────────────────────────────────────────────────────────────────

/** 浅いコピー（入れ物だけ新しくし、中身は同じものを指す） */
export function shallowCopy(v) {
  if (isDeque(v)) return makeDeque(v, v.maxlen);
  if (isTuple(v)) return v;
  if (isSet(v)) return makeSet([...v]);
  if (Array.isArray(v)) return [...v];
  if (isDict(v)) {
    const d = makeDict(dictEntries(v));
    if (v.subtype) d.subtype = v.subtype;
    if ('factory' in v) d.factory = v.factory;
    return d;
  }
  if (isInstance(v) && !v.cls.builtin) {
    const c = makeInstance(v.cls);
    c.attrs = { ...v.attrs };
    return c;
  }
  return v;
}

/** 深いコピー（中身もたどってコピーする。同じものを 2 回指していれば、コピーでも同じものを指す） */
export function deepCopy(v, memo = new Map()) {
  if (v === null || typeof v !== 'object' || memo.has(v)) return memo.has(v) ? memo.get(v) : v;
  if (isTuple(v)) {
    const items = v.map(x => deepCopy(x, memo));
    const t = items.every((x, i) => x === v[i]) ? v : makeTuple(items);
    memo.set(v, t);
    return t;
  }
  if (isSet(v)) { const s = makeSet([]); memo.set(v, s); for (const x of v) s.push(deepCopy(x, memo)); return makeSet([...s]); }
  if (isDeque(v)) { const q = makeDeque([], v.maxlen); memo.set(v, q); for (const x of v) q.push(deepCopy(x, memo)); return q; }
  if (Array.isArray(v)) { const l = []; memo.set(v, l); for (const x of v) l.push(deepCopy(x, memo)); return l; }
  if (isDict(v)) {
    const d = makeDict();
    if (v.subtype) d.subtype = v.subtype;
    if ('factory' in v) d.factory = v.factory;
    memo.set(v, d);
    for (const [k, x] of dictEntries(v)) dictSet(d, deepCopy(k, memo), deepCopy(x, memo));
    return d;
  }
  if (isInstance(v) && !v.cls.builtin) {
    const c = makeInstance(v.cls);
    memo.set(v, c);
    c.attrs = Object.fromEntries(Object.entries(v.attrs).map(([k, x]) => [k, deepCopy(x, memo)]));
    return c;
  }
  return v;
}

export const makeCopyModule = () => ({
  copy: def('copy', ([v]) => shallowCopy(v)),
  deepcopy: def('deepcopy', ([v]) => deepCopy(v)),
});

// ── statistics ───────────────────────────────────────────────────────────────

export const StatisticsError = new PyClass('StatisticsError', [EXCEPTIONS.ValueError], {}, { builtin: true });
EXCEPTIONS.StatisticsError = StatisticsError;

/** 有理数（BigInt の分子・分母。分母は正）。CPython の statistics と同じく、正確な値で計算する */
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const frac = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return [n / g, d / g]; };
const fadd = ([a, b], [c, d]) => frac(a * d + c * b, b * d);
const fsub = ([a, b], [c, d]) => frac(a * d - c * b, b * d);
const fmul = ([a, b], [c, d]) => frac(a * c, b * d);
const fdiv = ([a, b], [c, d]) => frac(a * d, b * c);

/** 小数の正確な値（2 進の仮数と指数） */
function floatToFrac(x) {
  if (!Number.isFinite(x)) throw new PyError('ValueError', '有限でない数は statistics で使えません', null);
  if (Number.isInteger(x)) return [BigInt(x), 1n];
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const e = Number((bits >> 52n) & 0x7ffn);
  const m = bits & ((1n << 52n) - 1n);
  const mant = e === 0 ? m : m | (1n << 52n);
  const exp = (e === 0 ? -1074 : e - 1075);
  return exp >= 0 ? frac(sign * mant * (1n << BigInt(exp))) : frac(sign * mant, 1n << BigInt(-exp));
}
const toFrac = (v) => (isFloat(v) ? floatToFrac(v.v) : [BigInt(num(v)), 1n]);
/** 有理数を最も近い小数にする */
function fracToFloat([n, d]) {
  if (n === 0n) return 0;
  const neg = n < 0n; if (neg) n = -n;
  let shift = BigInt(n.toString(2).length - d.toString(2).length) - 60n;
  const q = shift >= 0n ? n / (d << shift) : (n << -shift) / d;
  const r = Number(q) * 2 ** Number(shift);
  return neg ? -r : r;
}

function statData(v, fname, loc, min = 1) {
  const data = [...iterate(v, loc)];
  if (data.length < min) {
    throw statError(min === 1 ? `${fname}() に空のデータが渡されました` : `${fname}() には少なくとも ${min} 個のデータが必要です`, loc);
  }
  for (const x of data) if (!isNum(x)) throw new PyError('TypeError', `statistics.${fname}() には数のデータが必要です（${typeName(x)} が含まれています）`, loc);
  return data;
}

/** StatisticsError（ValueError の派生） */
const statError = (msg, loc) => new PyError('StatisticsError', msg, loc);

/** 結果の型：データがすべて int で、結果が整数なら int、それ以外は float（CPython の _convert） */
const convert = (f, allInt) => (allInt && f[1] === 1n ? normInt(f[0]) : makeFloat(fracToFloat(f)));

function sumSq(data) {
  const fs = data.map(toFrac);
  const n = BigInt(fs.length);
  const mean = fdiv(fs.reduce(fadd, [0n, 1n]), [n, 1n]);
  return fs.reduce((s, x) => { const dlt = fsub(x, mean); return fadd(s, fmul(dlt, dlt)); }, [0n, 1n]);
}
/** 有理数の平方根を、最も近い小数で（CPython 3.12 の _float_sqrt_of_frac に近い精度） */
function sqrtFrac([n, d]) {
  if (n === 0n) return 0;
  const k = 120n;
  let x = (n << (2n * k)) / d, r = BigInt(Math.floor(Math.sqrt(Number(x))));
  if (r === 0n) r = 1n;
  for (let i = 0; i < 200; i++) { const next = (r + x / r) >> 1n; if (next >= r && next - r <= 1n) break; r = next; }
  while (r * r > x) r--;
  while ((r + 1n) * (r + 1n) <= x) r++;
  return fracToFloat([r, 1n << k]);
}

export const makeStatisticsModule = () => ({
  StatisticsError,
  mean: def('mean', ([v], _k, ctx) => {
    const data = statData(v, 'mean', ctx.loc);
    const total = data.map(toFrac).reduce(fadd, [0n, 1n]);
    return convert(fdiv(total, [BigInt(data.length), 1n]), data.every(x => isInt(x) || isBool(x)));
  }),
  fmean: def('fmean', ([v], _k, ctx) => {
    const data = statData(v, 'fmean', ctx.loc);
    return makeFloat(fracToFloat(fdiv(data.map(toFrac).reduce(fadd, [0n, 1n]), [BigInt(data.length), 1n])));
  }),
  median: def('median', ([v], _k, ctx) => {
    const data = statData(v, 'median', ctx.loc).sort((a, b) => pyCmp(a, b, '<', ctx.loc));
    const n = data.length, i = Math.floor(n / 2);
    if (n % 2 === 1) return data[i];
    return makeFloat((num(data[i - 1]) + num(data[i])) / 2);
  }),
  median_low: def('median_low', ([v], _k, ctx) => {
    const data = statData(v, 'median_low', ctx.loc).sort((a, b) => num(a) - num(b));
    const n = data.length;
    return n % 2 === 1 ? data[(n - 1) / 2] : data[n / 2 - 1];
  }),
  median_high: def('median_high', ([v], _k, ctx) => {
    const data = statData(v, 'median_high', ctx.loc).sort((a, b) => num(a) - num(b));
    return data[Math.floor(data.length / 2)];
  }),
  mode: def('mode', ([v], _k, ctx) => {
    const data = [...iterate(v, ctx.loc)];
    if (!data.length) throw statError('mode() に空のデータが渡されました', ctx.loc);
    const [[k]] = mostCommon(makeCounter(data, {}, ctx.loc));
    return k;
  }),
  multimode: def('multimode', ([v], _k, ctx) => {
    const all = mostCommon(makeCounter([...iterate(v, ctx.loc)], {}, ctx.loc));
    return all.filter(([, n]) => num(n) === num(all[0]?.[1] ?? 0)).map(([k]) => k);
  }),
  pvariance: def('pvariance', ([v], _k, ctx) => {
    const data = statData(v, 'pvariance', ctx.loc);
    return convert(fdiv(sumSq(data), [BigInt(data.length), 1n]), data.every(x => isInt(x) || isBool(x)));
  }),
  variance: def('variance', ([v], _k, ctx) => {
    const data = statData(v, 'variance', ctx.loc, 2);
    return convert(fdiv(sumSq(data), [BigInt(data.length - 1), 1n]), data.every(x => isInt(x) || isBool(x)));
  }),
  pstdev: def('pstdev', ([v], _k, ctx) => {
    const data = statData(v, 'pstdev', ctx.loc);
    return makeFloat(sqrtFrac(fdiv(sumSq(data), [BigInt(data.length), 1n])));
  }),
  stdev: def('stdev', ([v], _k, ctx) => {
    const data = statData(v, 'stdev', ctx.loc, 2);
    return makeFloat(sqrtFrac(fdiv(sumSq(data), [BigInt(data.length - 1), 1n])));
  }),
});

// ── string ───────────────────────────────────────────────────────────────────

export const makeStringModule = () => {
  const lower = 'abcdefghijklmnopqrstuvwxyz', upper = lower.toUpperCase(), digits = '0123456789';
  const punctuation = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', whitespace = ' \t\n\r\x0b\x0c';
  return {
    ascii_lowercase: lower, ascii_uppercase: upper, ascii_letters: lower + upper, digits,
    hexdigits: '0123456789abcdefABCDEF', octdigits: '01234567', punctuation, whitespace,
    printable: digits + lower + upper + punctuation + whitespace,
    capwords: def('capwords', ([s, sep = null]) => (sep === null ? s.split(/\s+/).filter(Boolean) : s.split(sep))
      .map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(sep ?? ' ')),
  };
};

