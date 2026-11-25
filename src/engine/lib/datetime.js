/**
 * lib/datetime.js — datetime モジュール（date・datetime・timedelta）と time モジュール（ADR-013）
 *
 * date・datetime・timedelta は組み込みのクラスのインスタンスにする（属性 year・month・day などがビューに見える）。
 * 計算は CPython の datetime と同じ規則（先発グレゴリオ暦の通し日数・timedelta の正規化）にしてある。
 *
 * 時計：PyVisualizer はプログラムを最後まで実行してからステップ実行で見せるので、time.sleep() は待たない。
 * その代わり、実行ごとの仮の時計（rt.clockOffset 秒）を進め、time.time()・datetime.now() などに足す。
 */
import {
  PyError, makeFloat, isInt, isBool, isFloat, isNum, isStr, num, normInt, typeName, repr, NOT_IMPLEMENTED,
} from '../values.js';
import { PyClass, ObjectClass, makeInstance, isInstance } from '../objects.js';

const def = (name, fn) => { fn.pyName = name; return fn; };
const classmethod = (fn) => ({ __type__: 'PyClassMethod', fn, name: fn.pyName });
const NOT_IMPL = NOT_IMPLEMENTED;

// ── 暦（CPython の Modules/_datetimemodule.c と同じ） ──────────────────────────

const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAYS_BEFORE_MONTH = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const isLeap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const daysInMonth = (y, m) => (m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m]);
const daysBeforeYear = (y) => { const z = y - 1; return z * 365 + Math.floor(z / 4) - Math.floor(z / 100) + Math.floor(z / 400); };
const daysBeforeMonth = (y, m) => DAYS_BEFORE_MONTH[m] + (m > 2 && isLeap(y) ? 1 : 0);
/** 0001-01-01 を 1 とする通し日数 */
const ymdToOrd = (y, m, d) => daysBeforeYear(y) + daysBeforeMonth(y, m) + d;

function ordToYmd(n) {
  let n0 = n - 1;
  const n400 = Math.floor(n0 / 146097); n0 %= 146097;
  const n100 = Math.floor(n0 / 36524); n0 %= 36524;
  const n4 = Math.floor(n0 / 1461); n0 %= 1461;
  const n1 = Math.floor(n0 / 365); n0 %= 365;
  let year = n400 * 400 + n100 * 100 + n4 * 4 + n1 + 1;
  if (n1 === 4 || n100 === 4) return [year - 1, 12, 31];
  const leap = n1 === 3 && (n4 !== 24 || n100 === 3);
  let month = (n0 + 50) >> 5;
  let preceding = DAYS_BEFORE_MONTH[month] + (month > 2 && leap ? 1 : 0);
  if (preceding > n0) { month--; preceding -= DAYS_IN_MONTH[month] + (month === 2 && leap ? 1 : 0); }
  return [year, month, n0 - preceding + 1];
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n, w = 2) => String(n).padStart(w, '0');

// ── 値の取り出し ───────────────────────────────────────────────────────────────

const A = (inst) => inst.attrs;
function intArg(v, what, loc) {
  if (isBool(v)) return v ? 1 : 0;
  if (typeof v === 'number') return v;
  throw new PyError('TypeError', `${what} には整数が必要です（${typeName(v)} が渡されました）`, loc);
}
function checkDate(y, m, d, loc) {
  if (y < 1 || y > 9999) throw new PyError('ValueError', `年 ${y} は範囲外です（1〜9999）`, loc);
  if (m < 1 || m > 12) throw new PyError('ValueError', '月は 1〜12 でなければなりません', loc);
  if (d < 1 || d > daysInMonth(y, m)) throw new PyError('ValueError', 'その月にない日です', loc);
}
function checkTime(h, mi, s, us, loc) {
  if (h < 0 || h > 23) throw new PyError('ValueError', '時は 0〜23 でなければなりません', loc);
  if (mi < 0 || mi > 59) throw new PyError('ValueError', '分は 0〜59 でなければなりません', loc);
  if (s < 0 || s > 59) throw new PyError('ValueError', '秒は 0〜59 でなければなりません', loc);
  if (us < 0 || us > 999999) throw new PyError('ValueError', 'マイクロ秒は 0〜999999 でなければなりません', loc);
}

