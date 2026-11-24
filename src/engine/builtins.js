/**
 * builtins.js — 組み込み関数とメソッド（Phase 0 スパイク）
 *
 * 組み込み関数は JS の関数 (args, kwargs, ctx) => value として表す。変数の環境（Environment）には入れず、
 * 名前の解決の最後（LEGB の B）でだけ参照するので、変数ビューに print や len が並ぶことはない。
 */
import {
  PyError, PyRange, makeFloat, makeTuple, makeDict, dictSet,
  isFloat, isInt, isBool, isNum, isStr, isTuple, isList, isDict, num, typeName,
  truthy, repr, str, pyEq, pyCmp, iterate,
} from './values.js';

const def = (name, fn) => { fn.pyName = name; return fn; };

function argCount(name, args, min, max, loc) {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min} 個` : `${min}〜${max} 個`;
    throw new PyError('TypeError', `${name}() の引数は ${want}ですが、${args.length} 個渡されました`, loc);
  }
}

function toInt(v, loc, what = 'int') {
  if (isInt(v) || isBool(v)) return num(v);
  throw new PyError('TypeError', `${what} には整数が必要です（${typeName(v)} が渡されました）`, loc);
}

/** 銀行家の丸め（Python の round と同じく、ちょうど半分なら偶数へ） */
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * round(x, n)：double の正確な 10 進展開（toFixed(100)）で丸める。CPython と同じく
 * round(2.675, 2) は 2.67（2.675 の実際の値は 2.67499…）、ちょうど半分なら偶数へ。
 */
function roundDigits(x, n) {
  if (!Number.isFinite(x)) return x;
  if (n < 0) { const p = 10 ** -n; return roundHalfEven(x / p) * p; }
  const neg = x < 0;
  const exact = Math.abs(x).toFixed(100);
  const [ip, fp] = exact.split('.');
  const keep = ip + fp.slice(0, n), rest = fp.slice(n);
  let digits = BigInt(keep);
  const half = rest[0] > '5' || (rest[0] === '5' && /[1-9]/.test(rest.slice(1)));
  const tie = rest[0] === '5' && !/[1-9]/.test(rest.slice(1));
  if (half || (tie && digits % 2n === 1n)) digits += 1n;
  const s = digits.toString().padStart(n + 1, '0');
  const v = Number(n > 0 ? `${s.slice(0, -n)}.${s.slice(-n)}` : s);
  return neg ? -v : v;
}

function sortItems(items, kwargs, ctx) {
  const keyFn = kwargs.key ?? null;
  const keyed = items.map(v => ({ v, k: keyFn === null ? v : ctx.call(keyFn, [v]) }));
  keyed.sort((a, b) => pyCmp(a.k, b.k, '<', ctx.loc));
  if (truthy(kwargs.reverse ?? false)) keyed.reverse();
  return keyed.map(x => x.v);
}

function minMax(name, sign) {
  return def(name, (args, kwargs, ctx) => {
    const items = args.length === 1 ? [...iterate(args[0], ctx.loc)] : args;
    if (items.length === 0) throw new PyError('ValueError', `${name}() に空の並びが渡されました`, ctx.loc);
    const keyFn = kwargs.key ?? null;
    let best = items[0], bestK = keyFn ? ctx.call(keyFn, [best]) : best;
    for (const v of items.slice(1)) {
      const k = keyFn ? ctx.call(keyFn, [v]) : v;
      if (sign * pyCmp(k, bestK, '<', ctx.loc) > 0) { best = v; bestK = k; }
    }
    return best;
  });
}

/**
 * f 文字列の書式指定（スパイク：[[fill]align][0][width][,][.precision][type] の主要部分）
 */
export function formatValue(v, spec, loc) {
  if (!spec) return str(v);
  const m = spec.match(/^(?:(.)?([<>^]))?(0)?(\d*)(,)?(?:\.(\d+))?([dfs%eg]?)$/);
  if (!m) throw new PyError('ValueError', `書式指定「${spec}」はまだ対応していません`, loc);
  const [, fill = ' ', align, zero, width, comma, prec, type] = m;
  let s;
  if (type === 'f' || type === '%' || (prec !== undefined && type === '' && isNum(v))) {
    if (!isNum(v)) throw new PyError('ValueError', `書式「${spec}」は数値にしか使えません`, loc);
    const x = num(v) * (type === '%' ? 100 : 1);
    s = x.toFixed(prec === undefined ? 6 : Number(prec)) + (type === '%' ? '%' : '');
  } else if (type === 'd') {
    if (!(isInt(v) || isBool(v))) throw new PyError('ValueError', `書式「d」は整数にしか使えません`, loc);
    s = String(num(v));
  } else if (type === 'e') {
    s = num(v).toExponential(prec === undefined ? 6 : Number(prec)).replace(/e([+-])(\d)$/, 'e$10$2');
  } else {
    s = str(v);
    if (prec !== undefined && isStr(v)) s = s.slice(0, Number(prec));
  }
  if (comma) s = s.replace(/^(-?\d+)/, (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  const w = Number(width || 0);
  if (s.length >= w) return s;
  const pad = w - s.length;
  const a = align ?? (zero ? '=' : isNum(v) ? '>' : '<');
  if (a === '=') return s.startsWith('-') ? '-' + '0'.repeat(pad) + s.slice(1) : (zero ? '0' : fill).repeat(pad) + s;
  if (a === '>') return fill.repeat(pad) + s;
  if (a === '<') return s + fill.repeat(pad);
  return fill.repeat(Math.floor(pad / 2)) + s + fill.repeat(Math.ceil(pad / 2));
}

export const BUILTINS = {
  print: def('print', (args, kwargs, ctx) => {
    const sep = kwargs.sep ?? ' ';
    const end = kwargs.end ?? '\n';
    const text = args.map(str).join(sep === null ? ' ' : sep) + (end === null ? '\n' : end);
    ctx.rt.recorder?.write(text);   // 改行のない出力も断片として記録する（joinConsoleLines で行にまとめられる）
    return null;
  }),
  len: def('len', (args, _k, ctx) => {
    argCount('len', args, 1, 1, ctx.loc);
    const v = args[0];
    if (isStr(v) || Array.isArray(v)) return v.length;
    if (isDict(v)) return Object.keys(v).length;
    if (v instanceof PyRange) return v.length;
    throw new PyError('TypeError', `${typeName(v)} には len() を使えません`, ctx.loc);
  }),
  range: def('range', (args, _k, ctx) => {
    argCount('range', args, 1, 3, ctx.loc);
    const n = args.map(a => toInt(a, ctx.loc, 'range()'));
    if (n.length === 1) return new PyRange(0, n[0], 1);
    if (n[2] === 0) throw new PyError('ValueError', 'range() の step に 0 は使えません', ctx.loc);
    return new PyRange(n[0], n[1], n[2] ?? 1);
  }),
  abs: def('abs', (args, _k, ctx) => {
    argCount('abs', args, 1, 1, ctx.loc);
    if (!isNum(args[0])) throw new PyError('TypeError', `${typeName(args[0])} には abs() を使えません`, ctx.loc);
    return isFloat(args[0]) ? makeFloat(Math.abs(args[0].v)) : Math.abs(num(args[0]));
  }),
  min: minMax('min', -1),
  max: minMax('max', 1),
  sum: def('sum', (args, _k, ctx) => {
    argCount('sum', args, 1, 2, ctx.loc);
    let acc = args[1] ?? 0, isF = isFloat(acc);
    let total = num(acc);
    for (const v of iterate(args[0], ctx.loc)) {
      if (!isNum(v)) throw new PyError('TypeError', `sum() は数値の並びにしか使えません（${typeName(v)} が含まれています）`, ctx.loc);
      total += num(v); isF = isF || isFloat(v);
    }
    return isF ? makeFloat(total) : total;
  }),
  sorted: def('sorted', (args, kwargs, ctx) => {
    argCount('sorted', args, 1, 1, ctx.loc);
    return sortItems([...iterate(args[0], ctx.loc)], kwargs, ctx);
  }),
  reversed: def('reversed', (args, _k, ctx) => [...iterate(args[0], ctx.loc)].reverse()),
  enumerate: def('enumerate', (args, kwargs, ctx) => {
    const start = num(args[1] ?? kwargs.start ?? 0);
    return [...iterate(args[0], ctx.loc)].map((v, i) => makeTuple([i + start, v]));
  }),
  zip: def('zip', (args, _k, ctx) => {
    const lists = args.map(a => [...iterate(a, ctx.loc)]);
    const n = Math.min(...lists.map(l => l.length));
    return Array.from({ length: lists.length ? n : 0 }, (_, i) => makeTuple(lists.map(l => l[i])));
  }),
  str:  def('str', (args) => (args.length ? str(args[0]) : '')),
  repr: def('repr', (args) => repr(args[0])),
  bool: def('bool', (args) => (args.length ? truthy(args[0]) : false)),
  int: def('int', (args, _k, ctx) => {
    if (!args.length) return 0;
    const v = args[0];
    if (isInt(v) || isBool(v)) return num(v);
    if (isFloat(v)) return Math.trunc(v.v);
    if (isStr(v) && /^\s*[+-]?\d+\s*$/.test(v.replace(/_/g, ''))) return parseInt(v.replace(/_/g, ''), 10);
    throw new PyError('ValueError', `${repr(v)} は整数に変換できません`, ctx.loc);
  }),
  float: def('float', (args, _k, ctx) => {
    if (!args.length) return makeFloat(0);
    const v = args[0];
    if (isNum(v)) return makeFloat(num(v));
    if (isStr(v) && v.trim() !== '' && !Number.isNaN(Number(v))) return makeFloat(Number(v));
    throw new PyError('ValueError', `${repr(v)} は小数に変換できません`, ctx.loc);
  }),
  list:  def('list', (args, _k, ctx) => (args.length ? [...iterate(args[0], ctx.loc)] : [])),
  tuple: def('tuple', (args, _k, ctx) => makeTuple(args.length ? [...iterate(args[0], ctx.loc)] : [])),
  dict:  def('dict', (args, kwargs) => makeDict(Object.entries(kwargs))),
  round: def('round', (args, _k, ctx) => {
    argCount('round', args, 1, 2, ctx.loc);
    const x = num(args[0]);
    if (args.length === 1 || args[1] === null) return roundHalfEven(x);
    const r = roundDigits(x, toInt(args[1], ctx.loc));
    return isInt(args[0]) ? r : makeFloat(r);
  }),
  chr: def('chr', (args, _k, ctx) => String.fromCodePoint(toInt(args[0], ctx.loc, 'chr()'))),
  ord: def('ord', (args, _k, ctx) => {
    if (!isStr(args[0]) || [...args[0]].length !== 1) throw new PyError('TypeError', 'ord() には 1 文字の文字列が必要です', ctx.loc);
    return args[0].codePointAt(0);
  }),
  input: def('input', (_a, _k, ctx) => {
    throw new PyError('NotImplemented', 'input() はまだ対応していません（入力をあらかじめ与える方式を Phase 5 で検討）', ctx.loc);
  }),
};

// ── メソッド ────────────────────────────────────────────────────────────────

const LIST_METHODS = {
  append: (l, [x]) => { l.push(x); return null; },
  extend: (l, [it], _k, ctx) => { l.push(...iterate(it, ctx.loc)); return null; },
  insert: (l, [i, x]) => {
    const n = l.length; let k = num(i); if (k < 0) k = Math.max(0, k + n); l.splice(Math.min(k, n), 0, x); return null;
  },
  pop: (l, args, _k, ctx) => {
    if (l.length === 0) throw new PyError('IndexError', '空のリストから pop() しようとしました', ctx.loc);
    let i = args.length ? num(args[0]) : l.length - 1;
    if (i < 0) i += l.length;
    if (i < 0 || i >= l.length) throw new PyError('IndexError', `pop() の位置 ${num(args[0])} がリストの範囲外です`, ctx.loc);
    return l.splice(i, 1)[0];
  },
  remove: (l, [x], _k, ctx) => {
    const i = l.findIndex(v => pyEq(v, x));
    if (i < 0) throw new PyError('ValueError', `リストに ${repr(x)} がありません`, ctx.loc);
    l.splice(i, 1); return null;
  },
  index: (l, [x], _k, ctx) => {
    const i = l.findIndex(v => pyEq(v, x));
    if (i < 0) throw new PyError('ValueError', `${repr(x)} はリストにありません`, ctx.loc);
    return i;
  },
  count: (l, [x]) => l.filter(v => pyEq(v, x)).length,
  sort: (l, _a, kwargs, ctx) => { const s = sortItems([...l], kwargs, ctx); l.splice(0, l.length, ...s); return null; },
  reverse: (l) => { l.reverse(); return null; },
  copy: (l) => [...l],
  clear: (l) => { l.length = 0; return null; },
};

const STR_METHODS = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  strip: (s, [c]) => (c == null ? s.trim() : s.replace(new RegExp(`^[${escRe(c)}]+|[${escRe(c)}]+$`, 'g'), '')),
  lstrip: (s) => s.trimStart(),
  rstrip: (s) => s.trimEnd(),
  split: (s, [sep], kwargs) => {
    sep = sep ?? kwargs.sep ?? null;
    if (sep === null) return s.trim() === '' ? [] : s.trim().split(/\s+/);
    return s.split(sep);
  },
  join: (s, [it], _k, ctx) => {
    const items = [...iterate(it, ctx.loc)];
    const bad = items.find(x => !isStr(x));
    if (bad !== undefined) throw new PyError('TypeError', `join() に文字列でない値（${typeName(bad)}）が含まれています`, ctx.loc);
    return items.join(s);
  },
  replace: (s, [a, b]) => s.split(a).join(b),
  find: (s, [x]) => s.indexOf(x),
  count: (s, [x]) => (x === '' ? s.length + 1 : s.split(x).length - 1),
  startswith: (s, [x]) => s.startsWith(x),
  endswith: (s, [x]) => s.endsWith(x),
  isdigit: (s) => s.length > 0 && /^\d+$/.test(s),
  isalpha: (s) => s.length > 0 && /^\p{L}+$/u.test(s),
};

const DICT_METHODS = {
  get: (d, [k, dflt = null]) => (isStr(k) && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : dflt),
  keys: (d) => Object.keys(d),
  values: (d) => Object.values(d),
  items: (d) => Object.keys(d).map(k => makeTuple([k, d[k]])),
  pop: (d, [k, ...rest], _k, ctx) => {
    if (isStr(k) && Object.prototype.hasOwnProperty.call(d, k)) { const v = d[k]; delete d[k]; return v; }
    if (rest.length) return rest[0];
    throw new PyError('KeyError', `辞書にキー ${repr(k)} がありません`, ctx.loc);
  },
  update: (d, [other]) => { for (const k of Object.keys(other)) dictSet(d, k, other[k]); return null; },
};

function escRe(s) { return s.replace(/[\]\\^-]/g, '\\$&'); }

/** obj.name を取り出す（スパイクではメソッドだけ。呼び出し可能な JS 関数を返す） */
export function getAttr(obj, name, loc) {
  const table = isList(obj) ? LIST_METHODS : isStr(obj) ? STR_METHODS : isDict(obj) ? DICT_METHODS
    : isTuple(obj) ? { index: LIST_METHODS.index, count: LIST_METHODS.count } : null;
  const m = table && Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
  if (!m) throw new PyError('AttributeError', `${typeName(obj)} に ${name} という属性はありません`, loc);
  return def(`${typeName(obj)}.${name}`, (args, kwargs, ctx) => m(obj, args, kwargs, ctx));
}
