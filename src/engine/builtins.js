/**
 * builtins.js — 組み込み関数とメソッド（Phase 0 スパイク）
 *
 * 組み込み関数は JS の関数 (args, kwargs, ctx) => value として表す。変数の環境（Environment）には入れず、
 * 名前の解決の最後（LEGB の B）でだけ参照するので、変数ビューに print や len が並ぶことはない。
 */
import {
  PyError, PyRange, makeFloat, makeTuple, makeDict, dictSet, dictGet, dictHas, dictDelete, dictEntries,
  intOp, normInt, makeSet, setAdd, setHas, setDiscard, isSet, NOT_IMPLEMENTED,
  isFloat, isInt, isBool, isNum, isStr, isTuple, isList, isDict, num, typeName,
  truthy, repr, str, pyEq, pyCmp, richCompare, iterate, PyIterator,
} from './values.js';

import {
  ObjectClass, EXCEPTIONS, isClass, isInstance, classLookup, callSpecial, makeException, PyRaise,
  invoke, isStaticMethod, isClassMethod, isProperty, makeProperty,
} from './objects.js';
import { isModule } from './modules.js';

const def = (name, fn) => { fn.pyName = name; return fn; };
/** 組み込みの型（int・str など）。isinstance の型に使え、repr は <class 'int'> */
const defType = (name, fn) => { def(name, fn); fn.isType = true; return fn; };

/** 組み込みの型の名前 → その型の値か */
const TYPE_TESTS = {
  int: (v) => isInt(v) || isBool(v), bool: isBool, float: isFloat, str: isStr,
  list: isList, tuple: isTuple, dict: isDict, set: isSet, object: () => true,
};

/** isinstance(v, t)。t はクラス・組み込みの型・それらのタプル */
function isInstanceOf(v, t, loc) {
  if (isTuple(t)) return t.some(x => isInstanceOf(v, x, loc));
  if (isClass(t)) {
    if (t === ObjectClass) return true;
    return isInstance(v) && v.cls.mro.includes(t);
  }
  if (typeof t === 'function' && t.isType) return TYPE_TESTS[t.pyName]?.(v) ?? false;
  throw new PyError('TypeError', 'isinstance() の 2 番目の引数は、クラスか型（またはそのタプル）です', loc);
}

