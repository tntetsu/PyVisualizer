/**
 * lang/python.js — Python の言語プロファイル（JSVisualizer のフロントエンドに渡す）
 *
 * JSVisualizer の src/lang/index.js の LanguageProfile の形。値の表現は ADR-002、トレースへの追加は ADR-003。
 */
import { python } from '@codemirror/lang-python';
import { PyDebugger, ExecutionError } from '../engine/py-debugger.js';
import {
  PyFloat, PyRange, isTuple, isSet, isDict, num, repr, strRepr,
} from '../engine/values.js';
import { isClass, isInstance, isException } from '../engine/objects.js';
import { messageToEnglish } from '../engine/messages-en.js';
import { getLang } from 'js-visualizer/src/i18n.js';
import { localizeErrorMessage } from 'js-visualizer/src/utils/error-message.js';

/**
 * 画面の表示言語で実行する PyDebugger（except で捕まえた例外の str(e) が表示言語になる。ADR-010）。
 * options.lang を渡せば、それを優先する
 */
export class DisplayLangPyDebugger extends PyDebugger {
  constructor(source, options = {}) {
    super(source, { lang: getLang(), ...options });
  }
}

/**
 * エラーの表示欄の文字列を表示言語に合わせる（ADR-010）。エンジンのメッセージは日本語で作られるので、英語表示のときだけ置き換える。
 * PyVisualizer の形でないメッセージ（共通コアの「最大ステップ数を超えた」など）は、JS 用の英語化に任せる
 * @param {string} message
 * @param {'ja'|'en'} lang
 */
export function localizePythonError(message, lang) {
  if (lang !== 'en') return message;
  return messageToEnglish(message) ?? localizeErrorMessage(message, lang);
}

/** Python の値の見せ方（JSVisualizer の ValueModel） */
export const pythonValueModel = {
  kind(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'none';
    switch (typeof v) {
      case 'boolean':  return 'bool';
      case 'number':
      case 'bigint':   return 'number';
      case 'string':   return 'string';
      case 'function': return 'native';
      case 'symbol':   return 'other';
    }
    if (v instanceof PyFloat) return 'number';
    if (v instanceof PyRange) return 'other';
    if (isClass(v)) return 'class';
    if (isInstance(v)) return 'object';
    if (v.__type__ === 'JSFunction') return 'function';
    if (isDict(v)) return 'mapping';
    if (Array.isArray(v)) return 'sequence';
    return 'object';
  },
  numberValue: (v) => num(v),
  literal(v) {
    if (v === undefined) return 'None';
    if (typeof v === 'string') return strRepr(v);
    return repr(v);
  },
  entries(v) {
    if (isDict(v)) return v.keys.map((k, i) => [repr(k), v.values[i]]);
    if (isInstance(v)) return [...(isException(v) ? [['args', v.args]] : []), ...Object.entries(v.attrs)];
    if (Array.isArray(v)) return v.map((x, i) => [i, x]);
    return Object.entries(v).filter(([k]) => !k.startsWith('__'));
  },
  length(v) {
    if (isDict(v)) return v.keys.length;
    if (isInstance(v)) return Object.keys(v.attrs).length + (isException(v) ? 1 : 0);
    if (Array.isArray(v)) return v.length;
    return Object.keys(v).filter(k => !k.startsWith('__')).length;
  },
  label(v) {
    if (isInstance(v)) return v.cls.name;
    if (isDict(v)) return `dict[${v.keys.length}]`;
    if (isTuple(v)) return `tuple[${v.length}]`;
    if (isSet(v)) return `set[${v.length}]`;
    if (Array.isArray(v)) return `list[${v.length}]`;
    return 'object';
  },
  shortLabel(v) {
    if (isInstance(v)) return v.cls.name;
    if (isDict(v)) return 'dict';
    if (isTuple(v)) return 'tuple';
    if (isSet(v)) return 'set';
    if (Array.isArray(v)) return 'list';
    return 'object';
  },
  brackets(v) {
    if (isDict(v)) return ['{', '}'];
    if (isTuple(v)) return ['(', ')'];
    if (isSet(v)) return ['{', '}'];   // set は JS の配列で表す（sequence）。かっこだけ { }
    if (Array.isArray(v)) return ['[', ']'];
    if (isInstance(v)) return [`${v.cls.name}{`, '}'];   // Dog{name: 'Rex'}。辞書と区別する（ADR-009）
    return ['{', '}'];
  },
  // Python の書き方：かっこの内側に空白を入れない（{'a': 1}）、空の集合は set()、1 要素の tuple は (1,)（ADR-009）
  padMapping: false,
  emptyText: (v) => (isSet(v) ? 'set()' : null),
  trailingComma: (v, count) => isTuple(v) && count === 1,
};


/**
 * Python の言語プロファイルを作る。
 * @param {Object<string, {label: string, code: string}>} samples 組み込みサンプル（ビルドでは samples/*.py と samples.json から作る）
 * @param {{ groups?: {label: string, keys: string[]}[], defaultSample?: string }} [opts] サンプル選択の分類と既定のサンプル
 * @returns {import('js-visualizer/src/lang/index.js').LanguageProfile}
 */
export const createPythonProfile = (samples, { groups, defaultSample } = {}) => ({
  id: 'python',
  name: 'Python',
  Debugger: DisplayLangPyDebugger,
  ExecutionError,
  localizeError: localizePythonError,
  editorExtension: () => python(),
  supportsInput: true,   // 入力欄を出し、実行時に { stdin } を渡す（input()。ADR-007）
  samples,
  sampleGroups: groups ?? [{ label: '─ Samples ─', keys: Object.keys(samples) }],
  defaultSample: defaultSample ?? Object.keys(samples)[0],
  // for の各回（LoopBinding）でも行を作る。Python には宣言・++・C 形式の for はない
  traceRowTypes: {
    enter: ['ExpressionStatement', 'IfStatement', 'BreakStatement', 'ContinueStatement', 'RaiseStatement', 'AssertStatement'],
    exit:  ['AssignmentExpression', 'ReturnStatement', 'CallExpression', 'LoopBinding', 'ExceptBinding'],
  },
  valueModel: pythonValueModel,
  syntaxTokens: [
    { cls: 'tok-comment', re: /(#[^\n]*)/g },
    { cls: 'tok-string',  re: /((?:[rRbBuUfF]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'))/g },
    { cls: 'tok-number',  re: /\b(\d+(?:\.\d+)?)\b/g },
    { cls: 'tok-keyword', re: /\b(def|return|if|elif|else|while|for|in|not|and|or|is|None|True|False|pass|break|continue|global|nonlocal|lambda|class|import|from|as|try|except|finally|raise|with|yield|del|assert|async|await)\b/g },
  ],
});