/** 偶数への丸め（timedelta の小数の引数をマイクロ秒にするとき） */
function roundHalfEven(x) {
  const f = Math.floor(x), diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// ── クラス ───────────────────────────────────────────────────────────────────

/** 組み込みのクラスを作る（属性はあとで入れる。valueKey は辞書のキーにするときの値） */
function builtinClass(name, bases, valueKey) {
  const cls = new PyClass(name, bases, {}, { builtin: true });
  cls.valueKey = valueKey;
  cls.moduleName = 'datetime';
  return cls;
}

export const TimedeltaClass = builtinClass('timedelta', [ObjectClass], (t) => `${A(t).days},${A(t).seconds},${A(t).microseconds}`);
export const DateClass = builtinClass('date', [ObjectClass], (d) => `${A(d).year}-${A(d).month}-${A(d).day}`);
export const DatetimeClass = builtinClass('datetime', [DateClass],
  (d) => ['year', 'month', 'day', 'hour', 'minute', 'second', 'microsecond'].map(k => A(d)[k]).join(','));

const isTd = (v) => isInstance(v) && v.cls === TimedeltaClass;
const isDt = (v) => isInstance(v) && v.cls === DatetimeClass;
const isDate = (v) => isInstance(v) && v.cls === DateClass;

/** 合計マイクロ秒（BigInt）から timedelta を作る */
function tdFromMicro(total) {
  const perDay = 86400n * 1000000n;
  let days = total / perDay, rem = total % perDay;
  if (rem < 0n) { rem += perDay; days -= 1n; }
  const inst = makeInstance(TimedeltaClass);
  if (days > 999999999n || days < -999999999n) throw new PyError('OverflowError', 'timedelta の日数が範囲外です', null);
  inst.attrs = { days: Number(days), seconds: Number(rem / 1000000n), microseconds: Number(rem % 1000000n) };
  return inst;
}
const tdMicro = (t) => (BigInt(A(t).days) * 86400n + BigInt(A(t).seconds)) * 1000000n + BigInt(A(t).microseconds);

function makeDate(y, m, d, loc) {
  checkDate(y, m, d, loc);
  const inst = makeInstance(DateClass);
  inst.attrs = { year: y, month: m, day: d };
  return inst;
}
function makeDatetime(y, m, d, h = 0, mi = 0, s = 0, us = 0, loc) {
  checkDate(y, m, d, loc);
  checkTime(h, mi, s, us, loc);
  const inst = makeInstance(DatetimeClass);
  inst.attrs = { year: y, month: m, day: d, hour: h, minute: mi, second: s, microsecond: us };
  return inst;
}
/** datetime の 0001-01-01 00:00 からのマイクロ秒（BigInt） */
const dtMicro = (v) => ((BigInt(ymdToOrd(A(v).year, A(v).month, A(v).day)) * 86400n
  + BigInt(A(v).hour * 3600 + A(v).minute * 60 + A(v).second)) * 1000000n + BigInt(A(v).microsecond));
function dtFromMicro(total, loc) {
  const perDay = 86400n * 1000000n;
  const ord = Number(total / perDay);
  let rem = Number(total % perDay);
  const [y, m, d] = ordToYmd(ord);
  const us = rem % 1000000; rem = (rem - us) / 1000000;
  return makeDatetime(y, m, d, Math.floor(rem / 3600), Math.floor(rem / 60) % 60, rem % 60, us, loc);
}

/** 今の時刻（仮の時計を足す）→ datetime（ローカル時刻） */
function nowDatetime(rt, loc) {
  const ms = Date.now() + (rt?.clockOffset ?? 0) * 1000;
  const t = new Date(Math.floor(ms));
  const us = Math.round((ms - Math.floor(ms)) * 1000) + t.getMilliseconds() * 1000;
  return makeDatetime(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), Math.min(us, 999999), loc);
}

// ── 書式（strftime・strptime。C ロケール） ─────────────────────────────────────

