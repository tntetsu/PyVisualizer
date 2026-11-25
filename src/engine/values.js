/**
 * values.js — Python の値の表現と基本操作
 *
 * | Python | 表現 |
 * |---|---|
 * | int | 安全な整数の範囲（±(2^53−1)）は JS の number、それを超えたら BigInt（常にこの正規形に保つ） |
 * | float | PyFloat（不変。valueOf/toString を持つので、JS 前提のビューでも数値・'2.0' として扱われる） |
 * | str / bool / None | string / boolean / null |
 * | list | JS の Array |
 * | tuple | 凍結した Array ＋ 列挙されない印 __pytuple__ |
 * | dict | { __type__: 'PyDict', keys: [...], values: [...] }（挿入順。キーの検索用の索引は列挙されない _index） |
 * | set | Array ＋ 列挙されない印 __pyset__（入れた順。検索用の索引は列挙されない _index。CPython の表示順とは違う） |
 * | range | PyRange（不変） |
 * | 関数 | { __type__: 'JSFunction', ... }（JSVisualizer のビューが関数として扱う印をそのまま使う） |
 */

export class PyError extends Error {
  /**
   * @param {string} pyType  例：'ZeroDivisionError'
   * @param {string} message 初学者向けの日本語の説明
   * @param {{line:number,column:number}} [loc]
   */
  constructor(pyType, message, loc) {
    super(`${pyType}: ${message}${loc ? `（${loc.line}行目）` : ''}`);
    this.name = pyType;
    this.pyType = pyType;
    this.pyMessage = message;   // except で捕まえたときの例外の引数（str(e)）
    this.loc = loc;
  }
}

export class PyFloat {
  constructor(v) { this.v = v; Object.freeze(this); }
  valueOf() { return this.v; }
  toString() { return floatRepr(this.v); }
  toJSON() { return this.v; }
}

export class PyRange {
  constructor(start, stop, step) { this.start = start; this.stop = stop; this.step = step; Object.freeze(this); }
  get length() {
    const n = Math.ceil((this.stop - this.start) / this.step);
    return Math.max(0, n);
  }
  at(i) { return this.start + i * this.step; }
  toString() { return this.step === 1 ? `range(${this.start}, ${this.stop})` : `range(${this.start}, ${this.stop}, ${this.step})`; }
}

/**
 * イテレーター（map・filter・iter() の結果。ADR-011）。要素は作ったときに全部求めておき（map の関数もその場で呼ぶ）、
 * next() や for で先頭から取り出す。取り出した要素は戻らない（CPython のイテレーターと同じく 1 回だけ使える）
 */
export class PyIterator {
  constructor(kind, items) { this.kind = kind; this.items = items; this.pos = 0; }
  toString() { return `<${this.kind} object>`; }
}

/** with の __exit__ に渡すトレースバック（中身は持たない。表示は CPython と同じ <traceback object>。ADR-012） */
export class PyTraceback {
  toString() { return '<traceback object>'; }
}

export function floatRepr(v) {
  if (Number.isNaN(v)) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  // CPython の repr と同じく、最短の桁で表し、10 進の指数が -4 未満か 16 以上なら指数表記（1e+16・1e-05）にする
  const exp = v === 0 ? 0 : Number(v.toExponential().split('e')[1]);
  if (exp < -4 || exp >= 16) return v.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
  const s = String(v);   // この範囲では JS も固定小数点で、桁は最短（Python と同じ）
  return s.includes('.') ? s : `${s}.0`;
}

export const makeFloat = (v) => new PyFloat(v);

/**
 * スナップショット用のクローンの hook（共通コアの deepClone に渡す）。
 * tuple の印（__pytuple__）を保ったままクローンする。PyFloat・PyRange は不変なので既定どおり参照を保持する。
 */
export function pyCloneHook(v, clone, seen) {
  if (!Array.isArray(v)) return undefined;
  const marker = v.__pytuple__ === true ? '__pytuple__' : v.__pyset__ === true ? '__pyset__' : null;
  if (!marker) return undefined;
  const c = [];
  seen.set(v, c);
  for (const x of v) c.push(clone(x));
  Object.defineProperty(c, marker, { value: true, enumerable: false });
  return marker === '__pytuple__' ? Object.freeze(c) : c;
}

export function makeTuple(items) {
  const t = [...items];
  Object.defineProperty(t, '__pytuple__', { value: true, enumerable: false });
  return Object.freeze(t);
}