function argCount(name, args, min, max, loc) {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min} 個` : `${min}〜${max} 個`;
    throw new PyError('TypeError', `${name}() の引数は ${want}ですが、${args.length} 個渡されました`, loc);
  }
}

/** 位置や個数に使う int を JS の number で取り出す（大きすぎる値は近似になるが、範囲外として扱われる） */
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
      // CPython と同じく、max は「k > 最大」、min は「k < 最小」で比べる
      if (richCompare(k, bestK, sign > 0 ? '>' : '<', ctx.loc)) { best = v; bestK = k; }
    }
    return best;
  });
}

/**
 * 書式指定（f 文字列・format()・str.format）。CPython の文法 [[fill]align][sign][#][0][width][grouping][.precision][type]
 * の主要部分（type：b c d e E f F g G n o s x X %。ADR-011 で整理）
 */
// ── 小数の正確な丸め（CPython と同じく、2 進の正確な値を偶数への丸めで 10 進にする。ADR-011） ──

/** 有限の x ≥ 0 を、x = m × 2^e（m・e は BigInt）に分ける */
function decompose(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  return expBits === 0 ? { m: frac, e: -1074n } : { m: frac | (1n << 52n), e: BigInt(expBits - 1075) };
}

/** round(x × 10^k) を偶数への丸めで正確に求める（x ≥ 0、k は負でもよい） */
function scaledRound(x, k) {
  const { m, e } = decompose(x);
  let num = m, den = 1n;
  if (e >= 0n) num <<= e; else den <<= -e;
  if (k >= 0) num *= 10n ** BigInt(k); else den *= 10n ** BigInt(-k);
  const q = num / den, r2 = (num % den) * 2n;
  return r2 > den || (r2 === den && q % 2n === 1n) ? q + 1n : q;
}

/** 固定小数点で小数 p 桁（x ≥ 0） */
function toFixedEven(x, p) {
  const n = scaledRound(x, p).toString().padStart(p + 1, '0');
  return p > 0 ? `${n.slice(0, -p)}.${n.slice(-p)}` : n;
}

/** 指数表記で小数 p 桁（x ≥ 0）。指数は 2 桁以上（1.50e+02） */
function toExpEven(x, p) {
  if (x === 0) return `${(0).toFixed(p)}e+00`;
  let e10 = Math.floor(Math.log10(x));
  let n = scaledRound(x, p - e10);
  if (n >= 10n ** BigInt(p + 1)) { e10++; n = scaledRound(x, p - e10); }
  else if (n < 10n ** BigInt(p)) { e10--; n = scaledRound(x, p - e10); }
  const d = n.toString();
  const mant = p > 0 ? `${d[0]}.${d.slice(1)}` : d;
  return `${mant}e${e10 < 0 ? '-' : '+'}${String(Math.abs(e10)).padStart(2, '0')}`;
}

export function formatValue(v, spec, loc) {
  if (!spec) return str(v);
  const m = spec.match(/^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d*)([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%]?)$/s);
  if (!m) throw new PyError('ValueError', `書式指定「${spec}」はまだ対応していません`, loc);
  const [, fill0, align0, sign0, alt, zero, width, grouping, prec, type] = m;
  const sign = sign0 ?? '-';
  const p = prec === undefined ? undefined : Number(prec);
  const isNumber = isNum(v);
  if (!isNumber && (sign0 || grouping || align0 === '=' || alt)) {
    throw new PyError('ValueError', `書式「${spec}」の符号・桁区切り・= ・# は数値にしか使えません`, loc);
  }
  let body, prefix = '', negative = false;
  if (type === 's' || (type === '' && !isNumber)) {
    if (type === 's' && !isStr(v)) throw new PyError('ValueError', `書式「${spec}」は数値には使えません`, loc);
    body = str(v);
    if (p !== undefined) body = [...body].slice(0, p).join('');
  } else if ('bcdoxX'.includes(type) && type !== '' || ((type === '' || type === 'n') && (isInt(v) || isBool(v)))) {
    if (!(isInt(v) || isBool(v))) throw new PyError('ValueError', `書式「${type}」は整数にしか使えません`, loc);
    if (p !== undefined) throw new PyError('ValueError', `整数の書式に精度（.${p}）は指定できません`, loc);
    const b = BigInt(isBool(v) ? num(v) : v);
    negative = b < 0n;
    const a = negative ? -b : b;
    if (type === 'c') {
      if (negative || a > 0x10FFFFn) throw new PyError('OverflowError', `書式「c」に使える文字の番号の範囲外です（${b}）`, loc);
      body = String.fromCodePoint(Number(a));
    }
    else {
      const base = { b: 2, o: 8, x: 16, X: 16 }[type] ?? 10;
      body = a.toString(base);
      if (type === 'X') body = body.toUpperCase();
      if (alt && base !== 10) prefix = { 2: '0b', 8: '0o', 16: type === 'X' ? '0X' : '0x' }[base];
    }
  } else {
    if (!isNumber) throw new PyError('ValueError', `書式「${spec}」は数値にしか使えません`, loc);
    let x = num(v) * (type === '%' ? 100 : 1);
    negative = x < 0 || Object.is(x, -0);
    x = Math.abs(x);
    const t = type === '' || type === 'n' ? 'g' : type;
    if (!Number.isFinite(x)) body = Number.isNaN(x) ? 'nan' : 'inf';
    else if ('fF%'.includes(t)) body = toFixedEven(x, p ?? 6);
    else if ('eE'.includes(t)) body = toExpEven(x, p ?? 6);
    else {   // g・G・型なし（型なしは、精度がなければ str と同じ）
      if (type === '' && p === undefined) body = str(makeFloat(x));
      else {
        const P = p === undefined ? 6 : Math.max(p, 1);
        const exp = x === 0 ? 0 : Number(toExpEven(x, P - 1).split('e')[1]);
        // 型なしは、指数が精度 − 1 以上なら指数表記（100.0 を .3 → 1e+02）。g は精度以上で指数表記
        if (exp >= -4 && exp < (type === '' ? P - 1 : P)) {
          body = toFixedEven(x, Math.max(P - 1 - exp, 0));
          if (!alt) body = body.includes('.') ? body.replace(/\.?0+$/, '') : body;
          else if (!body.includes('.')) body += '.';
          if (type === '' && !body.includes('.') && !alt) body += '.0';
        } else {
          body = toExpEven(x, P - 1);
          if (!alt) body = body.replace(/\.?0+e/, 'e');
        }
      }
    }
    if ('EFG'.includes(t)) body = body.toUpperCase();
    if (t === '%') body += '%';
  }
  if (grouping && type !== 'c' && !(type === '' && !isNumber) && type !== 's') {
    const every = 'boxX'.includes(type) && type !== '' ? 4 : 3;
    body = body.replace(/^([0-9a-fA-F]+)/, (d) => d.replace(new RegExp(`\\B(?=([0-9a-fA-F]{${every}})+(?![0-9a-fA-F]))`, 'g'), grouping));
  }
  const signStr = isNumber && type !== 'c' && type !== 's' ? (negative ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '') : '';
  const w = Number(width || 0);
  const align = align0 ?? (zero && isNumber ? '=' : isNumber ? '>' : '<');
  const fill = fill0 ?? (zero && !align0 ? '0' : ' ');
  const core = signStr + prefix + body;
  const n = Math.max(0, w - [...core].length);
  if (align === '=') return signStr + prefix + fill.repeat(n) + body;
  if (align === '>') return fill.repeat(n) + core;
  if (align === '<') return core + fill.repeat(n);
  return fill.repeat(Math.floor(n / 2)) + core + fill.repeat(Math.ceil(n / 2));
}

/**
 * 文字列の % 書式（printf 形式）。fmt % args。
 * 対応：%[-+ 0][幅][.精度](d i s r f F e E g G x X o c %)。%(名前)s の形は未対応。
 */