function fields(v) {
  const a = A(v);
  const dt = isDt(v);
  return {
    y: a.year, m: a.month, d: a.day,
    H: dt ? a.hour : 0, M: dt ? a.minute : 0, S: dt ? a.second : 0, f: dt ? a.microsecond : 0,
    wd: (ymdToOrd(a.year, a.month, a.day) + 6) % 7,   // 月曜 = 0
    yd: daysBeforeMonth(a.year, a.month) + a.day,
  };
}

export function strftime(v, fmt) {
  const f = fields(v);
  return fmt.replace(/%([a-zA-Z%])/g, (all, c) => {
    switch (c) {
      case 'Y': return String(f.y).padStart(4, '0');
      case 'y': return pad(f.y % 100);
      case 'm': return pad(f.m);
      case 'd': return pad(f.d);
      case 'e': return String(f.d).padStart(2, ' ');
      case 'H': return pad(f.H);
      case 'I': return pad(f.H % 12 === 0 ? 12 : f.H % 12);
      case 'p': return f.H < 12 ? 'AM' : 'PM';
      case 'M': return pad(f.M);
      case 'S': return pad(f.S);
      case 'f': return pad(f.f, 6);
      case 'a': return WEEKDAYS[f.wd].slice(0, 3);
      case 'A': return WEEKDAYS[f.wd];
      case 'w': return String((f.wd + 1) % 7);
      case 'u': return String(f.wd + 1);
      case 'b': return MONTHS[f.m - 1].slice(0, 3);
      case 'B': return MONTHS[f.m - 1];
      case 'j': return pad(f.yd, 3);
      case 'x': return `${pad(f.m)}/${pad(f.d)}/${pad(f.y % 100)}`;
      case 'X': return `${pad(f.H)}:${pad(f.M)}:${pad(f.S)}`;
      case 'c': return `${WEEKDAYS[f.wd].slice(0, 3)} ${MONTHS[f.m - 1].slice(0, 3)} ${String(f.d).padStart(2, ' ')} ${pad(f.H)}:${pad(f.M)}:${pad(f.S)} ${f.y}`;
      case '%': return '%';
      default: return all;
    }
  });
}

function strptime(s, fmt, loc) {
  const parts = { y: 1900, m: 1, d: 1, H: 0, M: 0, S: 0, f: 0, pm: null };
  let re = '^';
  const order = [];
  const name = (list) => `(${list.join('|')}|${list.map(x => x.slice(0, 3)).join('|')})`;
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === '%' && i + 1 < fmt.length) {
      const c = fmt[++i];
      const pat = { Y: '(\\d{4})', y: '(\\d{2})', m: '(\\d{1,2})', d: '(\\d{1,2})', H: '(\\d{1,2})', I: '(\\d{1,2})', M: '(\\d{1,2})',
        S: '(\\d{1,2})', f: '(\\d{1,6})', j: '(\\d{1,3})', p: '(AM|PM|am|pm)', b: name(MONTHS), B: name(MONTHS), a: name(WEEKDAYS), A: name(WEEKDAYS), '%': '%' }[c];
      if (pat === undefined) throw new PyError('ValueError', `strptime の書式 %${c} はまだ対応していません`, loc);
      re += pat;
      if (c !== '%') order.push(c);
    } else re += fmt[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s/, '\\s+');
  }
  const m = s.match(new RegExp(`${re}$`, 'i'));
  if (!m) throw new PyError('ValueError', `${repr(s)} は書式 ${repr(fmt)} に合いません`, loc);
  order.forEach((c, i) => {
    const t = m[i + 1];
    switch (c) {
      case 'Y': parts.y = Number(t); break;
      case 'y': parts.y = Number(t) + (Number(t) < 69 ? 2000 : 1900); break;
      case 'm': parts.m = Number(t); break;
      case 'd': parts.d = Number(t); break;
      case 'H': case 'I': parts.H = Number(t); break;
      case 'M': parts.M = Number(t); break;
      case 'S': parts.S = Number(t); break;
      case 'f': parts.f = Number(t.padEnd(6, '0')); break;
      case 'p': parts.pm = t.toUpperCase() === 'PM'; break;
      case 'b': case 'B': parts.m = MONTHS.findIndex(x => x.toLowerCase().startsWith(t.toLowerCase().slice(0, 3))) + 1; break;
      case 'j': { const [, mm, dd] = ordToYmd(ymdToOrd(parts.y, 1, 1) + Number(t) - 1); parts.m = mm; parts.d = dd; break; }
    }
  });
  if (parts.pm !== null && order.includes('I')) parts.H = (parts.H % 12) + (parts.pm ? 12 : 0);
  return makeDatetime(parts.y, parts.m, parts.d, parts.H, parts.M, parts.S, parts.f, loc);
}

