/**
 * parse.test.js — 構文エラーの検出と説明（Lezer が見逃すインデントの誤りを含む）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/engine/parse.js';

const ERRORS = [
  ['コロン忘れ', 'if x > 1\n    print(x)\n', 1, '行末に「:」がありません'],
  ['閉じ括弧忘れ', 'print((1 + 2)\nx = 3\n', 1, '括弧が閉じていません'],
  ['字下げ忘れ', 'def f():\nreturn 1\n', 2, '「:」の次の行はインデント'],
  ['余計なインデント', 'x = 1\n    y = 2\n', 2, '予期しないインデント'],
  ['インデント不一致', 'if x:\n    a = 1\n  b = 2\n', 3, 'どの行ともそろっていません'],
  ['= と == の混同', 'if x = 1:\n    pass\n', 1, '「==」を使います'],
  ['文字列の閉じ忘れ', 'print("abc)\n', 1, '引用符が閉じていません'],
  ['JS 風の波括弧', 'if (x > 1) {\n    print(x)\n}\n', 1, '{ } ではなく'],
  ['if のない else', 'else:\n    pass\n', 1, '対応する if がない else'],
  ['タブと空白の混在', 'if x:\n\ty = 1\n        z = 2\n', 3, 'タブと空白が混ざっています'],
  ['未対応の構文', 'class A:\n    pass\n', 1, 'class はまだ対応していません'],
];

for (const [name, src, line, msg] of ERRORS) {
  test(`構文エラー: ${name}`, () => {
    assert.throws(() => parse(src), (e) => {
      assert.equal(e.name, 'SyntaxError');
      assert.equal(e.line, line);
      assert.match(e.message, new RegExp(msg.replace(/[{}()]/g, '\\$&')));
      return true;
    });
  });
}

const VALID = [
  ['1 行の if', 'if x: y = 1\nz = 2\n'],
  ['括弧の中の改行', 'x = [1,\n      2]\nif x:\n    pass\n'],
  ['三重引用符の文字列', 's = """a\n  b:\n"""\nt = 1\n'],
  ['コメントと空行', '# c\n\nif x:  # c\n\n    # c\n    y = 1\n'],
  ['行継続', 'x = 1 + \\\n    2\n'],
];
for (const [name, src] of VALID) {
  test(`正しいコード: ${name}`, () => { parse(src); });
}

test('AST: elif は入れ子の IfStatement、連鎖比較は CompareChain、括弧付きは連鎖にしない', () => {
  const ast = parse('if 1 < x <= 3:\n    pass\nelif (x < 1) < 2:\n    pass\nelse:\n    pass\n');
  const ifs = ast.body[0];
  assert.equal(ifs.type, 'IfStatement');
  assert.equal(ifs.test.type, 'CompareChain');
  assert.deepEqual(ifs.test.operators, ['<', '<=']);
  assert.equal(ifs.alternate.type, 'IfStatement');
  assert.equal(ifs.alternate.test.type, 'BinaryExpression');
  assert.equal(ifs.alternate.alternate.type, 'BlockStatement');
});

test('AST: 位置情報は JSInterpreter と同じ形（loc は 1 始まり、end は最終文字の列）', () => {
  const ast = parse('x = 1\nfoo(x)\n');
  const call = ast.body[1].expression;
  assert.deepEqual(call.loc, { line: 2, column: 1 });
  assert.deepEqual(call.end, { line: 2, column: 6 });
});
