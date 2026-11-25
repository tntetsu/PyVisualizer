/**
 * messages-en.test.js — エラーメッセージの英語化（src/engine/messages-en.js。ADR-010）
 *
 * エンジンのメッセージが増えたり変わったりしたときに英訳の漏れに気づけるよう、エンジンのソースから
 * 日本語のメッセージを集めて、すべて英語になることを確かめる（JSVisualizer の tests/utils/error-message.test.js と同じ方式）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bodyToEnglish, messageToEnglish } from '../src/engine/messages-en.js';
import { localizePythonError } from '../src/lang/python.js';
import { PyDebugger } from '../src/engine/py-debugger.js';
import { joinConsoleLines } from 'js-interpreter/core';

const JAPANESE = /[぀-ヿ一-鿿]/;
const ENGINE = new URL('../src/engine/', import.meta.url).pathname;

/** メッセージを組み立てる枠（本文ではない）や、メッセージの部品。これらは集めない */
const NOT_MESSAGES = new Set([
  '構文エラー（1行目）: 1',            // parse.js の PySyntaxError（枠）
  '1 はまだ対応していません',           // parse.js の PyUnsupportedError（枠。中身の名前は下で確かめる）
  '1: 1（1行目）',                      // values.js の PyError（枠）
  '1: 11行目）',                        // interpreter.js の raise（枠。入れ子のテンプレート文字列を行単位で抜き出すとこうなる）
  '1 個', '1〜1 個',                    // builtins.js の argCount（部品）
]);

/**
 * エンジンのソースから、メッセージの日本語の文字列リテラルを集める。
 * エラーを作る行（PyError・PySyntaxError・unsupported・構文エラーの説明の return [..]）と、その引数の続きの行が対象。
 * ${...} は 1 に置き換える（日本語を含む ${...} は空にする。キーワード専用引数の「キーワード専用」など）
 */
function collect() {
  const messages = new Set();
  const unsupportedNames = new Set();
  for (const f of readdirSync(ENGINE).filter(f => f.endsWith('.js') && f !== 'messages-en.js')) {
    for (const line of readFileSync(join(ENGINE, f), 'utf8').split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      const code = line.replace(/\s\/\/ .*$/, '');   // 行末のコメントを除く
      if (!/PyError\(|PySyntaxError\(|unsupported\(|return \[|^\s*[?:] `|^\s*`|super\(`/.test(code)) continue;
      for (const [, lit] of code.matchAll(/(`(?:[^`$]|\$\{[^}]*\})*`|'[^']*'|"[^"]*")/g)) {
        const text = lit.slice(1, -1)
          .replace(/\$\{([^}]*)\}/g, (_, expr) => (expr === 'want' ? '1 個' : JAPANESE.test(expr) ? '' : '1'));
        if (!JAPANESE.test(text) || NOT_MESSAGES.has(text)) continue;
        if (/unsupported\(/.test(code)) unsupportedNames.add(text); else messages.add(text);
      }
    }
  }
  return { messages: [...messages], unsupportedNames: [...unsupportedNames] };
}

const { messages, unsupportedNames } = collect();

test('メッセージを集められている', () => {
  assert.ok(messages.length > 80, `${messages.length} 件`);
  assert.ok(unsupportedNames.length > 15, `${unsupportedNames.length} 件`);
});

for (const msg of messages) {
  test(`英訳される：${msg}`, () => {
    const en = bodyToEnglish(/モジュール '1' に 1 はありません/.test(msg) ? 'ImportError' : 'TypeError', msg);
    assert.doesNotMatch(en, JAPANESE, en);
  });
}

for (const name of unsupportedNames) {
  test(`未対応の構文の名前が英訳される：${name}`, () => {
    const en = bodyToEnglish(null, `${name} はまだ対応していません`);
    assert.doesNotMatch(en, JAPANESE, en);
    assert.match(en, /is not supported yet$/);
  });
}

// ── 表示欄の文字列の形 ─────────────────────────────────────────────

test('構文エラー・実行時の例外の枠を英語にし、行番号を残す', () => {
  assert.equal(messageToEnglish('構文エラー（3行目）: 行末に「:」がありません'), "SyntaxError (line 3): expected ':'");
  assert.equal(messageToEnglish("NameError: 'totl' という名前は定義されていません（2行目）"), "NameError: name 'totl' is not defined (line 2)");
  assert.equal(messageToEnglish('ValueError（4行目）'), 'ValueError (line 4)');
});

test('raise で書いたメッセージはそのまま残す（枠の行番号だけ英語にする）', () => {
  assert.equal(messageToEnglish('ValueError: 点数がありません（5行目）'), 'ValueError: 点数がありません (line 5)');
});

test('日本語表示では何もしない。共通コアのメッセージは JS 用の英語化に任せる', () => {
  const msg = "NameError: 'x' という名前は定義されていません（1行目）";
  assert.equal(localizePythonError(msg, 'ja'), msg);
  assert.equal(localizePythonError('実行が最大ステップ数 50,000 を超えたため停止しました', 'en'),
    'Execution stopped because it exceeded the maximum of 50,000 steps');
});

test('同じ日本語でも、ImportError と AttributeError で英語を分ける', () => {
  assert.equal(bodyToEnglish('ImportError', "モジュール 'math' に tau2 はありません"), "cannot import name 'tau2' from 'math'");
  assert.equal(bodyToEnglish('AttributeError', "モジュール 'math' に tau2 はありません"), "module 'math' has no attribute 'tau2'");
});

// ── 実行時の str(e) ───────────────────────────────────────────────

const output = (src, lang) => joinConsoleLines(new PyDebugger(src, { lang }).consoleLogs).map(l => l.text);

test('英語表示で実行すると、except で捕まえた例外の str(e) が英語になる（日本語表示では日本語）', () => {
  const src = 'try:\n    [1, 2][5]\nexcept IndexError as e:\n    print(e)\n';
  assert.deepEqual(output(src, 'en'), ['list index out of range']);
  assert.deepEqual(output(src, 'ja'), ['list の範囲外の位置 5 を指定しています（長さ 2）']);
});
