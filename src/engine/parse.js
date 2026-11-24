/**
 * parse.js — Python ソース → AST（Phase 0 スパイク）
 *
 * Lezer（@lezer/python）の構文木を、JSInterpreter と同じ流儀の AST（type 付きプレーンオブジェクト）に変換する。
 * 意味が同じ構文は ESTree（JS）のノード型名を使い、Python 固有の構文には新しい型を足す
 * （docs/development-plan.md 2.1 節）。
 *
 * 位置情報は JSInterpreter に合わせる：loc = {line(1始まり), column(1始まり)}、
 * end = {line, column(0始まりの終端の直後 = 1始まりの最終文字)}。
 *
 * Lezer はインデントの誤り（余計なインデント・字下げの不一致・タブ混在）を検出しないため、
 * checkIndentation() で先に検査する（docs/phase0-report.md）。
 */
import { parser } from '@lezer/python';

export class PySyntaxError extends Error {
  constructor(message, line, column) {
    super(`構文エラー（${line}行目）: ${message}`);
    this.name   = 'SyntaxError';
    this.line   = line;
    this.column = column;
    this.loc    = { line, column };
  }
}

export class PyUnsupportedError extends PySyntaxError {
  constructor(what, line, column) {
    super(`${what} はまだ対応していません`, line, column);
  }
}

// ── 位置 ──────────────────────────────────────────────────────────────────────

