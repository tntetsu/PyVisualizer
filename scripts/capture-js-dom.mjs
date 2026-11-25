/**
 * capture-js-dom.mjs — JSVisualizer（JS 版）の画面の状態を記録する（Phase 3 の回帰確認用）
 *
 * 指定した JSVisualizer の web/ を配信し、組み込みサンプルと記事の題材のすべてで、いくつかのステップ位置で
 * 全タブの #view-container の HTML・コンソール・ステップの表示・エラー表示を JSON に保存する。
 * main と作業ブランチのビルドで取った JSON を比べて、JS 版の見た目が変わっていないことを確かめる。
 *
 *   node scripts/capture-js-dom.mjs <JSVisualizer のディレクトリ> <出力 JSON> [--shots <PNG の出力先>] [--skip <題材>,...]
 *
 * 結果は 1 本ごとに出力 JSON に書き出す（途中で止めても、そこまでの結果が残る）。
 * 既定で、上限（50,000 ステップ）まで回る無限ループの題材（articles/12-list-bug.json）は除く。
 * 全タブの描画に非常に時間がかかるため。JS の実行結果そのものは scripts/compare-js-core.mjs で比べている。
 *   node scripts/capture-js-dom.mjs --compare <A.json> <B.json>
 */
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

if (process.argv[2] === '--compare') {
  const a = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let diff = 0;
  for (const k of keys) {
    if (a[k] !== b[k]) {
      diff++;
      if (diff <= 15) {
        const x = a[k] ?? '', y = b[k] ?? '';
        let i = 0; while (i < x.length && x[i] === y[i]) i++;
        console.log(`✗ ${k}\n    A: …${x.slice(Math.max(0, i - 60), i + 100)}\n    B: …${y.slice(Math.max(0, i - 60), i + 100)}`);
      }
    }
  }
  console.log(`${keys.size} 件を比較：${diff === 0 ? 'すべて一致' : `${diff} 件で不一致`}`);
  process.exit(diff === 0 ? 0 : 1);
}

const JSV = resolve(process.argv[2]);
const OUT = resolve(process.argv[3]);
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > 0 ? resolve(process.argv[shotsIdx + 1]) : null;
const skipIdx = process.argv.indexOf('--skip');
const SKIP = new Set(skipIdx > 0 ? process.argv[skipIdx + 1].split(',') : ['12-list-bug.json']);
const onlyIdx = process.argv.indexOf('--only');   // 例：--only sample:bubbleSort
const ONLY = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split(',')) : null;
const WAIT = Number(process.env.TAB_WAIT ?? 60);  // タブを切り替えてから記録するまでの待ち時間（ms）
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const ctx = await esbuild.context({});
const { port } = await ctx.serve({ servedir: join(JSV, 'web'), host: '127.0.0.1', port: Number(process.env.PORT ?? 8131) });
const base = `http://127.0.0.1:${port}/`;

// 対象：組み込みサンプル（セレクタの値）と、記事の題材（?code=）
const articles = readdirSync(join(JSV, 'web/samples/articles')).filter(f => f.endsWith('.json') && !f.includes('.en.') && !SKIP.has(f)).sort();

const browser = await chromium.launch();
const result = {};

async function capture(label, url, select) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: 'ja-JP' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  if (select) { await page.selectOption('#sample-select', select); await page.waitForTimeout(100); }
  console.log(label);
  // クリックは DOM の click() で行う（ツールチップなどが重なっても止まらないように）
  const domClick = (sel) => page.evaluate((q) => document.querySelector(q)?.click(), sel);
  await domClick('#btn-run');
  await page.waitForTimeout(300);
  const tabs = await page.locator('#view-tabs [data-view]').evaluateAll(els => els.map(e => e.dataset.view));
  const click = async (id, n = 1) => {
    for (let i = 0; i < n; i++) {
      if (!(await page.locator(id).isEnabled())) break;
      await domClick(id);
    }
  };
  const positions = [
    ['start', async () => {}],
    ['human5', async () => click('#btn-human-forward', 5)],
    ['expr3', async () => click('#btn-expr-forward', 3)],
    ['human20', async () => click('#btn-human-forward', 15)],
    ['end', async () => click('#btn-end')],
  ];
  for (const [pos, act] of positions) {
    await act();
    for (const t of tabs) {
      await domClick(`#view-tabs [data-view="${t}"]`);
      await page.waitForTimeout(WAIT);
      const state = await page.evaluate(() => ({
        view: document.querySelector('#view-container')?.innerHTML ?? '',
        console: document.querySelector('#console-panel')?.innerText ?? '',
        counter: document.querySelector('#step-counter')?.textContent ?? '',
        error: document.querySelector('#error-msg')?.hidden ? '' : document.querySelector('#error-msg')?.innerText ?? '',
        code: document.querySelector('#code-display')?.innerHTML ?? '',
      }));
      result[`${label}|${pos}|${t}`] = JSON.stringify(state);
      if (SHOTS && pos === 'human20') await page.screenshot({ path: join(SHOTS, `${label}__${t}.png`) });
    }
  }
  result[`${label}|pageerrors`] = errors.join('\n');
  await context.close();
  writeFileSync(OUT, JSON.stringify(result));   // 1 本ごとに書き出す
}

const samples = await (async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  const vals = await page.locator('#sample-select option').evaluateAll(os => os.filter(o => o.value && !o.disabled).map(o => o.value));
  await context.close();
  return vals;
})();

for (const s of samples) if (!ONLY || ONLY.has(`sample:${s}`)) await capture(`sample:${s}`, base, s);
for (const a of articles) if (!ONLY || ONLY.has(`article:${a}`)) await capture(`article:${a}`, `${base}?code=samples/articles/${a}`);

writeFileSync(OUT, JSON.stringify(result));
console.log(`${samples.length} サンプル・${articles.length} 記事（除外：${[...SKIP].join(', ')}）、${Object.keys(result).length} 件を保存：${OUT}`);
await browser.close();
await ctx.dispose();