export function percentFormat(fmt, args, loc) {
  const list = isTuple(args) ? [...args] : [args];
  let k = 0;
  const next = () => {
    if (k >= list.length) throw new PyError('TypeError', '% 書式に対して値が足りません', loc);
    return list[k++];
  };
  const out = fmt.replace(/%(\([^)]*\))?([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXeEfFgGcrsa%])/g, (all, key, flags, width, prec, type) => {
    if (key) throw new PyError('NotImplemented', '%(名前)s の形の書式はまだ対応していません', loc);
    if (type === '%') return '%';
    if (width === '*') width = String(num(next()));
    if (prec === '*') prec = String(num(next()));
    const v = next();
    let s;
    switch (type) {
      case 'd': case 'i': case 'u':
        if (!isNum(v)) throw new PyError('TypeError', `%${type} には数が必要です（${typeName(v)} が渡されました）`, loc);
        s = String(isFloat(v) ? Math.trunc(v.v) : num(v) === v ? v : num(v));
        if (typeof v === 'bigint') s = String(v);
        break;
      case 'x': case 'X': case 'o': {
        if (!(isInt(v) || isBool(v))) throw new PyError('TypeError', `%${type} には整数が必要です（${typeName(v)} が渡されました）`, loc);
        const b = BigInt(isBool(v) ? num(v) : v);
        s = (b < 0n ? '-' : '') + (b < 0n ? -b : b).toString(type === 'o' ? 8 : 16);
        if (type === 'X') s = s.toUpperCase();
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        if (!isNum(v)) throw new PyError('TypeError', `%${type} には数が必要です（${typeName(v)} が渡されました）`, loc);
        const p = prec === undefined ? 6 : Number(prec);
        const x = num(v);
        if (type === 'f' || type === 'F') s = x.toFixed(p);
        else if (type === 'e' || type === 'E') s = x.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
        else s = String(Number(x.toPrecision(p || 1)));
        if (type === 'E' || type === 'G') s = s.toUpperCase();
        break;
      }
      case 'c': s = isStr(v) ? v : String.fromCodePoint(num(v)); break;
      case 'r': case 'a': s = repr(v); break;
      default: s = str(v); if (prec !== undefined) s = s.slice(0, Number(prec));
    }
    if (/[+ ]/.test(flags) && /^[\d]/.test(s) && 'diueEfFgG'.includes(type)) s = (flags.includes('+') ? '+' : ' ') + s;
    const w = Number(width ?? 0);
    if (s.length < w) {
      if (flags.includes('-')) s = s.padEnd(w);
      else if (flags.includes('0') && 'diuxXoeEfFgG'.includes(type)) s = (s[0] === '-' || s[0] === '+' ? s[0] + s.slice(1).padStart(w - 1, '0') : s.padStart(w, '0'));
      else s = s.padStart(w);
    }
    return s;
  });
  if (k < list.length && isTuple(args)) throw new PyError('TypeError', '% 書式に対して値が多すぎます', loc);
  return out;
}


// ── ADR-011 で足した組み込み関数の部品 ─────────────────────────────────────────

/** int("ff", 16)。基数 0 は接頭辞（0x・0o・0b）から決める */
function parseIntBase(s, base, loc) {
  let t = s.trim().replace(/_/g, '').toLowerCase();
  const neg = t.startsWith('-');
  if (t[0] === '-' || t[0] === '+') t = t.slice(1);
  const prefixes = { 16: '0x', 8: '0o', 2: '0b' };
  if (base === 0) {
    const p = Object.entries(prefixes).find(([, pre]) => t.startsWith(pre));
    base = p ? Number(p[0]) : 10;
  }
  if (prefixes[base] && t.startsWith(prefixes[base])) t = t.slice(2);
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
  if (base < 2 || base > 36 || t === '' || [...t].some(ch => !digits.includes(ch))) {
    throw new PyError('ValueError', `${repr(s)} は ${base} 進数の整数に変換できません`, loc);
  }
  let r = 0n;
  for (const ch of t) r = r * BigInt(base) + BigInt(digits.indexOf(ch));
  return normInt(neg ? -r : r);
}

/** a の mod m での逆元（なければ null） */
function modInverse(a, m) {
  let [r0, r1, s0, s1] = [a, m, 1n, 0n];
  while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return r0 === 1n ? ((s0 % m) + m) % m : null;
}

/** hex()・bin()・oct() */
function radix(v, base, prefix, loc) {
  if (!(isInt(v) || isBool(v))) throw new PyError('TypeError', `${typeName(v)} には整数が必要です（${typeName(v)} が渡されました）`, loc);
  const b = BigInt(isBool(v) ? num(v) : v);
  return (b < 0n ? '-' : '') + prefix + (b < 0n ? -b : b).toString(base);
}

/** id()：オブジェクトごとに決まった番号（実行ごとに同じ。CPython のアドレスとは違う） */
const ids = new WeakMap();
const primitiveIds = new Map();
let nextId = 0;
function objectId(v) {
  const isObj = v !== null && (typeof v === 'object' || typeof v === 'function');
  const table = isObj ? ids : primitiveIds;
  const key = isObj ? v : `${typeof v}:${String(v)}`;
  if (!table.has(key)) table.set(key, 4_300_000_000 + 16 * nextId++);
  return table.get(key);
}

