/**
 * objects.js — クラス・インスタンス・例外（ADR-006）
 *
 * | Python | 表現 |
 * |---|---|
 * | クラス | PyClass（JS のクラスのインスタンス。スナップショットでは参照を保持する） |
 * | インスタンス | { __type__: 'PyInstance', cls, attrs: {…} }（attrs はその時点の属性としてスナップショットに残る） |
 * | 例外 | 例外のクラスのインスタンス（args に引数の tuple） |
 *
 * 特殊メソッド（__str__・__eq__ など）は、ユーザーのコードとして実行する（トレースに記録される）。
 * values.js の repr・pyEq などから呼べるよう、評価器が setInvoker() で呼び出しの関数を渡す。
 */
import { PyError, makeTuple, isStr } from './values.js';
import { runtimeBody } from './messages-en.js';

export class PyClass {
  /**
   * @param {string} name
   * @param {PyClass[]} bases
   * @param {Object<string, any>} attrs クラスの属性（メソッドを含む）
   */
  constructor(name, bases = [], attrs = {}, { builtin = false } = {}) {
    this.name = name;
    this.bases = bases;
    this.attrs = attrs;
    this.builtin = builtin;
    this.mro = computeMro(this);
  }
  toString() { return `<class '${this.name}'>`; }
}

/** C3 線形化で MRO を作る */
function computeMro(cls) {
  const seqs = [...cls.bases.map(b => [...b.mro]), [...cls.bases]];
  const out = [cls];
  for (;;) {
    const nonEmpty = seqs.filter(s => s.length);
    if (!nonEmpty.length) return out;
    const head = nonEmpty.map(s => s[0]).find(c => !nonEmpty.some(s => s.indexOf(c) > 0));
    if (!head) throw new PyError('TypeError', `クラス ${cls.name} の基底クラスの順序が矛盾しています（MRO を作れません）`);
    out.push(head);
    for (const s of nonEmpty) if (s[0] === head) s.shift();
  }
}

export const isClass = (v) => v instanceof PyClass;
export const isInstance = (v) => v !== null && typeof v === 'object' && v.__type__ === 'PyInstance';

export function makeInstance(cls) {
  return { __type__: 'PyInstance', cls, attrs: {} };
}

/** クラスの MRO をたどって属性を探す（見つからなければ undefined） */
export function classLookup(cls, name, start = 0) {
  for (let i = start; i < cls.mro.length; i++) {
    if (Object.prototype.hasOwnProperty.call(cls.mro[i].attrs, name)) return cls.mro[i].attrs[name];
  }
  return undefined;
}

export const isSubclass = (c, base) => c.mro.includes(base);

// ── 特殊メソッドの呼び出し ───────────────────────────────────────────────────

let invoker = null;
/** 評価器が、ユーザーの関数を呼ぶ関数を渡す（fn, args） => value */
export function setInvoker(f) { invoker = f; }

/** インスタンスのクラスに特殊メソッド name があれば呼んで結果を返す。なければ undefined */
export function callSpecial(inst, name, args = []) {
  if (!isInstance(inst)) return undefined;
  const m = classLookup(inst.cls, name);
  if (m === undefined || !invoker) return undefined;
  return invoker(m, [inst, ...args]);
}

// ── 組み込みの例外のクラス ───────────────────────────────────────────────────

const mk = (name, base) => new PyClass(name, base ? [base] : [], {}, { builtin: true });

/** すべてのクラスの基底 object */
export const ObjectClass = mk('object');

const BaseException = mk('BaseException', ObjectClass);
// BaseException.__init__：引数を args に入れる（ユーザー定義の例外が super().__init__(msg) を呼ぶため）
const baseInit = (args) => { const [self, ...rest] = args; self.args = makeTuple(rest); return null; };
baseInit.pyName = '__init__';
BaseException.attrs.__init__ = baseInit;
const Exception = mk('Exception', BaseException);
const ArithmeticError = mk('ArithmeticError', Exception);
const LookupError = mk('LookupError', Exception);
const RuntimeError = mk('RuntimeError', Exception);
const NameError = mk('NameError', Exception);

export const EXCEPTIONS = {
  BaseException, Exception, ArithmeticError, LookupError, RuntimeError, NameError,
  ZeroDivisionError: mk('ZeroDivisionError', ArithmeticError),
  OverflowError: mk('OverflowError', ArithmeticError),
  IndexError: mk('IndexError', LookupError),
  KeyError: mk('KeyError', LookupError),
  ValueError: mk('ValueError', Exception),
  TypeError: mk('TypeError', Exception),
  AttributeError: mk('AttributeError', Exception),
  AssertionError: mk('AssertionError', Exception),
  StopIteration: mk('StopIteration', Exception),
  UnboundLocalError: mk('UnboundLocalError', NameError),
  RecursionError: mk('RecursionError', RuntimeError),
  NotImplementedError: mk('NotImplementedError', RuntimeError),
  KeyboardInterrupt: mk('KeyboardInterrupt', BaseException),
  EOFError: mk('EOFError', Exception),
};
EXCEPTIONS.ImportError = mk('ImportError', Exception);
EXCEPTIONS.ModuleNotFoundError = mk('ModuleNotFoundError', EXCEPTIONS.ImportError);

export const isExceptionClass = (v) => isClass(v) && isSubclass(v, BaseException);
export const isException = (v) => isInstance(v) && isSubclass(v.cls, BaseException);

/** 例外のインスタンスを作る */
export function makeException(cls, args = []) {
  const e = makeInstance(cls);
  e.args = makeTuple(args);
  return e;
}

/**
 * Python の例外が送出されたことを表す JS の例外。exc は例外のインスタンス。
 * 実行が止まったときのメッセージは「型の名前: str(exc)」（CPython のトレースバックの最後の行と同じ形）。
 */
export class PyRaise extends Error {
  constructor(exc, loc, text) {
    super(text ?? exc.cls.name);
    this.name = exc.cls.name;
    this.pyType = exc.cls.name;
    this.exc = exc;
    this.loc = loc;
  }
}

/**
 * エンジン内部のエラー（PyError）や送出された例外（PyRaise）を、Python の例外のインスタンスにする。
 * 例外のクラスがない種類（NotImplemented：PyVisualizer の未対応）は null（except で捕まえない）。
 */
export function toPyException(err) {
  if (err instanceof PyRaise) return err.exc;
  if (err instanceof PyError) {
    const cls = EXCEPTIONS[err.pyType];
    if (!cls) return null;
    // str(e) は実行したときの表示言語にする（英語表示なら CPython と同じ文面。ADR-010）
    const e = makeException(cls, [runtimeBody(err.pyType, err.pyMessage ?? err.message)]);
    e.engineError = err;   // 捕まえずに実行が止まったときに、元の日本語のメッセージを出すため
    return e;
  }
  return null;
}

/** 例外の str（args が 1 つならそれ、なければ空、複数なら tuple の repr） */
export function exceptionText(exc, strFn, reprFn) {
  const args = exc.args ?? [];
  if (args.length === 0) return '';
  if (args.length === 1) return isStr(args[0]) ? args[0] : strFn(args[0]);
  return reprFn(args);
}