function makePosMapper(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineOf = (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  return {
    loc(off) { const l = lineOf(off); return { line: l + 1, column: off - starts[l] + 1 }; },
    end(off) { const l = lineOf(Math.max(0, off - 1)); return { line: l + 1, column: off - starts[l] }; },
  };
}

// ── インデントの検査（Lezer が見逃す誤り） ──────────────────────────────────

/**
 * 論理行の先頭のインデントを検査する。括弧の中・三重引用符の文字列の中・行継続（\）の行は対象外。
 * @throws {PySyntaxError}
 */
export function checkIndentation(src) {
  const lines = src.split('\n');
  const stack = [''];
  let depth = 0;            // 括弧の深さ
  let tripleQuote = null;   // 三重引用符の文字列の中なら その引用符
  let continued = false;    // 前の行が \ で終わった
  let prevEndsColon = false;
  let prevHeaderNoColon = 0; // 直前の論理行が「:」のない if/while/def… の行ならその行番号
  let indentChar = null;    // 最初に使われたインデント文字（' ' または '\t'）

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineNo = li + 1;
    const logicalStart = depth === 0 && !tripleQuote && !continued;
    const trimmed = line.trim();

    if (logicalStart && trimmed !== '' && !trimmed.startsWith('#')) {
      const indent = line.match(/^[ \t]*/)[0];
      if (indent.includes(' ') && indent.includes('\t')) {
        throw new PySyntaxError('インデントにタブと空白が混ざっています（どちらかに統一してください）', lineNo, 1);
      }
      if (indent.length > 0) {
        if (indentChar === null) indentChar = indent[0];
        else if (indent[0] !== indentChar) {
          throw new PySyntaxError('インデントにタブと空白が混ざっています（どちらかに統一してください）', lineNo, 1);
        }
      }
      const top = stack[stack.length - 1];
      if (prevEndsColon) {
        if (indent.length <= top.length) {
          throw new PySyntaxError('「:」の次の行はインデント（字下げ）が必要です', lineNo, 1);
        }
        stack.push(indent);
      } else if (indent.length > top.length) {
        if (prevHeaderNoColon) throw new PySyntaxError('行末に「:」がありません', prevHeaderNoColon, 1);
        throw new PySyntaxError('予期しないインデントがあります（前の行と同じ深さにそろえてください）', lineNo, 1);
      } else if (indent.length < top.length) {
        while (stack.length > 1 && stack[stack.length - 1].length > indent.length) stack.pop();
        if (stack[stack.length - 1].length !== indent.length) {
          throw new PySyntaxError('インデントの深さが、外側のどの行ともそろっていません', lineNo, 1);
        }
      }
    }

    // この行を走査して、括弧の深さ・文字列・行末の状態を更新する
    let lastSignificant = '';
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (tripleQuote) {
        if (line.startsWith(tripleQuote, i)) { i += 3; tripleQuote = null; lastSignificant = '"'; continue; }
        if (c === '\\') { i += 2; continue; }
        i++; continue;
      }
      if (c === '#') break;
      if (c === '"' || c === "'") {
        if (line.startsWith(c.repeat(3), i)) { tripleQuote = c.repeat(3); i += 3; continue; }
        // 1 行の文字列：閉じる引用符まで読み飛ばす（閉じていなければ行末まで。Lezer がエラーにする）
        i++;
        while (i < line.length && line[i] !== c) { if (line[i] === '\\') i++; i++; }
        i++; lastSignificant = c; continue;
      }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
      if (!/\s/.test(c)) lastSignificant = c;
      i++;
    }
    continued = !tripleQuote && /\\\s*$/.test(line.replace(/#.*$/, ''));
    if (trimmed !== '' && !trimmed.startsWith('#') && depth === 0 && !tripleQuote && !continued) {
      // 「if x: pass」のように 1 行で本体まで書いた場合は行末が「:」でないので、次の行に字下げを求めない
      prevEndsColon = lastSignificant === ':' && HEADER_RE.test(trimmed);
      prevHeaderNoColon = HEADER_RE.test(trimmed) && !/:/.test(stripStringsAndComments(trimmed)) ? lineNo : 0;
    }
  }
}

function stripStringsAndComments(s) {
  return s.replace(/("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/g, '""').replace(/#.*$/, '');
}

// ── 構文エラーの説明（Lezer のエラーノード → 初学者向けの日本語） ─────────────

const HEADER_RE = /^\s*(if|elif|else|while|for|def|class|try|except|finally|with)\b/;

function explainSyntaxError(src, errFrom) {
  const pm = makePosMapper(src);
  const { line } = pm.loc(errFrom);
  const lines = src.split('\n');
  // エラー位置が行頭（直前の行の続きを待っていた）なら、直前の空でない行も見る
  const candidates = [line, line - 1].filter(l => l >= 1 && lines[l - 1].trim() !== '');
  for (const l of candidates) {
    const text = stripStringsAndComments(lines[l - 1]);
    if (/^\s*(else|elif)\b/.test(text) && l === line) {
      // 直前の同じ深さに if がないか、前の行で失敗していないか
      const indent = text.match(/^\s*/)[0].length;
      let k = l - 2;
      while (k >= 0 && (lines[k].trim() === '' || lines[k].match(/^\s*/)[0].length > indent)) k--;
      if (k < 0 || !/^\s*(if|elif|for|while|try|except)\b/.test(lines[k])) {
        return [`対応する if がない ${text.trim().split(/\b/)[0]} があります`, l];
      }
    }
    if (/^\s*(if|elif|while)\b[^=!<>]*[^=!<>]=[^=]/.test(text)) {
      return ['条件で等しいかを調べるときは「=」ではなく「==」を使います', l];
    }
    if (HEADER_RE.test(text) && /\{\s*$/.test(text)) {
      return ['Python ではブロックを { } ではなく「:」とインデントで表します', l];
    }
    if (HEADER_RE.test(text) && !/:\s*$/.test(text) && !/:\s*\S/.test(text)) {
      return ['行末に「:」がありません', l];
    }
  }
  // 引用符・括弧の閉じ忘れ
  for (let l = 1; l <= lines.length; l++) {
    const t = lines[l - 1].replace(/#.*$/, '');
    const dq = (t.match(/(?<!\\)"/g) || []).length, sq = (t.match(/(?<!\\)'/g) || []).length;
    if (!/"""|'''/.test(t) && (dq % 2 === 1 || (sq % 2 === 1 && dq === 0))) {
      return ['文字列の引用符が閉じていません', l];
    }
  }
  let depth = 0, openLine = 0;
  for (let l = 1; l <= lines.length; l++) {
    for (const c of stripStringsAndComments(lines[l - 1])) {
      if ('([{'.includes(c)) { if (depth === 0) openLine = l; depth++; }
      else if (')]}'.includes(c)) depth--;
    }
    if (depth < 0) return ['閉じ括弧が多すぎます', l];
  }
  if (depth > 0) return ['括弧が閉じていません', openLine];
  return ['書き方に誤りがあります', line];
}

// ── 文字列リテラル ──────────────────────────────────────────────────────────

const SIMPLE_ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v', '\n': '' };

function splitStringLiteral(raw) {
  const m = raw.match(/^([a-zA-Z]*)('''|"""|'|")/);
  const prefix = m[1].toLowerCase();
  const q = m[2];
  const body = raw.slice(m[0].length, raw.length - q.length);
  return { prefix, q, body, bodyOffset: m[0].length };
}

function unescape(body, isRaw) {
  if (isRaw) return body;
  return body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (all, e) => {
    if (e[0] === 'x' || (e[0] === 'u' && e.length === 5)) return String.fromCharCode(parseInt(e.slice(1), 16));
    return e in SIMPLE_ESCAPES ? SIMPLE_ESCAPES[e] : all;
  });
}

// ── 変換本体 ──────────────────────────────────────────────────────────────────

const COMPARE_OPS = new Set(['<', '>', '<=', '>=', '==', '!=', 'in', 'not in', 'is', 'is not']);

/**
 * @param {string} src
 * @returns {object} Program ノード
 * @throws {PySyntaxError}
 */
export function parse(src) {
  checkIndentation(src);
  const tree = parser.parse(src);
  let firstErr = null;
  tree.iterate({ enter: n => { if (n.type.isError && !firstErr) firstErr = n.from; } });
  if (firstErr !== null) {
    const [msg, line] = explainSyntaxError(src, firstErr);
    throw new PySyntaxError(msg, line, 1);
  }
  const pm = makePosMapper(src);
  const text = (n) => src.slice(n.from, n.to);
  const kids = (n) => {
    const out = [];
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.name !== 'Comment') out.push(c);
    return out;
  };
  const mk = (type, from, to, props) => ({ type, ...props, loc: pm.loc(from), end: pm.end(to), range: [from, to] });
  const unsupported = (what, n) => { const p = pm.loc(n.from); throw new PyUnsupportedError(what, p.line, p.column); };
  const isTok = (n, ...names) => names.includes(n.name);

  /** トークン（, や =）で子ノードを区切る */
  function splitBy(nodes, sepNames) {
    const groups = [[]];
    for (const c of nodes) {
      if (sepNames.includes(c.name)) groups.push([]);
      else groups[groups.length - 1].push(c);
    }
    return groups;
  }

  /** 「a, b」のようにカンマで並んだ式の並び → 1 個なら式、複数（または末尾カンマ）ならタプル */
  function exprList(nodes) {
    const groups = splitBy(nodes, [',']);
    const hasComma = groups.length > 1;
    const items = groups.filter(g => g.length > 0).map(g => {
      if (g.length !== 1) unsupported(`式「${g.map(text).join(' ')}」`, g[0]);
      return expr(g[0]);
    });
    if (!hasComma) return items[0];
    return mk('TupleExpression', nodes[0].from, nodes[nodes.length - 1].to, { elements: items });
  }

  function block(bodyNode) {
    const stmts = kids(bodyNode).filter(c => !isTok(c, ':'));
    const body = stmts.flatMap(stmt);
    const from = stmts.length ? stmts[0].from : bodyNode.from;
    const to = stmts.length ? stmts[stmts.length - 1].to : bodyNode.to;
    return mk('BlockStatement', from, to, { body });
  }

  function stmt(n) {
    const c = kids(n);
    switch (n.name) {
      case 'ExpressionStatement':
        return [mk('ExpressionStatement', n.from, n.to, { expression: expr(c[0]) })];

      case 'AssignStatement': {
        if (c.some(k => k.name === 'TypeDef')) unsupported('型注釈', n);
        const groups = splitBy(c, ['AssignOp']);
        if (groups.length !== 2) unsupported('「a = b = 1」のような連続代入', n);
        const left = exprList(groups[0]);
        const right = exprList(groups[1]);
        const assign = mk('AssignmentExpression', n.from, n.to, { operator: '=', left, right });
        return [mk('ExpressionStatement', n.from, n.to, { expression: assign })];
      }

      case 'UpdateStatement': {
        const opIdx = c.findIndex(k => k.name === 'UpdateOp');
        const left = exprList(c.slice(0, opIdx));
        const right = exprList(c.slice(opIdx + 1));
        const assign = mk('AssignmentExpression', n.from, n.to, { operator: text(c[opIdx]), left, right });
        return [mk('ExpressionStatement', n.from, n.to, { expression: assign })];
      }

      case 'IfStatement': {
        // if cond Body (elif cond Body)* (else Body)?  を入れ子の IfStatement に組み立てる
        const parts = [];
        for (let i = 0; i < c.length;) {
          if (isTok(c[i], 'if', 'elif')) { parts.push({ kw: c[i], test: c[i + 1], body: c[i + 2] }); i += 3; }
          else if (isTok(c[i], 'else')) { parts.push({ kw: c[i], test: null, body: c[i + 1] }); i += 2; }
          else i++;
        }
        let alternate = null;
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          if (!p.test) { alternate = block(p.body); continue; }
          alternate = mk('IfStatement', p.kw.from, (alternate ? alternate.range[1] : p.body.to), {
            test: expr(p.test), consequent: block(p.body), alternate,
          });
        }
        // 末尾の改行を含めないよう、if 文全体の終端は最後のブロックの終端にそろえる
        return [alternate];
      }

      case 'WhileStatement': {
        if (c.some(k => isTok(k, 'else'))) unsupported('while ... else', n);
        const body = block(c[2]);
        return [mk('WhileStatement', n.from, body.range[1], { test: expr(c[1]), body })];
      }

      case 'ForStatement': {
        if (c.some(k => isTok(k, 'else'))) unsupported('for ... else', n);
        const inIdx = c.findIndex(k => isTok(k, 'in'));
        const left = exprList(c.slice(1, inIdx));
        const right = exprList(c.slice(inIdx + 1, c.length - 1));
        const body = block(c[c.length - 1]);
        return [mk('ForOfStatement', n.from, body.range[1], { left, right, body, await: false })];
      }

      case 'FunctionDefinition': {
        if (c.some(k => isTok(k, 'async'))) unsupported('async def', n);
        const nameNode = c.find(k => k.name === 'VariableName');
        const paramList = c.find(k => k.name === 'ParamList');
        const body = block(c.find(k => k.name === 'Body'));
        return [mk('FunctionDeclaration', n.from, body.range[1], {
          id: mk('Identifier', nameNode.from, nameNode.to, { name: text(nameNode) }),
          params: params(paramList),
          body,
        })];
      }

      case 'ReturnStatement': {
        const rest = c.slice(1);
        return [mk('ReturnStatement', n.from, n.to, { argument: rest.length ? exprList(rest) : null })];
      }
      case 'PassStatement':     return [mk('EmptyStatement', n.from, n.to, {})];
      case 'BreakStatement':    return [mk('BreakStatement', n.from, n.to, { label: null })];
      case 'ContinueStatement': return [mk('ContinueStatement', n.from, n.to, { label: null })];
      case 'ScopeStatement':
        return [mk('GlobalStatement', n.from, n.to, {
          kind: text(c[0]), names: c.filter(k => k.name === 'VariableName').map(text),
        })];
      case 'StatementGroup':    // 「a = 1; b = 2」
        return c.filter(k => !isTok(k, ';')).flatMap(stmt);

      case 'ClassDefinition':   return unsupported('class', n);
      case 'TryStatement':      return unsupported('try 文', n);
      case 'WithStatement':     return unsupported('with 文', n);
      case 'ImportStatement':   return unsupported('import', n);
      case 'RaiseStatement':    return unsupported('raise', n);
      case 'DeleteStatement':   return unsupported('del', n);
      case 'AssertStatement':   return unsupported('assert', n);
      case 'MatchStatement':    return unsupported('match 文', n);
      case 'Decorator':         return unsupported('デコレーター', n);
      default:                  return unsupported(`文「${n.name}」`, n);
    }
  }

  function params(paramList) {
    const inner = kids(paramList).filter(k => !isTok(k, '(', ')'));
    return splitBy(inner, [',']).filter(g => g.length).map(g => {
      if (g[0].name !== 'VariableName') unsupported(`引数「${g.map(text).join('')}」（*args など）`, g[0]);
      const id = mk('Identifier', g[0].from, g[0].to, { name: text(g[0]) });
      if (g.length === 1) return id;
      if (g[1].name === 'TypeDef' || g.length !== 3) unsupported('引数の型注釈', g[0]);
      return mk('AssignmentPattern', g[0].from, g[2].to, { left: id, right: expr(g[2]) });
    });
  }

  function stringValue(n) {
    if (n.name === 'ContinuedString') return kids(n).map(stringValue).join('');
    const { prefix, body } = splitStringLiteral(text(n));
    if (prefix.includes('b')) unsupported('bytes', n);
    return unescape(body, prefix.includes('r'));
  }

  function formatString(n) {
    const raw = text(n);
    const { prefix, q, bodyOffset } = splitStringLiteral(raw);
    const isRaw = prefix.includes('r');
    const quasis = [], expressions = [], specs = [];
    let pos = n.from + bodyOffset;
    const stop = n.to - q.length;
    const pushQuasi = (from, to) => {
      const s = unescape(src.slice(from, to).replace(/\{\{/g, '{').replace(/\}\}/g, '}'), isRaw);
      quasis.push({ type: 'TemplateElement', value: { raw: s, cooked: s } });
    };
    for (const r of kids(n)) {
      if (r.name !== 'FormatReplacement') continue;
      pushQuasi(pos, r.from);
      const rk = kids(r).filter(k => !isTok(k, '{', '}'));
      if (rk.some(k => k.name === 'FormatConversion')) unsupported('f 文字列の !r などの変換', r);
      const spec = rk.find(k => k.name === 'FormatSpec');
      if (spec && kids(spec).some(k => k.name === 'FormatReplacement')) unsupported('f 文字列の入れ子の書式指定', r);
      expressions.push(exprList(rk.filter(k => k.name !== 'FormatSpec')));
      specs.push(spec ? src.slice(spec.from + 1, spec.to) : '');
      pos = r.to;
    }
    pushQuasi(pos, stop);
    return mk('TemplateLiteral', n.from, n.to, { quasis, expressions, formatSpecs: specs });
  }

  function isCompare(n) {
    if (n.name !== 'BinaryExpression') return false;
    const op = binOp(kids(n)).op;
    return COMPARE_OPS.has(op);
  }

  /** BinaryExpression の子 → { left, op, right } */
  function binOp(c) {
    const left = c[0], right = c[c.length - 1];
    const op = c.slice(1, -1).map(text).join(' ');
    return { left, op, right };
  }

  function expr(n) {
    const c = kids(n);
    switch (n.name) {
      case 'Number': {
        const raw = text(n).replace(/_/g, '');
        if (/[jJ]$/.test(raw)) unsupported('複素数', n);
        if (/^0[xob]/i.test(raw)) return mk('Literal', n.from, n.to, { value: Number(raw), raw: text(n) });
        const isFloat = /[.eE]/.test(raw);
        return mk('Literal', n.from, n.to, { value: Number(raw), raw: text(n), pyKind: isFloat ? 'float' : 'int' });
      }
      case 'String':
      case 'ContinuedString':
        return mk('Literal', n.from, n.to, { value: stringValue(n), raw: text(n) });
      case 'FormatString':
        return formatString(n);
      case 'Boolean':
        return mk('Literal', n.from, n.to, { value: text(n) === 'True', raw: text(n) });
      case 'None':
        return mk('Literal', n.from, n.to, { value: null, raw: 'None' });
      case 'VariableName':
        return mk('Identifier', n.from, n.to, { name: text(n) });
      case 'ParenthesizedExpression': {
        const inner = expr(c.find(k => !isTok(k, '(', ')')));
        inner.parenthesized = true;
        return inner;
      }
      case 'TupleExpression': {
        const inner = c.filter(k => !isTok(k, '(', ')'));
        const elements = splitBy(inner, [',']).filter(g => g.length).map(g => expr(g[0]));
        return mk('TupleExpression', n.from, n.to, { elements });
      }
      case 'ArrayExpression': {
        const inner = c.filter(k => !isTok(k, '[', ']'));
        const elements = splitBy(inner, [',']).filter(g => g.length).map(g => {
          if (g[0].name === '*' || isTok(g[0], '*')) unsupported('リストの中の *', g[0]);
          return expr(g[0]);
        });
        return mk('ArrayExpression', n.from, n.to, { elements });
      }
      case 'DictionaryExpression': {
        const inner = c.filter(k => !isTok(k, '{', '}'));
        const entries = splitBy(inner, [',']).filter(g => g.length).map(g => {
          if (g.length !== 3) unsupported('辞書の ** 展開', g[0]);
          return { key: expr(g[0]), value: expr(g[2]) };
        });
        return mk('DictExpression', n.from, n.to, { entries });
      }
      case 'UnaryExpression': {
        const op = text(c[0]);
        return mk('UnaryExpression', n.from, n.to, { operator: op, prefix: true, argument: expr(c[1]) });
      }
      case 'BinaryExpression': {
        const { left, op, right } = binOp(c);
        if (op === 'and' || op === 'or') {
          return mk('LogicalExpression', n.from, n.to, { operator: op, left: expr(left), right: expr(right) });
        }
        if (COMPARE_OPS.has(op)) {
          const l = expr(left);
          // 括弧のない比較の連鎖（a < b < c）は 1 つの CompareChain にまとめる
          if (isCompare(left) && !l.parenthesized) {
            const prev = l.type === 'CompareChain' ? l : {
              operators: [l.operator], operands: [l.left, l.right],
            };
            return mk('CompareChain', n.from, n.to, {
              operators: [...prev.operators, op], operands: [...prev.operands, expr(right)],
            });
          }
          return mk('BinaryExpression', n.from, n.to, { operator: op, left: l, right: expr(right) });
        }
        if (op === '@') unsupported('@ 演算子', n);
        return mk('BinaryExpression', n.from, n.to, { operator: op, left: expr(left), right: expr(right) });
      }
      case 'ConditionalExpression': {
        const ifIdx = c.findIndex(k => isTok(k, 'if'));
        const elseIdx = c.findIndex(k => isTok(k, 'else'));
        return mk('ConditionalExpression', n.from, n.to, {
          consequent: expr(c[ifIdx - 1]), test: expr(c[ifIdx + 1]), alternate: expr(c[elseIdx + 1]),
        });
      }
      case 'CallExpression': {
        const argList = c[c.length - 1];
        const inner = kids(argList).filter(k => !isTok(k, '(', ')'));
        const args = splitBy(inner, [',']).filter(g => g.length).map(g => {
          if (g.length === 3 && g[1].name === 'AssignOp') {
            return mk('KeywordArgument', g[0].from, g[2].to, { name: text(g[0]), value: expr(g[2]) });
          }
          if (g.length !== 1) unsupported(`引数「${g.map(text).join('')}」（*args や内包表記など）`, g[0]);
          return expr(g[0]);
        });
        return mk('CallExpression', n.from, n.to, { callee: expr(c[0]), arguments: args, optional: false });
      }
      case 'MemberExpression': {
        const object = expr(c[0]);
        if (isTok(c[1], '.')) {
          const p = c[2];
          return mk('MemberExpression', n.from, n.to, {
            object, computed: false, optional: false,
            property: mk('Identifier', p.from, p.to, { name: text(p) }),
          });
        }
        const inner = c.slice(2, -1); // [ ... ] の中身
        let property;
        if (inner.some(k => isTok(k, ':'))) {
          const parts = splitBy(inner, [':']);
          if (parts.length > 3) unsupported('この形のスライス', n);
          const [lower, upper, step] = parts.map(g => (g.length ? expr(g[0]) : null));
          property = mk('SliceExpression', c[1].to, c[c.length - 1].from, { lower, upper, step: step ?? null });
        } else {
          property = exprList(inner);
        }
        return mk('MemberExpression', n.from, n.to, { object, property, computed: true, optional: false });
      }
      case 'LambdaExpression': {
        const pl = c.find(k => k.name === 'ParamList');
        const bodyNode = c[c.length - 1];
        return mk('ArrowFunctionExpression', n.from, n.to, {
          params: pl ? params(pl) : [], body: expr(bodyNode), expression: true, async: false, isLambda: true,
        });
      }
      case 'ArrayComprehensionExpression':
      case 'DictionaryComprehensionExpression':
      case 'SetComprehensionExpression':
      case 'ComprehensionExpression':
        return unsupported('内包表記', n);
      case 'SetExpression':   return unsupported('集合（set）', n);
      case 'AwaitExpression': return unsupported('await', n);
      case 'YieldExpression': return unsupported('yield', n);
      default:                return unsupported(`式「${text(n)}」`, n);
    }
  }

  const top = tree.topNode;
  const body = kids(top).flatMap(stmt);
  return mk('Program', 0, src.length, { body, sourceType: 'script' });
}