// ── date ─────────────────────────────────────────────────────────────────────

const dateArgs = (args, kwargs, loc) => ['year', 'month', 'day'].map((k, i) => intArg(args[i] ?? kwargs[k], k, loc));
const dateIso = (v) => `${String(A(v).year).padStart(4, '0')}-${pad(A(v).month)}-${pad(A(v).day)}`;
const dateOrd = (v) => ymdToOrd(A(v).year, A(v).month, A(v).day);
/** 比べる値（date は通し日数、datetime はマイクロ秒）。種類が違えば null */
const cmpKey = (a, b) => {
  if (isDt(a) && isDt(b)) return [dtMicro(a), dtMicro(b)];
  if (isDate(a) && isDate(b)) return [BigInt(dateOrd(a)), BigInt(dateOrd(b))];
  if (isTd(a) && isTd(b)) return [tdMicro(a), tdMicro(b)];
  return null;
};
const comparisons = {
  __eq__: def('__eq__', ([a, b]) => { const k = cmpKey(a, b); return k ? k[0] === k[1] : false; }),
  __ne__: def('__ne__', ([a, b]) => { const k = cmpKey(a, b); return k ? k[0] !== k[1] : true; }),
  __lt__: def('__lt__', ([a, b]) => { const k = cmpKey(a, b); return k ? k[0] < k[1] : NOT_IMPL; }),
  __le__: def('__le__', ([a, b]) => { const k = cmpKey(a, b); return k ? k[0] <= k[1] : NOT_IMPL; }),
  __gt__: def('__gt__', ([a, b]) => { const k = cmpKey(a, b); return k ? k[0] > k[1] : NOT_IMPL; }),
  __ge__: def('__ge__', ([a, b]) => { const k = cmpKey(a, b); return k ? k[0] >= k[1] : NOT_IMPL; }),
};

