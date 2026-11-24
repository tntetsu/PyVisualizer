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

export function floatRepr(v) {
  if (Number.isNaN(v)) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return v.toFixed(1);
  const s = String(v);
  // JS は 1e21 以上で指数表記、Python は 1e16 以上。ここでは近似で十分
  return s.replace(/e\+?(-?)(\d)$/, 'e$1+0$2').replace('e+-', 'e-').replace(/e\+0(\d\d)/, 'e+$1');
}

export const makeFloat = (v) => new PyFloat(v);

/**
 * スナップショット用のクローンの hook（共通コアの deepClone に渡す）。
 * tuple の印（__pytuple__）を保ったままクローンする。PyFloat・PyRange は不変なので既定どおり参照を保持する。
 */
export function pyCloneHook(v, clone, seen) {
  if (!Array.isArray(v) || v.__pytuple__ !== true) return undefined;
  const c = [];
  seen.set(v, c);
  for (const x of v) c.push(clone(x));
  Object.defineProperty(c, '__pytuple__', { value: true, enumerable: false });
  return Object.freeze(c);
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
export const isList  = (v) => Array.isArray(v) && !isTuple(v);
export const isDict  = (v) => v !== null && typeof v === 'object' && v.__type__ === 'PyDict';
export const isFunc  = (v) => (v && v.__type__ === 'JSFunction') || typeof v === 'function';

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
  if (isFunc(k)) {
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

export function typeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (isBool(v)) return 'bool';
  if (isInt(v)) return 'int';
  if (isFloat(v)) return 'float';
  if (isStr(v)) return 'str';
  if (isTuple(v)) return 'tuple';
  if (isList(v)) return 'list';
  if (isDict(v)) return 'dict';
  if (v instanceof PyRange) return 'range';
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
  if (v instanceof PyRange) return v.toString();
  if (typeof v === 'function') return `<built-in function ${v.pyName ?? v.name}>`;
  if (v.__type__ === 'JSFunction') return v.isLambda ? '<function <lambda>>' : `<function ${v.name}>`;
  if (seen.has(v)) return isDict(v) ? '{...}' : '[...]';
  seen.add(v);
  try {
    if (isTuple(v)) return v.length === 1 ? `(${repr(v[0], seen)},)` : `(${v.map(x => repr(x, seen)).join(', ')})`;
    if (Array.isArray(v)) return `[${v.map(x => repr(x, seen)).join(', ')}]`;
    if (isDict(v)) return `{${v.keys.map((k, i) => `${repr(k, seen)}: ${repr(v.values[i], seen)}`).join(', ')}}`;
  } finally { seen.delete(v); }
  return String(v);
}

export function str(v) { return isStr(v) ? v : repr(v); }

// ── 比較 ──────────────────────────────────────────────────────────────────────

export function pyEq(a, b) {
  if (isNum(a) && isNum(b)) {
    if (!isFloat(a) && !isFloat(b)) return intCmp(a, b) === 0;
    return num(a) === num(b);
  }
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (isStr(a) || isStr(b)) return a === b;
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

/** a < b など順序の比較。戻り値は負・0・正 */
export function pyCmp(a, b, op, loc) {
  if (isNum(a) && isNum(b)) {
    if (!isFloat(a) && !isFloat(b)) return intCmp(a, b);
    return num(a) - num(b);
  }
  if (isStr(a) && isStr(b)) return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b) && isTuple(a) === isTuple(b)) {
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
  throw new PyError('TypeError', `${typeName(v)} は繰り返し（for など）に使えません`, loc);
}

export function contains(container, item, loc) {
  if (isStr(container)) {
    if (!isStr(item)) throw new PyError('TypeError', `文字列の in の左側は文字列でなければなりません（${typeName(item)}）`, loc);
    return container.includes(item);
  }
  if (isDict(container)) return dictHas(container, item, loc);
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
