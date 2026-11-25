/**
 * lang/python.js — Python の言語プロファイル（JSVisualizer のフロントエンドに渡す）
 *
 * JSVisualizer の src/lang/index.js の LanguageProfile の形。値の表現は ADR-002、トレースへの追加は ADR-003。
 */
import { python } from '@codemirror/lang-python';
import { PyDebugger, ExecutionError } from '../engine/py-debugger.js';
import {
  PyFloat, PyRange, isTuple, isDict, num, repr, strRepr,
} from '../engine/values.js';

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
    if (Array.isArray(v)) return v.map((x, i) => [i, x]);
    return Object.entries(v).filter(([k]) => !k.startsWith('__'));
  },
  length(v) {
    if (isDict(v)) return v.keys.length;
    if (Array.isArray(v)) return v.length;
    return Object.keys(v).filter(k => !k.startsWith('__')).length;
  },
  label(v) {
    if (isDict(v)) return `dict[${v.keys.length}]`;
    if (isTuple(v)) return `tuple[${v.length}]`;
    if (Array.isArray(v)) return `list[${v.length}]`;
    return 'object';
  },
  shortLabel(v) {
    if (isDict(v)) return 'dict';
    if (isTuple(v)) return 'tuple';
    if (Array.isArray(v)) return 'list';
    return 'object';
  },
  brackets(v) {
    if (isDict(v)) return ['{', '}'];
    if (isTuple(v)) return ['(', ')'];
    if (Array.isArray(v)) return ['[', ']'];
    return ['{', '}'];
  },
};

const SAMPLE_GROUP_KEYS = [
  { label: '─ Search ─',             keys: ['07_linear_search', '08_binary_search'] },
  { label: '─ Sort (basic) ─',        keys: ['05_bubble_sort', '06_selection_sort'] },
  { label: '─ Sort (advanced) ─',     keys: ['09_quick_sort', '10_merge_sort'] },
  { label: '─ Math / Algorithms ─',   keys: ['03_euclid_loop', '04_euclid_recursive', '02_factorial', '01_fibonacci', '13_fibonacci_dp', '16_big_factorial'] },
  { label: '─ Data Structures ─',     keys: ['11_sort_dicts', '14_binary_tree', '17_word_count'] },
  { label: '─ Scope / Python ─',      keys: ['12_closure', '15_python_features'] },
];

/**
 * Python の言語プロファイルを作る。
 * @param {Object<string, {label: string, code: string}>} samples 組み込みサンプル（ビルドでは samples/*.py から作る）
 * @returns {import('js-visualizer/src/lang/index.js').LanguageProfile}
 */
export const createPythonProfile = (samples) => ({
  id: 'python',
  name: 'Python',
  Debugger: PyDebugger,
  ExecutionError,
  editorExtension: () => python(),
  samples,
  sampleGroups: SAMPLE_GROUP_KEYS.map(g => ({ ...g, keys: g.keys.filter(k => k in samples) })),
  defaultSample: '01_fibonacci' in samples ? '01_fibonacci' : Object.keys(samples)[0],
  // for の各回（LoopBinding）でも行を作る。Python には宣言・++・C 形式の for はない
  traceRowTypes: {
    enter: ['ExpressionStatement', 'IfStatement', 'BreakStatement', 'ContinueStatement'],
    exit:  ['AssignmentExpression', 'ReturnStatement', 'CallExpression', 'LoopBinding'],
  },
  valueModel: pythonValueModel,
  syntaxTokens: [
    { cls: 'tok-comment', re: /(#[^\n]*)/g },
    { cls: 'tok-string',  re: /((?:[rRbBuUfF]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'))/g },
    { cls: 'tok-number',  re: /\b(\d+(?:\.\d+)?)\b/g },
    { cls: 'tok-keyword', re: /\b(def|return|if|elif|else|while|for|in|not|and|or|is|None|True|False|pass|break|continue|global|nonlocal|lambda|class|import|from|as|try|except|finally|raise|with|yield|del|assert|async|await)\b/g },
  ],
});