Object.assign(DateClass.attrs, comparisons, {
  __init__: def('__init__', ([self, ...args], kwargs, ctx) => {
    const [y, m, d] = dateArgs(args, kwargs, ctx.loc);
    checkDate(y, m, d, ctx.loc);
    self.attrs = { year: y, month: m, day: d };
    return null;
  }),
  __repr__: def('__repr__', ([self]) => `datetime.date(${A(self).year}, ${A(self).month}, ${A(self).day})`),
  __str__: def('__str__', ([self]) => dateIso(self)),
  isoformat: def('isoformat', ([self]) => dateIso(self)),
  weekday: def('weekday', ([self]) => (dateOrd(self) + 6) % 7),
  isoweekday: def('isoweekday', ([self]) => ((dateOrd(self) + 6) % 7) + 1),
  toordinal: def('toordinal', ([self]) => dateOrd(self)),
  strftime: def('strftime', ([self, fmt]) => strftime(self, fmt)),
  replace: def('replace', ([self], kwargs, ctx) => makeDate(
    intArg(kwargs.year ?? A(self).year, 'year', ctx.loc), intArg(kwargs.month ?? A(self).month, 'month', ctx.loc), intArg(kwargs.day ?? A(self).day, 'day', ctx.loc), ctx.loc)),
  __add__: def('__add__', ([self, o], _k, ctx) => {
    if (!isTd(o)) return NOT_IMPL;
    return dateFromOrd(dateOrd(self) + A(o).days, ctx.loc);
  }),
  __radd__: def('__radd__', ([self, o], _k, ctx) => (isTd(o) ? dateFromOrd(dateOrd(self) + A(o).days, ctx.loc) : NOT_IMPL)),
  __sub__: def('__sub__', ([self, o], _k, ctx) => {
    if (isTd(o)) return dateFromOrd(dateOrd(self) - A(o).days, ctx.loc);
    if (isDate(o)) return tdFromMicro(BigInt(dateOrd(self) - dateOrd(o)) * 86400n * 1000000n);
    return NOT_IMPL;
  }),
  today: classmethod(def('today', ([cls], _k, ctx) => {
    const n = nowDatetime(ctx.rt, ctx.loc);
    return cls === DatetimeClass ? n : makeDate(A(n).year, A(n).month, A(n).day, ctx.loc);
  })),
  fromordinal: classmethod(def('fromordinal', ([, n], _k, ctx) => dateFromOrd(intArg(n, 'ordinal', ctx.loc), ctx.loc))),
  fromisoformat: classmethod(def('fromisoformat', ([cls, s], _k, ctx) => {
    const m = isStr(s) && s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/);
    if (!m) throw new PyError('ValueError', `日付の書き方として正しくありません: ${repr(s)}`, ctx.loc);
    const [y, mo, d, h = 0, mi = 0, sec = 0] = m.slice(1, 7).map(x => (x === undefined ? 0 : Number(x)));
    if (cls === DateClass) {
      if (m[4] !== undefined) throw new PyError('ValueError', `日付の書き方として正しくありません: ${repr(s)}`, ctx.loc);
      return makeDate(y, mo, d, ctx.loc);
    }
    return makeDatetime(y, mo, d, h, mi, sec, m[7] ? Number(m[7].padEnd(6, '0')) : 0, ctx.loc);
  })),
});

function dateFromOrd(n, loc) {
  if (n < 1 || n > 3652059) throw new PyError('OverflowError', '日付が範囲外です', loc);
  const [y, m, d] = ordToYmd(n);
  return makeDate(y, m, d, loc);
}

// ── datetime ─────────────────────────────────────────────────────────────────

const TIME_KEYS = ['hour', 'minute', 'second', 'microsecond'];
function dtIso(v, sep = 'T') {
  const a = A(v);
  return `${dateIso(v)}${sep}${pad(a.hour)}:${pad(a.minute)}:${pad(a.second)}${a.microsecond ? `.${pad(a.microsecond, 6)}` : ''}`;
}

Object.assign(DatetimeClass.attrs, comparisons, {
  __init__: def('__init__', ([self, ...args], kwargs, ctx) => {
    const [y, m, d] = dateArgs(args, kwargs, ctx.loc);
    const t = TIME_KEYS.map((k, i) => intArg(args[3 + i] ?? kwargs[k] ?? 0, k, ctx.loc));
    checkDate(y, m, d, ctx.loc);
    checkTime(...t, ctx.loc);
    self.attrs = { year: y, month: m, day: d, hour: t[0], minute: t[1], second: t[2], microsecond: t[3] };
    return null;
  }),
  __repr__: def('__repr__', ([self]) => {
    const a = A(self);
    const parts = [a.year, a.month, a.day, a.hour, a.minute, a.second, a.microsecond];
    while (parts.length > 5 && parts[parts.length - 1] === 0) parts.pop();   // 0 の秒・マイクロ秒は省く（CPython と同じ）
    return `datetime.datetime(${parts.join(', ')})`;
  }),
  __str__: def('__str__', ([self]) => dtIso(self, ' ')),
  isoformat: def('isoformat', ([self, sep = 'T']) => dtIso(self, sep)),
  date: def('date', ([self], _k, ctx) => makeDate(A(self).year, A(self).month, A(self).day, ctx.loc)),
  replace: def('replace', ([self], kwargs, ctx) => {
    const a = A(self);
    const v = (k) => intArg(kwargs[k] ?? a[k], k, ctx.loc);
    return makeDatetime(v('year'), v('month'), v('day'), v('hour'), v('minute'), v('second'), v('microsecond'), ctx.loc);
  }),
  timestamp: def('timestamp', ([self]) => {
    const a = A(self);
    return makeFloat(new Date(a.year, a.month - 1, a.day, a.hour, a.minute, a.second).getTime() / 1000 + a.microsecond / 1e6);
  }),
  __add__: def('__add__', ([self, o], _k, ctx) => (isTd(o) ? dtFromMicro(dtMicro(self) + tdMicro(o), ctx.loc) : NOT_IMPL)),
  __radd__: def('__radd__', ([self, o], _k, ctx) => (isTd(o) ? dtFromMicro(dtMicro(self) + tdMicro(o), ctx.loc) : NOT_IMPL)),
  __sub__: def('__sub__', ([self, o], _k, ctx) => {
    if (isTd(o)) return dtFromMicro(dtMicro(self) - tdMicro(o), ctx.loc);
    if (isDt(o)) return tdFromMicro(dtMicro(self) - dtMicro(o));
    return NOT_IMPL;
  }),
  now: classmethod(def('now', (_a, _k, ctx) => nowDatetime(ctx.rt, ctx.loc))),
  strptime: classmethod(def('strptime', ([, s, fmt], _k, ctx) => strptime(s, fmt, ctx.loc))),
  combine: classmethod(def('combine', ([, d, t], _k, ctx) => makeDatetime(A(d).year, A(d).month, A(d).day,
    ...(isDt(t) ? TIME_KEYS.map(k => A(t)[k]) : [0, 0, 0, 0]), ctx.loc))),
});