export const isFloat = (v) => v instanceof PyFloat;
export const isInt   = (v) => typeof v === 'number' || typeof v === 'bigint';
export const isBool  = (v) => typeof v === 'boolean';
export const isNum   = (v) => isInt(v) || isFloat(v) || isBool(v);
export const isStr   = (v) => typeof v === 'string';
export const isTuple = (v) => Array.isArray(v) && v.__pytuple__ === true;
export const isSet   = (v) => Array.isArray(v) && v.__pyset__ === true;
export const isList  = (v) => Array.isArray(v) && !isTuple(v) && !isSet(v);
/** 添字・スライス・連結・繰り返しができる並び（list・tuple。set は含まない） */
export const isSeq   = (v) => Array.isArray(v) && !isSet(v);
export const isDict  = (v) => v !== null && typeof v === 'object' && v.__type__ === 'PyDict';
export const isFunc  = (v) => (v && v.__type__ === 'JSFunction') || typeof v === 'function';

import {
  isInstance, isClass, isException, callSpecial, exceptionText, classLookup,
} from './objects.js';

/** 数値を JS の number として取り出す（bool は 0/1、BigInt は近似）。float の計算に使う */
export const num = (v) => (isBool(v) ? (v ? 1 : 0) : isFloat(v) ? v.v : typeof v === 'bigint' ? Number(v) : v);

// ── int（number と BigInt） ─────────────────────────────────────────────────

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** int を正規形にする：安全な整数の範囲なら number、超えたら BigInt */
export function normInt(x) {
  if (typeof x === 'bigint') return x <= MAX_SAFE && x >= -MAX_SAFE ? Number(x) : x;
  return Number.isSafeInteger(x) ? x : BigInt(x);
}

/** int（bool を含む）を BigInt にする */
export const big = (v) => BigInt(isBool(v) ? (v ? 1 : 0) : v);

function floorDivBig(a, b) {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
}

/**
 * int どうしの演算（+ - * // % ** & | ^ << >>）。結果は正規形の int。
 * number で正確に計算できる場合は number で、できない場合は BigInt で計算する。
 * 0 での割り算・負の指数は呼び出し側で扱う。
 */
export function intOp(op, a, b) {
  if (isBool(a)) a = a ? 1 : 0;
  if (isBool(b)) b = b ? 1 : 0;
  if (typeof a === 'number' && typeof b === 'number') {
    let r;
    switch (op) {
      case '+': r = a + b; break;
      case '-': r = a - b; break;
      case '*': r = a * b; break;
      case '**': r = a ** b; break;
      case '//': case '%': {
        let q = Math.floor(a / b);
        // 浮動小数点の割り算の丸めで 1 ずれる場合を直す（余りを b と同じ符号・|b| 未満にそろえる）
        let m = a - q * b;
        if (b > 0 ? m < 0 : m > 0) { q -= 1; m += b; }
        if (b > 0 ? m >= b : m <= b) { q += 1; m -= b; }
        r = op === '//' ? q : m;
        break;
      }
      default: r = NaN;   // ビット演算は BigInt で（JS の number のビット演算は 32 ビット）
    }
    if (Number.isSafeInteger(r)) return r;
  }
  const A = BigInt(a), B = BigInt(b);
  let R;
  switch (op) {
    case '+': R = A + B; break;
    case '-': R = A - B; break;
    case '*': R = A * B; break;
    case '**': R = A ** B; break;
    case '//': R = floorDivBig(A, B); break;
    case '%': R = A - B * floorDivBig(A, B); break;
    case '&': R = A & B; break;
    case '|': R = A | B; break;
    case '^': R = A ^ B; break;
    case '<<': R = A << B; break;
    case '>>': R = A >> B; break;
    default: throw new Error(`intOp: ${op}`);
  }
  return normInt(R);
}

/** int どうしの比較（負・0・正） */
function intCmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const A = big(a), B = big(b);
  return A < B ? -1 : A > B ? 1 : 0;
}

// ── dict ──────────────────────────────────────────────────────────────────────

const funcIds = new WeakMap();
let nextFuncId = 1;

/**
 * dict のキーの同一性を表す文字列（Python の hash と == に相当）。
 * 1 と 1.0 と True は同じキー。list・dict は使えない（unhashable）。
 */
