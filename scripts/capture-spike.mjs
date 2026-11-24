/**
 * capture-spike.mjs — Phase 0：全サンプル×全タブのスクリーンショットとブラウザのエラーを集める
 *
 *   node scripts/capture-spike.mjs <出力ディレクトリ> [サンプルid...]
 *
 * 比較用に、JSVisualizer（JS 版、../JSVisualizer/web の公開版ビルド）の同じアルゴリズムのサンプルも撮る。
 */
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSpike } from './build-spike.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(process.argv[2] ?? 'spike-shots');
const only = process.argv.slice(3);
mkdirSync(OUT, { recursive: true });

const codes = await buildSpike();
const pyCtx = await esbuild.context({});
const py = await pyCtx.serve({ servedir: join(ROOT, 'web'), host: '127.0.0.1', port: 8124 });
const jsCtx = await esbuild.context({});
const js = await jsCtx.serve({ servedir: join(realpathSync(join(ROOT, 'node_modules/js-visualizer')), 'web'), host: '127.0.0.1', port: 8125 });

const browser = await chromium.launch();
const report = [];

async function capture(label, url, prepare) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (prepare) await prepare(page);
  await page.click('#btn-run');
  await page.waitForTimeout(400);
  const runError = await page.locator('#error-msg').evaluate(el => (el.hidden ? '' : el.textContent.trim()));
  const tabs = await page.locator('#view-tabs [data-view]').evaluateAll(els => els.map(e => e.dataset.view));
  // 途中の状態（人にやさしい単位で 12 ステップ）と最後の状態を撮る
  for (const [pos, act] of [['mid', async () => {
                              if (await page.locator('#btn-start').isEnabled()) await page.click('#btn-start');
                              for (let i = 0; i < 12 && await page.locator('#btn-human-forward').isEnabled(); i++) await page.click('#btn-human-forward');
                            }],
                            ['end', async () => { if (await page.locator('#btn-end').isEnabled()) await page.click('#btn-end'); }]]) {
    await act();
    for (const t of tabs) {
      await page.click(`#view-tabs [data-view="${t}"]`);
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(OUT, `${label}__${pos}__${t}.png`) });
    }
  }
  report.push({ label, runError, errors: [...new Set(errors)], tabs });
  await page.close();
}

for (const c of codes) {
  if (only.length && !only.includes(c.id)) continue;
  await capture(`py_${c.id}`, `http://127.0.0.1:${py.port}/?code=/samples/${c.id}.json`);
}
// 比較用：JS 版の同じアルゴリズムのサンプル
for (const key of ['fibonacci', 'bubbleSort', 'binarySearch', 'closure']) {
  if (only.length && !only.includes(key)) continue;
  await capture(`js_${key}`, `http://127.0.0.1:${js.port}/`, async (page) => {
    await page.selectOption('#sample-select', key);
    await page.waitForTimeout(200);
  });
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
for (const r of report) console.log(r.label.padEnd(26), r.runError ? `RUN-ERROR: ${r.runError}` : 'ok', r.errors.length ? `\n    ${r.errors.join('\n    ')}` : '');
await browser.close();
await pyCtx.dispose(); await jsCtx.dispose();