// ── timedelta ────────────────────────────────────────────────────────────────

const TD_UNITS = { weeks: 7 * 86400e6, days: 86400e6, hours: 3600e6, minutes: 60e6, seconds: 1e6, milliseconds: 1e3, microseconds: 1 };
const TD_POS = ['days', 'seconds', 'microseconds', 'milliseconds', 'minutes', 'hours', 'weeks'];

function tdStr(t) {
  const { days, seconds, microseconds } = A(t);
  const hms = `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}${microseconds ? `.${pad(microseconds, 6)}` : ''}`;
  return days ? `${days} day${Math.abs(days) === 1 ? '' : 's'}, ${hms}` : hms;
}

Object.assign(TimedeltaClass.attrs, comparisons, {
  __init__: def('__init__', ([self, ...args], kwargs, ctx) => {
    let intPart = 0n, fracMicro = 0;
    TD_POS.forEach((k, i) => {
      const v = args[i] ?? kwargs[k];
      if (v === undefined) return;
      if (!isNum(v)) throw new PyError('TypeError', `timedelta の ${k} には数が必要です（${typeName(v)} が渡されました）`, ctx.loc);
      if (isFloat(v)) fracMicro += v.v * TD_UNITS[k];
      else intPart += BigInt(num(v)) * BigInt(TD_UNITS[k]);
    });
    const t = tdFromMicro(intPart + BigInt(roundHalfEven(fracMicro)));
    self.attrs = t.attrs;
    return null;
  }),
  __repr__: def('__repr__', ([self]) => {
    const { days, seconds, microseconds } = A(self);
    const parts = [days && `days=${days}`, seconds && `seconds=${seconds}`, microseconds && `microseconds=${microseconds}`].filter(Boolean);
    return `datetime.timedelta(${parts.length ? parts.join(', ') : '0'})`;
  }),
  __str__: def('__str__', ([self]) => tdStr(self)),
  total_seconds: def('total_seconds', ([self]) => makeFloat(Number(tdMicro(self)) / 1e6)),
  __add__: def('__add__', ([a, b]) => (isTd(b) ? tdFromMicro(tdMicro(a) + tdMicro(b)) : NOT_IMPL)),
  __sub__: def('__sub__', ([a, b]) => (isTd(b) ? tdFromMicro(tdMicro(a) - tdMicro(b)) : NOT_IMPL)),
  __neg__: def('__neg__', ([a]) => tdFromMicro(-tdMicro(a))),
  __pos__: def('__pos__', ([a]) => a),
  __abs__: def('__abs__', ([a]) => (tdMicro(a) < 0n ? tdFromMicro(-tdMicro(a)) : a)),
  __bool__: def('__bool__', ([a]) => tdMicro(a) !== 0n),
  __mul__: def('__mul__', ([a, n]) => {
    if (isInt(n) || isBool(n)) return tdFromMicro(tdMicro(a) * BigInt(num(n)));
    if (isFloat(n)) return tdFromMicro(BigInt(roundHalfEven(Number(tdMicro(a)) * n.v)));
    return NOT_IMPL;
  }),
  __rmul__: def('__rmul__', ([a, n]) => TimedeltaClass.attrs.__mul__([a, n])),
  __truediv__: def('__truediv__', ([a, b], _k, ctx) => {
    if (isTd(b)) {
      if (tdMicro(b) === 0n) throw new PyError('ZeroDivisionError', '0 で割ることはできません', ctx.loc);
      return makeFloat(Number(tdMicro(a)) / Number(tdMicro(b)));
    }
    if (isNum(b)) {
      if (num(b) === 0) throw new PyError('ZeroDivisionError', '0 で割ることはできません', ctx.loc);
      return tdFromMicro(BigInt(roundHalfEven(Number(tdMicro(a)) / num(b))));
    }
    return NOT_IMPL;
  }),
  __floordiv__: def('__floordiv__', ([a, b], _k, ctx) => {
    if (isTd(b)) {
      if (tdMicro(b) === 0n) throw new PyError('ZeroDivisionError', '0 で割ることはできません', ctx.loc);
      const q = tdMicro(a) / tdMicro(b), r = tdMicro(a) % tdMicro(b);
      return normInt(r !== 0n && (r < 0n) !== (tdMicro(b) < 0n) ? q - 1n : q);
    }
    if (isInt(b)) {
      if (num(b) === 0) throw new PyError('ZeroDivisionError', '0 で割ることはできません', ctx.loc);
      const q = tdMicro(a) / BigInt(b), r = tdMicro(a) % BigInt(b);
      return tdFromMicro(r !== 0n && (r < 0n) !== (BigInt(b) < 0n) ? q - 1n : q);
    }
    return NOT_IMPL;
  }),
});

