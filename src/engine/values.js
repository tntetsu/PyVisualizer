/**
 * values.js — Python の値の表現と基本操作（Phase 0 スパイク）
 *
 * | Python | 表現 |
 * |---|---|
 * | int | JS の number（2^53 を超える値は未対応） |
 * | float | PyFloat（不変。valueOf/toString を持つので、JS 前提のビューでも数値・'2.0' として扱われる） |
 * | str / bool / None | string / boolean / null |
 * | list | JS の Array |
 * | tuple | 凍結した Array ＋ 列挙されない印 __pytuple__ |
 * | dict | プレーンオブジェクト ＋ 列挙されない印 __pydict__（スパイクでは str のキーだけ） |
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

export function makeTuple(items) {
  const t = [...items];
  Object.defineProperty(t, '__pytuple__', { value: true, enumerable: false });
  return Object.freeze(t);
}

export function makeDict(entries = []) {
  const d = {};
  Object.defineProperty(d, '__pydict__', { value: true, enumerable: false });
  for (const [k, v] of entries) dictSet(d, k, v);
  return d;
}

export const isFloat = (v) => v instanceof PyFloat;
export const isInt   = (v) => typeof v === 'number';
export const isBool  = (v) => typeof v === 'boolean';
export const isNum   = (v) => isInt(v) || isFloat(v) || isBool(v);
export const isStr   = (v) => typeof v === 'string';
export const isTuple = (v) => Array.isArray(v) && v.__pytuple__ === true;
export const isList  = (v) => Array.isArray(v) && !isTuple(v);
export const isDict  = (v) => v !== null && typeof v === 'object' && v.__pydict__ === true;
export const isFunc  = (v) => (v && v.__type__ === 'JSFunction') || typeof v === 'function';

/** 数値を JS の number として取り出す（bool は 0/1） */
export const num = (v) => (isBool(v) ? (v ? 1 : 0) : isFloat(v) ? v.v : v);

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
  if (isInt(v)) return v !== 0;
  if (isFloat(v)) return v.v !== 0;
  if (isStr(v) || Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
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
    if (isDict(v)) return `{${Object.keys(v).map(k => `${repr(k)}: ${repr(v[k], seen)}`).join(', ')}}`;
  } finally { seen.delete(v); }
  return String(v);
}

export function str(v) { return isStr(v) ? v : repr(v); }

// ── dict（スパイク：キーは str のみ） ────────────────────────────────────────

export function dictKey(k, loc) {
  if (!isStr(k)) throw new PyError('NotImplemented', `スパイクでは辞書のキーは文字列だけ対応しています（${typeName(k)} は未対応）`, loc);
  return k;
}
export function dictSet(d, k, v, loc) { d[dictKey(k, loc)] = v; }

// ── 比較 ──────────────────────────────────────────────────────────────────────

export function pyEq(a, b) {
  if (isNum(a) && isNum(b)) return num(a) === num(b);
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (isStr(a) || isStr(b)) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (isTuple(a) !== isTuple(b) || a.length !== b.length) return false;
    return a.every((x, i) => pyEq(x, b[i]));
  }
  if (isDict(a) && isDict(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => k in b && pyEq(a[k], b[k]));
  }
  if (a instanceof PyRange && b instanceof PyRange) return a.length === b.length && (a.length === 0 || (a.start === b.start && (a.length === 1 || a.step === b.step)));
  return a === b;
}

/** a < b など順序の比較。戻り値は負・0・正 */
export function pyCmp(a, b, op, loc) {
  if (isNum(a) && isNum(b)) return num(a) - num(b);
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
  if (isDict(v)) { for (const k of Object.keys(v)) yield k; return; }
  throw new PyError('TypeError', `${typeName(v)} は繰り返し（for など）に使えません`, loc);
}

export function contains(container, item, loc) {
  if (isStr(container)) {
    if (!isStr(item)) throw new PyError('TypeError', `文字列の in の左側は文字列でなければなりません（${typeName(item)}）`, loc);
    return container.includes(item);
  }
  if (isDict(container)) return isStr(item) && Object.prototype.hasOwnProperty.call(container, item);
  if (container instanceof PyRange) {
    if (!isNum(item)) return false;
    const x = num(item);
    if (!Number.isInteger(x)) return false;
    const i = (x - container.start) / container.step;
    return Number.isInteger(i) && i >= 0 && i < container.length;
  }
  for (const x of iterate(container, loc)) if (pyEq(x, item)) return true;
  return false;
}