export function hashKey(k, loc) {
  if (k === null || k === undefined) return 'N';
  if (isNum(k)) {
    const v = isFloat(k) ? k.v : isBool(k) ? (k ? 1 : 0) : k;
    return `n:${String(v)}`;
  }
  if (isStr(k)) return `s:${k}`;
  if (isTuple(k)) return `t:(${k.map(x => hashKey(x, loc)).join(',')})`;
  if (k instanceof PyRange) return `r:${k.start},${k.stop},${k.step}`;
  if (isFunc(k) || isInstance(k) || isClass(k)) {
    if (!funcIds.has(k)) funcIds.set(k, nextFuncId++);
    return `f:${funcIds.get(k)}`;
  }
  throw new PyError('TypeError', `${typeName(k)} は辞書のキーに使えません（unhashable type: '${typeName(k)}'）`, loc);
}

function dictIndex(d) {
  if (!d._index) {
    const idx = new Map();
    d.keys.forEach((k, i) => idx.set(hashKey(k), i));
    Object.defineProperty(d, '_index', { value: idx, enumerable: false, writable: true, configurable: true });
  }
  return d._index;
}

export function makeDict(entries = []) {
  const d = { __type__: 'PyDict', keys: [], values: [] };
  for (const [k, v] of entries) dictSet(d, k, v);
  return d;
}

export const dictSize = (d) => d.keys.length;

export function dictHas(d, k, loc) {
  return dictIndex(d).has(hashKey(k, loc));
}

/** 値を返す。キーがなければ dflt（省略時は KeyError） */
export function dictGet(d, k, loc, ...dflt) {
  const i = dictIndex(d).get(hashKey(k, loc));
  if (i !== undefined) return d.values[i];
  if (dflt.length) return dflt[0];
  throw new PyError('KeyError', `辞書にキー ${repr(k)} がありません`, loc);
}

/** 既にあるキーは値だけを更新する（キーそのものは最初に入れたものを保つ。Python と同じ） */
export function dictSet(d, k, v, loc) {
  const h = hashKey(k, loc);
  const idx = dictIndex(d);
  const i = idx.get(h);
  if (i !== undefined) { d.values[i] = v; return; }
  idx.set(h, d.keys.length);
  d.keys.push(k);
  d.values.push(v);
}

/** キーを削除して値を返す。キーがなければ KeyError */
export function dictDelete(d, k, loc) {
  const i = dictIndex(d).get(hashKey(k, loc));
  if (i === undefined) throw new PyError('KeyError', `辞書にキー ${repr(k)} がありません`, loc);
  const v = d.values[i];
  d.keys.splice(i, 1);
  d.values.splice(i, 1);
  d._index = null;   // 次に使うときに作り直す
  return v;
}

export const dictEntries = (d) => d.keys.map((k, i) => [k, d.values[i]]);

// ── set ───────────────────────────────────────────────────────────────────────

function setIndex(st) {
  if (!st._index) {
    const idx = new Map();
    st.forEach((x, i) => idx.set(hashKey(x), i));
    Object.defineProperty(st, '_index', { value: idx, enumerable: false, writable: true, configurable: true });
  }
  return st._index;
}

export function makeSet(items = [], loc) {
  const st = [];
  Object.defineProperty(st, '__pyset__', { value: true, enumerable: false });
  for (const x of items) setAdd(st, x, loc);
  return st;
}
export const setHas = (st, x, loc) => setIndex(st).has(hashKey(x, loc));
export function setAdd(st, x, loc) {
  const h = hashKey(x, loc);
  const idx = setIndex(st);
  if (idx.has(h)) return;
  idx.set(h, st.length);
  st.push(x);
}
/** 要素を取り除く。なければ false */
export function setDiscard(st, x, loc) {
  const i = setIndex(st).get(hashKey(x, loc));
  if (i === undefined) return false;
  st.splice(i, 1);
  st._index = null;   // 次に使うときに作り直す
  return true;
}

export function typeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (isBool(v)) return 'bool';
  if (isInt(v)) return 'int';
  if (isFloat(v)) return 'float';
  if (isStr(v)) return 'str';
  if (isTuple(v)) return 'tuple';
  if (isSet(v)) return 'set';
  if (isList(v)) return 'list';
  if (isDict(v)) return 'dict';
  if (v instanceof PyRange) return 'range';
  if (v instanceof PyIterator) return v.kind;
  if (v instanceof PyTraceback) return 'traceback';
  if (v?.__type__ === 'PyProperty') return 'property';
  if (v?.__type__ === 'PyStaticMethod') return 'staticmethod';
  if (v?.__type__ === 'PyClassMethod') return 'classmethod';
  if (isInstance(v)) return v.cls.name;
  if (isClass(v)) return 'type';
  if (v && v.constructor?.name === 'PyModule') return 'module';
  if (isFunc(v)) return typeof v === 'function' ? 'builtin_function_or_method' : 'function';
  return 'object';
}