/** datetime モジュールの属性 */
export const makeDatetimeModule = () => ({
  date: DateClass, datetime: DatetimeClass, timedelta: TimedeltaClass, MINYEAR: 1, MAXYEAR: 9999,
});

// ── time モジュール ──────────────────────────────────────────────────────────

const clock = (rt) => Date.now() / 1000 + (rt?.clockOffset ?? 0);
const perf = (rt) => (globalThis.performance?.now?.() ?? Date.now()) / 1000 + (rt?.clockOffset ?? 0);

export const makeTimeModule = () => ({
  time: def('time', (_a, _k, ctx) => makeFloat(clock(ctx.rt))),
  time_ns: def('time_ns', (_a, _k, ctx) => normInt(BigInt(Math.round(clock(ctx.rt) * 1e6)) * 1000n)),
  perf_counter: def('perf_counter', (_a, _k, ctx) => makeFloat(perf(ctx.rt))),
  monotonic: def('monotonic', (_a, _k, ctx) => makeFloat(perf(ctx.rt))),
  process_time: def('process_time', (_a, _k, ctx) => makeFloat(perf(ctx.rt))),
  // 待たずに、実行ごとの仮の時計を進める（time() や datetime.now() は進んだ時刻になる）
  sleep: def('sleep', ([s], _k, ctx) => {
    if (!isNum(s)) throw new PyError('TypeError', `time.sleep() には数が必要です（${typeName(s)} が渡されました）`, ctx.loc);
    if (num(s) < 0) throw new PyError('ValueError', 'time.sleep() に負の数は使えません', ctx.loc);
    ctx.rt.clockOffset = (ctx.rt.clockOffset ?? 0) + num(s);
    return null;
  }),
  strftime: def('strftime', ([fmt], _k, ctx) => strftime(nowDatetime(ctx.rt, ctx.loc), fmt)),
  ctime: def('ctime', (_a, _k, ctx) => strftime(nowDatetime(ctx.rt, ctx.loc), '%c')),
});