/** hash()：int・bool・整数の float は CPython と同じ値。変更できる値は TypeError */
function pyHash(v, loc) {
  if (isList(v) || isDict(v) || isSet(v)) throw new PyError('TypeError', `${typeName(v)} は辞書のキーに使えません（unhashable type: '${typeName(v)}'）`, loc);
  if (isBool(v)) return num(v);
  if (isInt(v)) {
    const M = (1n << 61n) - 1n;
    const b = BigInt(v);
    const h = (b < 0n ? -((-b) % M) : b % M);
    return normInt(h === -1n ? -2n : h);
  }
  if (isFloat(v) && Number.isInteger(v.v)) return pyHash(normInt(BigInt(v.v)), loc);
  const s = repr(v);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** exit()・quit()：SystemExit を送出する（捕まえられなければ、そこで実行を終える） */
function exitProgram(args, ctx) {
  const exc = makeException(EXCEPTIONS.SystemExit, args.length ? [args[0]] : []);
  throw new PyRaise(exc, ctx.loc, 'SystemExit');
}

/** "{} {name} {0:.2f} {!r}".format(...)（ADR-011） */
function strFormat(fmt, args, kwargs, loc) {
  let auto = 0;
  return fmt.replace(/\{\{|\}\}|\{([^{}!:]*)(?:!([rsa]))?(?::([^{}]*))?\}/g, (all, field, conv, spec) => {
    if (all === '{{') return '{';
    if (all === '}}') return '}';
    const m = field.match(/^([^.[]*)(.*)$/);
    const head = m[1];
    let v;
    if (head === '') v = args[auto++];
    else if (/^\d+$/.test(head)) v = args[Number(head)];
    else {
      if (!Object.prototype.hasOwnProperty.call(kwargs, head)) throw new PyError('KeyError', `書式の名前 ${repr(head)} に対応する引数がありません`, loc);
      v = kwargs[head];
    }
    if (v === undefined) throw new PyError('IndexError', `書式の {} に対して引数が足りません`, loc);
    for (const [, attr, key] of m[2].matchAll(/\.(\w+)|\[([^\]]*)\]/g)) {
      v = attr !== undefined ? getAttr(v, attr, loc) : (isDict(v) ? dictGet(v, /^\d+$/.test(key) ? Number(key) : key, loc) : v[Number(key)]);
    }
    if (conv === 'r' || conv === 'a') v = repr(v); else if (conv === 's') v = str(v);
    return formatValue(v, spec ?? '', loc);
  });
}

const wordTitle = (s) => s.replace(/[A-Za-zÀ-￿]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
const stripChars = (c) => `[${escRe(c)}]`;
const padTo = (s, w, fill, where) => {
  const n = Math.max(0, w - [...s].length);
  if (where === 'left') return fill.repeat(n) + s;
  if (where === 'right') return s + fill.repeat(n);
  // center：CPython と同じく、余りが奇数なら幅が奇数のときに左を多くする
  const left = Math.floor(n / 2) + (n & w & 1);
  return fill.repeat(left) + s + fill.repeat(n - left);
};
const prefixMatch = (s, x, fn) => (isTuple(x) ? x.some(p => fn(s, p)) : fn(s, x));

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
    if (isInstance(v)) {
      const n = callSpecial(v, '__len__');
      if (n !== undefined) return n;
    }
    if (isStr(v) || Array.isArray(v)) return v.length;
    if (isDict(v)) return v.keys.length;
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
    return isFloat(args[0]) ? makeFloat(Math.abs(args[0].v)) : (num(args[0]) < 0 ? intOp('-', 0, args[0]) : intOp('+', 0, args[0]));
  }),
  min: minMax('min', -1),
  max: minMax('max', 1),
  sum: def('sum', (args, _k, ctx) => {
    argCount('sum', args, 1, 2, ctx.loc);
    let acc = args[1] ?? 0;
    for (const v of iterate(args[0], ctx.loc)) {
      if (!isNum(v)) throw new PyError('TypeError', `sum() は数値の並びにしか使えません（${typeName(v)} が含まれています）`, ctx.loc);
      acc = isFloat(acc) || isFloat(v) ? makeFloat(num(acc) + num(v)) : intOp('+', acc, v);
    }
    return acc;
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
  str:  defType('str', (args) => (args.length ? str(args[0]) : '')),
  repr: def('repr', (args) => repr(args[0])),
  bool: defType('bool', (args) => (args.length ? truthy(args[0]) : false)),
  int: defType('int', (args, _k, ctx) => {
    if (!args.length) return 0;
    const v = args[0];
    if (isBool(v)) return num(v);
    if (isInt(v)) return v;
    if (isFloat(v)) {
      if (!Number.isFinite(v.v)) throw new PyError('ValueError', `${repr(v)} は整数に変換できません`, ctx.loc);
      return normInt(BigInt(Math.trunc(v.v)));
    }
    if (isStr(v) && args.length > 1) return parseIntBase(v, toInt(args[1], ctx.loc), ctx.loc);   // int("ff", 16)（ADR-011）
    if (isStr(v) && /^\s*[+-]?\d+\s*$/.test(v.replace(/_/g, ''))) return normInt(BigInt(v.replace(/_/g, '').trim()));
    throw new PyError('ValueError', `${repr(v)} は整数に変換できません`, ctx.loc);
  }),
  float: defType('float', (args, _k, ctx) => {
    if (!args.length) return makeFloat(0);
    const v = args[0];
    if (isNum(v)) return makeFloat(num(v));
    if (isStr(v) && v.trim() !== '' && !Number.isNaN(Number(v))) return makeFloat(Number(v));
    throw new PyError('ValueError', `${repr(v)} は小数に変換できません`, ctx.loc);
  }),
  list:  defType('list', (args, _k, ctx) => (args.length ? [...iterate(args[0], ctx.loc)] : [])),
  tuple: defType('tuple', (args, _k, ctx) => makeTuple(args.length ? [...iterate(args[0], ctx.loc)] : [])),
  set:   defType('set', (args, _k, ctx) => makeSet(args.length ? [...iterate(args[0], ctx.loc)] : [], ctx.loc)),
  dict:  defType('dict', (args, kwargs, ctx) => {
    const d = makeDict();
    if (args.length) {
      if (isDict(args[0])) dictEntries(args[0]).forEach(([k, v]) => dictSet(d, k, v, ctx.loc));
      else {
        for (const pair of iterate(args[0], ctx.loc)) {
          const kv = [...iterate(pair, ctx.loc)];
          if (kv.length !== 2) throw new PyError('ValueError', 'dict() の要素は (キー, 値) の 2 つ組でなければなりません', ctx.loc);
          dictSet(d, kv[0], kv[1], ctx.loc);
        }
      }
    }
    for (const [k, v] of Object.entries(kwargs)) dictSet(d, k, v, ctx.loc);
    return d;
  }),
  round: def('round', (args, _k, ctx) => {
    argCount('round', args, 1, 2, ctx.loc);
    if ((isInt(args[0]) || isBool(args[0])) && (args.length === 1 || args[1] === null)) return intOp('+', 0, args[0]);
    const x = num(args[0]);
    if (args.length === 1 || args[1] === null) return normInt(roundHalfEven(x));
    const r = roundDigits(x, toInt(args[1], ctx.loc));
    return isInt(args[0]) ? r : makeFloat(r);
  }),
  chr: def('chr', (args, _k, ctx) => String.fromCodePoint(toInt(args[0], ctx.loc, 'chr()'))),
  ord: def('ord', (args, _k, ctx) => {
    if (!isStr(args[0]) || [...args[0]].length !== 1) throw new PyError('TypeError', 'ord() には 1 文字の文字列が必要です', ctx.loc);
    return args[0].codePointAt(0);
  }),
  object: ObjectClass,
  ...EXCEPTIONS,
  NotImplemented: NOT_IMPLEMENTED,
  isinstance: def('isinstance', (args, _k, ctx) => { argCount('isinstance', args, 2, 2, ctx.loc); return isInstanceOf(args[0], args[1], ctx.loc); }),
  issubclass: def('issubclass', (args, _k, ctx) => {
    argCount('issubclass', args, 2, 2, ctx.loc);
    const [c, t] = args;
    if (!isClass(c)) throw new PyError('TypeError', 'issubclass() の最初の引数はクラスです', ctx.loc);
    return (isTuple(t) ? [...t] : [t]).some(x => isClass(x) && c.mro.includes(x));
  }),
  type: def('type', (args, _k, ctx) => {
    argCount('type', args, 1, 1, ctx.loc);
    const v = args[0];
    if (isInstance(v)) return v.cls;
    const tn = typeName(v);
    return BUILTINS[tn]?.isType ? BUILTINS[tn] : defType(tn, () => { throw new PyError('TypeError', `${tn} は呼び出せません`, ctx.loc); });
  }),
  super: def('super', (args, _k, ctx) => {
    if (args.length === 2) return { __type__: 'PySuper', cls: args[0], self: args[1] };
    let e = ctx.env;
    while (e && !e.fn) e = e.parent;
    const fn = e?.fn;
    if (!fn?.ownerClass) throw new PyError('RuntimeError', 'super() は、クラスの中で定義したメソッドの中で使います', ctx.loc);
    const first = fn.paramSpec[0];
    if (!first) throw new PyError('RuntimeError', 'super() を使うメソッドには self の引数が必要です', ctx.loc);
    return { __type__: 'PySuper', cls: fn.ownerClass, self: e.bindings.get(first.name) };
  }),
  hasattr: def('hasattr', (args, _k, ctx) => {
    try { getAttr(args[0], args[1], ctx.loc); return true; } catch (e) { if (e instanceof PyError && e.pyType === 'AttributeError') return false; throw e; }
  }),
  getattr: def('getattr', (args, _k, ctx) => {
    try { return getAttr(args[0], args[1], ctx.loc); } catch (e) {
      if (args.length > 2 && e instanceof PyError && e.pyType === 'AttributeError') return args[2];
      throw e;
    }
  }),
  setattr: def('setattr', (args, _k, ctx) => { setAttr(args[0], args[1], args[2], ctx.loc); return null; }),
  // input()：画面の入力欄に書いた行を 1 行ずつ読む（ADR-007）。端末と同じく、プロンプトの後に読んだ行を表示する
  // ── 入門でよく使う組み込み関数（ADR-011） ──
  map: def('map', (args, _k, ctx) => {
    argCount('map', args, 2, 99, ctx.loc);
    const lists = args.slice(1).map(a => [...iterate(a, ctx.loc)]);
    const n = Math.min(...lists.map(l => l.length));
    return new PyIterator('map', Array.from({ length: n }, (_, i) => ctx.call(args[0], lists.map(l => l[i]))));
  }),
  filter: def('filter', (args, _k, ctx) => {
    argCount('filter', args, 2, 2, ctx.loc);
    const items = [...iterate(args[1], ctx.loc)];
    return new PyIterator('filter', items.filter(v => truthy(args[0] === null ? v : ctx.call(args[0], [v]))));
  }),
  iter: def('iter', (args, _k, ctx) => {
    argCount('iter', args, 1, 1, ctx.loc);
    if (args[0] instanceof PyIterator) return args[0];
    const kind = isList(args[0]) ? 'list_iterator' : isTuple(args[0]) ? 'tuple_iterator' : isStr(args[0]) ? 'str_ascii_iterator'
      : isDict(args[0]) ? 'dict_keyiterator' : isSet(args[0]) ? 'set_iterator' : args[0] instanceof PyRange ? 'range_iterator' : 'iterator';
    return new PyIterator(kind, [...iterate(args[0], ctx.loc)]);
  }),
  next: def('next', (args, _k, ctx) => {
    argCount('next', args, 1, 2, ctx.loc);
    const it = args[0];
    if (!(it instanceof PyIterator)) throw new PyError('TypeError', `${typeName(it)} はイテレーターではありません`, ctx.loc);
    if (it.pos < it.items.length) return it.items[it.pos++];
    if (args.length > 1) return args[1];
    throw new PyRaise(makeException(EXCEPTIONS.StopIteration, []), ctx.loc, `StopIteration（${ctx.loc?.line}行目）`);
  }),
  any: def('any', (args, _k, ctx) => { argCount('any', args, 1, 1, ctx.loc); for (const v of iterate(args[0], ctx.loc)) if (truthy(v)) return true; return false; }),
  all: def('all', (args, _k, ctx) => { argCount('all', args, 1, 1, ctx.loc); for (const v of iterate(args[0], ctx.loc)) if (!truthy(v)) return false; return true; }),
  divmod: def('divmod', (args, _k, ctx) => {
    argCount('divmod', args, 2, 2, ctx.loc);
    return makeTuple([ctx.binop('//', args[0], args[1]), ctx.binop('%', args[0], args[1])]);
  }),
  pow: def('pow', (args, _k, ctx) => {
    argCount('pow', args, 2, 3, ctx.loc);
    if (args.length === 2 || args[2] === null) return ctx.binop('**', args[0], args[1]);
    const [b, e, m] = args.map(a => BigInt(toInt(a, ctx.loc, 'pow()')));
    if (m === 0n) throw new PyError('ValueError', 'pow() の 3 番目の引数に 0 は使えません', ctx.loc);
    const mm = m < 0n ? -m : m;
    let base = ((b % mm) + mm) % mm, k = e;
    if (e < 0n) {   // 指数が負なら逆元を使う（CPython 3.8 以降。pow(2, -1, 5) == 3）
      const inv = modInverse(base, mm);
      if (inv === null) throw new PyError('ValueError', 'pow() の底が、法に対して逆元を持ちません', ctx.loc);
      base = inv; k = -e;
    }
    let r = 1n;
    while (k > 0n) { if (k & 1n) r = (r * base) % mm; base = (base * base) % mm; k >>= 1n; }
    return normInt(m < 0n && r > 0n ? r + m : r);
  }),
  hex: def('hex', (args, _k, ctx) => radix(args[0], 16, '0x', ctx.loc)),
  bin: def('bin', (args, _k, ctx) => radix(args[0], 2, '0b', ctx.loc)),
  oct: def('oct', (args, _k, ctx) => radix(args[0], 8, '0o', ctx.loc)),
  callable: def('callable', (args) => {
    const v = args[0];
    return typeof v === 'function' || isClass(v) || (v != null && v.__type__ === 'JSFunction')
      || (isInstance(v) && classLookup(v.cls, '__call__') !== undefined);
  }),
  format: def('format', (args, _k, ctx) => { argCount('format', args, 1, 2, ctx.loc); return formatValue(args[0], args[1] ?? '', ctx.loc); }),
  id: def('id', (args) => objectId(args[0])),
  hash: def('hash', (args, _k, ctx) => pyHash(args[0], ctx.loc)),
  // ── デコレーターで使う組み込み（ADR-012） ──
  staticmethod: def('staticmethod', (args, _k, ctx) => { argCount('staticmethod', args, 1, 1, ctx.loc); return { __type__: 'PyStaticMethod', fn: args[0], name: args[0]?.name ?? args[0]?.pyName }; }),
  classmethod: def('classmethod', (args, _k, ctx) => { argCount('classmethod', args, 1, 1, ctx.loc); return { __type__: 'PyClassMethod', fn: args[0], name: args[0]?.name ?? args[0]?.pyName }; }),
  property: def('property', (args, kwargs, ctx) => { argCount('property', args, 0, 2, ctx.loc); return makeProperty(args[0] ?? kwargs.fget ?? null, args[1] ?? kwargs.fset ?? null); }),
  open: def('open', (_a, _k, ctx) => {   // ファイルは使えない（ADR-012 で with を入れたので、名前がないエラーより分かりやすくする）
    throw new PyError('NotImplemented', 'open() によるファイルの読み書きはまだ対応していません（データはプログラムの中に書いてください）', ctx.loc);
  }),
  exit: def('exit', (args, _k, ctx) => exitProgram(args, ctx)),
  quit: def('quit', (args, _k, ctx) => exitProgram(args, ctx)),
  input: def('input', (args, _k, ctx) => {
    const rt = ctx.rt;
    if (args.length) rt.recorder?.write(str(args[0]));
    const lines = rt.stdin ?? [];
    rt.stdinPos = rt.stdinPos ?? 0;
    if (rt.stdinPos >= lines.length) {
      throw new PyError('EOFError', '入力が足りません（画面の「入力」の欄に、input() で読む行を書いてください）', ctx.loc);
    }
    const line = lines[rt.stdinPos++];
    rt.recorder?.write(`${line}\n`);
    return line;
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
  lstrip: (s, [c]) => (c == null ? s.trimStart() : s.replace(new RegExp(`^${stripChars(c)}+`), '')),
  rstrip: (s, [c]) => (c == null ? s.trimEnd() : s.replace(new RegExp(`${stripChars(c)}+$`), '')),
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
  startswith: (s, [x]) => prefixMatch(s, x, (a, p) => a.startsWith(p)),
  endswith: (s, [x]) => prefixMatch(s, x, (a, p) => a.endsWith(p)),
  isdigit: (s) => s.length > 0 && /^\d+$/.test(s),
  isalpha: (s) => s.length > 0 && /^\p{L}+$/u.test(s),
  // ── ADR-011 で足したもの ──
  format: (s, args, kwargs, ctx) => strFormat(s, args, kwargs, ctx.loc),
  zfill: (s, [w]) => (/^[+-]/.test(s) ? s[0] + s.slice(1).padStart(num(w) - 1, '0') : s.padStart(num(w), '0')),
  center: (s, [w, fill = ' ']) => padTo(s, num(w), fill, 'center'),
  ljust: (s, [w, fill = ' ']) => padTo(s, num(w), fill, 'right'),
  rjust: (s, [w, fill = ' ']) => padTo(s, num(w), fill, 'left'),
  title: (s) => wordTitle(s),
  capitalize: (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s),
  swapcase: (s) => [...s].map(ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join(''),
  isalnum: (s) => s.length > 0 && /^[\p{L}\p{N}]+$/u.test(s),
  isspace: (s) => s.length > 0 && /^\s+$/.test(s),
  isupper: (s) => /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s),
  islower: (s) => /\p{Ll}/u.test(s) && !/\p{Lu}/u.test(s),
  isdecimal: (s) => s.length > 0 && /^\p{Nd}+$/u.test(s),
  isnumeric: (s) => s.length > 0 && /^\p{N}+$/u.test(s),
  rfind: (s, [x]) => s.lastIndexOf(x),
  index: (s, [x], _k, ctx) => {
    const i = s.indexOf(x);
    if (i < 0) throw new PyError('ValueError', `文字列の中に ${repr(x)} が見つかりません`, ctx.loc);
    return i;
  },
  rindex: (s, [x], _k, ctx) => {
    const i = s.lastIndexOf(x);
    if (i < 0) throw new PyError('ValueError', `文字列の中に ${repr(x)} が見つかりません`, ctx.loc);
    return i;
  },
  partition: (s, [sep]) => { const i = s.indexOf(sep); return makeTuple(i < 0 ? [s, '', ''] : [s.slice(0, i), sep, s.slice(i + sep.length)]); },
  rpartition: (s, [sep]) => { const i = s.lastIndexOf(sep); return makeTuple(i < 0 ? ['', '', s] : [s.slice(0, i), sep, s.slice(i + sep.length)]); },
  splitlines: (s) => (s === '' ? [] : s.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')),
  removeprefix: (s, [p]) => (s.startsWith(p) ? s.slice(p.length) : s),
  removesuffix: (s, [p]) => (p && s.endsWith(p) ? s.slice(0, -p.length) : s),
};

const DICT_METHODS = {
  get: (d, [k, dflt = null], _k, ctx) => dictGet(d, k, ctx.loc, dflt),
  keys: (d) => [...d.keys],
  values: (d) => [...d.values],
  items: (d) => dictEntries(d).map(kv => makeTuple(kv)),
  pop: (d, [k, ...rest], _k, ctx) => {
    if (dictHas(d, k, ctx.loc)) return dictDelete(d, k, ctx.loc);
    if (rest.length) return rest[0];
    throw new PyError('KeyError', `辞書にキー ${repr(k)} がありません`, ctx.loc);
  },
  setdefault: (d, [k, dflt = null], _k, ctx) => {
    if (!dictHas(d, k, ctx.loc)) dictSet(d, k, dflt, ctx.loc);
    return dictGet(d, k, ctx.loc);
  },
  update: (d, [other], _k, ctx) => {
    if (!isDict(other)) throw new PyError('NotImplemented', 'update() には辞書を渡してください', ctx.loc);
    dictEntries(other).forEach(([k, v]) => dictSet(d, k, v, ctx.loc));
    return null;
  },
  copy: (d) => makeDict(dictEntries(d)),
  clear: (d) => { d.keys.length = 0; d.values.length = 0; d._index = null; return null; },
};

const SET_METHODS = {
  add: (st, [x], _k, ctx) => { setAdd(st, x, ctx.loc); return null; },
  remove: (st, [x], _k, ctx) => {
    if (!setDiscard(st, x, ctx.loc)) throw new PyError('KeyError', `集合に ${repr(x)} がありません`, ctx.loc);
    return null;
  },
  discard: (st, [x], _k, ctx) => { setDiscard(st, x, ctx.loc); return null; },
  pop: (st, _a, _k, ctx) => {
    if (st.length === 0) throw new PyError('KeyError', '空の集合から pop() しようとしました', ctx.loc);
    const x = st[0];
    setDiscard(st, x, ctx.loc);
    return x;
  },
  clear: (st) => { st.length = 0; st._index = null; return null; },
  copy: (st, _a, _k, ctx) => makeSet([...st], ctx.loc),
  update: (st, args, _k, ctx) => { for (const a of args) for (const x of iterate(a, ctx.loc)) setAdd(st, x, ctx.loc); return null; },
  union: (st, args, _k, ctx) => makeSet([...st, ...args.flatMap(a => [...iterate(a, ctx.loc)])], ctx.loc),
  intersection: (st, args, _k, ctx) => {
    const others = args.map(a => makeSet([...iterate(a, ctx.loc)], ctx.loc));
    return makeSet(st.filter(x => others.every(o => setHas(o, x, ctx.loc))), ctx.loc);
  },
  difference: (st, args, _k, ctx) => {
    const others = args.map(a => makeSet([...iterate(a, ctx.loc)], ctx.loc));
    return makeSet(st.filter(x => !others.some(o => setHas(o, x, ctx.loc))), ctx.loc);
  },
  issubset: (st, [o], _k, ctx) => { const os = makeSet([...iterate(o, ctx.loc)], ctx.loc); return st.every(x => setHas(os, x, ctx.loc)); },
  issuperset: (st, [o], _k, ctx) => [...iterate(o, ctx.loc)].every(x => setHas(st, x, ctx.loc)),
};

function escRe(s) { return s.replace(/[\]\\^-]/g, '\\$&'); }

/** 関数なら、self を最初の引数として渡すメソッドにする（bound method） */
function bindMethod(v, self) {
  const isFn = (v && v.__type__ === 'JSFunction') || typeof v === 'function';
  if (!isFn) return v;
  const owner = isClass(self) ? self.name : self.cls?.name ?? typeName(self);
  return def(`${owner}.${v.name ?? v.pyName}`, (args, kwargs, ctx) => ctx.call(v, [self, ...args], kwargs));
}

/** クラスの属性 v を、インスタンス inst（なければクラス cls から）取り出したときの値（staticmethod・classmethod・メソッド。ADR-012） */
function fromClass(v, cls, inst) {
  if (isStaticMethod(v)) return v.fn;
  if (isClassMethod(v)) return bindMethod(v.fn, cls);
  return inst ? bindMethod(v, inst) : v;
}

const noAttr = (obj, name, loc) => new PyError('AttributeError', `${typeName(obj)} に ${name} という属性はありません`, loc);

/** obj.name = value */
export function setAttr(obj, name, value, loc) {
  if (isInstance(obj)) {
    const p = classLookup(obj.cls, name);
    if (isProperty(p)) {   // property への代入は setter を呼ぶ（ADR-012）
      if (!p.fset) throw new PyError('AttributeError', `${obj.cls.name} の property '${name}' には代入できません（setter がありません）`, loc);
      invoke(p.fset, [obj, value]);
      return;
    }
  }
  if (isInstance(obj) || isClass(obj)) { obj.attrs[name] = value; return; }
  throw new PyError('AttributeError', `${typeName(obj)} には属性を追加できません`, loc);
}

/** del obj.name */
export function delAttr(obj, name, loc) {
  if ((isInstance(obj) || isClass(obj)) && Object.prototype.hasOwnProperty.call(obj.attrs, name)) { delete obj.attrs[name]; return; }
  throw noAttr(obj, name, loc);
}

/** obj.name を取り出す。メソッドは、呼び出し可能な JS 関数（self を束縛したもの）を返す */
export function getAttr(obj, name, loc) {
  if (isModule(obj)) {
    if (Object.prototype.hasOwnProperty.call(obj.attrs, name)) return obj.attrs[name];
    throw new PyError('AttributeError', `モジュール '${obj.name}' に ${name} はありません`, loc);
  }
  if (isInstance(obj)) {
    const cv = classLookup(obj.cls, name);
    if (isProperty(cv)) {   // property はインスタンスの属性より先に見る（ADR-012）
      if (!cv.fget) throw new PyError('AttributeError', `${obj.cls.name} の property '${name}' は読み出せません（getter がありません）`, loc);
      return invoke(cv.fget, [obj]);
    }
    if (Object.prototype.hasOwnProperty.call(obj.attrs, name)) return obj.attrs[name];
    if (name === 'args' && obj.args) return obj.args;
    if (name === '__class__') return obj.cls;
    if (name === '__dict__') return makeDict(Object.entries(obj.attrs));
    if (cv !== undefined) return fromClass(cv, obj.cls, obj);
    throw noAttr(obj, name, loc);
  }
  if (isClass(obj)) {
    if (name === '__name__') return obj.name;
    const v = classLookup(obj, name);
    if (v !== undefined) return fromClass(v, obj, null);
    throw noAttr(obj, name, loc);
  }
  if (isProperty(obj)) {   // @x.setter
    if (name === 'setter') return def('property.setter', (args) => makeProperty(obj.fget, args[0]));
    if (name === 'getter') return def('property.getter', (args) => makeProperty(args[0], obj.fset));
    if (name === 'fget') return obj.fget;
    if (name === 'fset') return obj.fset;
    throw noAttr(obj, name, loc);
  }
  if (obj && obj.__type__ === 'PySuper') {
    const mro = isInstance(obj.self) ? obj.self.cls.mro : obj.self.mro;
    const v = classLookup(isInstance(obj.self) ? obj.self.cls : obj.self, name, mro.indexOf(obj.cls) + 1);
    if (v === undefined) throw new PyError('AttributeError', `super() の先に ${name} という属性はありません`, loc);
    if (isProperty(v)) return invoke(v.fget, [obj.self]);
    return isInstance(obj.self) ? fromClass(v, obj.self.cls, obj.self) : fromClass(v, obj.self, null);
  }
  if (typeof obj === 'function' && name === '__name__') return obj.pyName ?? obj.name;
  if (obj?.__type__ === 'JSFunction' && name === '__name__') return obj.name;   // 自作の関数の名前（デコレーターでよく使う。ADR-012）
  const table = isList(obj) ? LIST_METHODS : isStr(obj) ? STR_METHODS : isDict(obj) ? DICT_METHODS : isSet(obj) ? SET_METHODS
    : isTuple(obj) ? { index: LIST_METHODS.index, count: LIST_METHODS.count } : null;
  const m = table && Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
  if (!m) throw new PyError('AttributeError', `${typeName(obj)} に ${name} という属性はありません`, loc);
  return def(`${typeName(obj)}.${name}`, (args, kwargs, ctx) => m(obj, args, kwargs, ctx));
}