export function truthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (isInt(v)) return v !== 0 && v !== 0n;
  if (isFloat(v)) return v.v !== 0;
  if (isStr(v) || Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return v.keys.length > 0;
  if (v instanceof PyRange) return v.length > 0;
  if (isInstance(v)) {
    const b = callSpecial(v, '__bool__');
    if (b !== undefined) return truthy(b);
    const n = callSpecial(v, '__len__');
    if (n !== undefined) return truthy(n);
  }
  return true;
}

// ── 文字列化（repr / str） ─────────────────────────────────────────────────

export function strRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  const body = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
  return q + (q === "'" ? body.replace(/'/g, "\\'") : body) + q;
}

export function repr(v, seen = new Set()) {
  if (v === null || v === undefined) return 'None';
  if (isBool(v)) return v ? 'True' : 'False';
  if (isInt(v)) return String(v);
  if (isFloat(v)) return v.toString();
  if (isStr(v)) return strRepr(v);
  if (v instanceof PyRange || v instanceof PyIterator || v instanceof PyTraceback) return v.toString();
  if (typeof v === 'function') return v.isType ? `<class '${v.pyName}'>` : `<built-in function ${v.pyName ?? v.name}>`;
  if (isClass(v)) return v.builtin ? `<class '${v.name}'>` : `<class '__main__.${v.name}'>`;
  if (isInstance(v)) {
    const r = callSpecial(v, '__repr__');
    if (r !== undefined) return str(r);
    if (isException(v)) return `${v.cls.name}(${[...v.args].map(x => repr(x)).join(', ')})`;
    return `<__main__.${v.cls.name} object>`;
  }
  if (v.__type__ === 'JSFunction') return v.isLambda ? '<function <lambda>>' : `<function ${v.name}>`;
  if (v.__type__ === 'PyProperty') return '<property object>';
  if (v.__type__ === 'PyStaticMethod' || v.__type__ === 'PyClassMethod') {
    return `<${v.__type__ === 'PyStaticMethod' ? 'staticmethod' : 'classmethod'}(${repr(v.fn, seen)})>`;
  }
  if (seen.has(v)) return isDict(v) ? '{...}' : '[...]';
  seen.add(v);
  try {
    if (isTuple(v)) return v.length === 1 ? `(${repr(v[0], seen)},)` : `(${v.map(x => repr(x, seen)).join(', ')})`;
    if (isSet(v)) return v.length === 0 ? 'set()' : `{${v.map(x => repr(x, seen)).join(', ')}}`;
    if (Array.isArray(v)) return `[${v.map(x => repr(x, seen)).join(', ')}]`;
    if (isDict(v)) return `{${v.keys.map((k, i) => `${repr(k, seen)}: ${repr(v.values[i], seen)}`).join(', ')}}`;
  } finally { seen.delete(v); }
  return String(v);
}

export function str(v) {
  if (isStr(v)) return v;
  if (isInstance(v)) {
    const r = callSpecial(v, '__str__');
    if (r !== undefined) return str(r);
    if (isException(v) && !classLookup(v.cls, '__repr__')) return exceptionText(v, str, repr);
  }
  return repr(v);
}

// ── 比較 ──────────────────────────────────────────────────────────────────────

export function pyEq(a, b) {
  if (isInstance(a) || isInstance(b)) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const r = callSpecial(x, '__eq__', [y]);
      if (r !== undefined && r !== NOT_IMPLEMENTED) return truthy(r);
    }
    return a === b;
  }
  if (isNum(a) && isNum(b)) {
    if (!isFloat(a) && !isFloat(b)) return intCmp(a, b) === 0;
    return num(a) === num(b);
  }
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (isStr(a) || isStr(b)) return a === b;
  if (isSet(a) || isSet(b)) return isSet(a) && isSet(b) && a.length === b.length && a.every(x => setHas(b, x));
  if (Array.isArray(a) && Array.isArray(b)) {
    if (isTuple(a) !== isTuple(b) || a.length !== b.length) return false;
    return a.every((x, i) => pyEq(x, b[i]));
  }
  if (isDict(a) && isDict(b)) {
    return a.keys.length === b.keys.length
      && a.keys.every((k, i) => dictHas(b, k) && pyEq(a.values[i], dictGet(b, k)));
  }
  if (a instanceof PyRange && b instanceof PyRange) return a.length === b.length && (a.length === 0 || (a.start === b.start && (a.length === 1 || a.step === b.step)));
  return a === b;
}

const SPECIAL_CMP = { '<': '__lt__', '>': '__gt__', '<=': '__le__', '>=': '__ge__' };
const REFLECTED = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };

/**
 * a <op> b（< > <= >=）を CPython と同じ手順で比べる：インスタンスなら、その演算子の特殊メソッドを呼び、
 * 定義がない（NotImplemented）なら、反対側の反射した特殊メソッドを呼ぶ（a > b なら b.__lt__(a)）。
 */
export function richCompare(a, b, op, loc) {
  if (isInstance(a) || isInstance(b)) {
    const r = callSpecial(a, SPECIAL_CMP[op], [b]);
    if (r !== undefined && r !== NOT_IMPLEMENTED) return truthy(r);
    const rr = callSpecial(b, SPECIAL_CMP[REFLECTED[op]], [a]);
    if (rr !== undefined && rr !== NOT_IMPLEMENTED) return truthy(rr);
    throw new PyError('TypeError', `${typeName(a)} と ${typeName(b)} は「${op}」で比べられません`, loc);
  }
  const c = pyCmp(a, b, op, loc);
  return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
}

/** a < b など順序の比較。戻り値は負・0・正（並べ替えなどに使う） */
/** 特殊メソッドが比較を扱わないことを表す値（NotImplemented） */
export const NOT_IMPLEMENTED = Object.freeze({ __notImplemented: true, toString: () => 'NotImplemented' });

export function pyCmp(a, b, op, loc) {
  if (isInstance(a) || isInstance(b)) {
    const lt = callSpecial(a, '__lt__', [b]);
    if (lt !== undefined && lt !== NOT_IMPLEMENTED) {
      if (truthy(lt)) return -1;
      const gt = callSpecial(b, '__lt__', [a]);
      return gt !== undefined && truthy(gt) ? 1 : 0;
    }
    const gt = callSpecial(b, '__lt__', [a]);
    if (gt !== undefined && gt !== NOT_IMPLEMENTED) return truthy(gt) ? 1 : (pyEq(a, b) ? 0 : -1);
  }
  if (isNum(a) && isNum(b)) {
    if (!isFloat(a) && !isFloat(b)) return intCmp(a, b);
    return num(a) - num(b);
  }
  if (isStr(a) && isStr(b)) return a < b ? -1 : a > b ? 1 : 0;
  if (isSeq(a) && isSeq(b) && isTuple(a) === isTuple(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (!pyEq(a[i], b[i])) return pyCmp(a[i], b[i], op, loc);
    }
    return a.length - b.length;
  }
  throw new PyError('TypeError', `${typeName(a)} と ${typeName(b)} は「${op}」で比べられません`, loc);
}

// ── 反復 ──────────────────────────────────────────────────────────────────────

/** for 文や list() などで使う反復。list は Python と同じく、反復中の変更を反映する */
export function* iterate(v, loc) {
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) yield v[i]; return; }
  if (isStr(v)) { yield* v; return; }
  if (v instanceof PyRange) { for (let i = 0; i < v.length; i++) yield v.at(i); return; }
  if (isDict(v)) { for (const k of [...v.keys]) yield k; return; }
  if (v instanceof PyIterator) { while (v.pos < v.items.length) yield v.items[v.pos++]; return; }
  throw new PyError('TypeError', `${typeName(v)} は繰り返し（for など）に使えません`, loc);
}

export function contains(container, item, loc) {
  if (isInstance(container)) {
    const r = callSpecial(container, '__contains__', [item]);
    if (r !== undefined) return truthy(r);
  }
  if (isStr(container)) {
    if (!isStr(item)) throw new PyError('TypeError', `文字列の in の左側は文字列でなければなりません（${typeName(item)}）`, loc);
    return container.includes(item);
  }
  if (isDict(container)) return dictHas(container, item, loc);
  if (isSet(container)) return setHas(container, item, loc);
  if (container instanceof PyRange) {
    if (!isNum(item) || typeof item === 'bigint') return false;
    const x = num(item);
    if (!Number.isInteger(x)) return false;
    const i = (x - container.start) / container.step;
    return Number.isInteger(i) && i >= 0 && i < container.length;
  }
  for (const x of iterate(container, loc)) if (pyEq(x, item)) return true;
  return false;
}
