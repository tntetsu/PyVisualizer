/**
 * build-spike.mjs — Phase 0 スパイク用のビルド
 *
 * JSVisualizer のフロントエンド（src/app.js）を改変せずにバンドルし、
 * debugger-adapter.js が import する `../../web/interpreter.bundle.js` だけを Python エンジン
 * （src/engine/py-debugger.js）に差し替える。index.html・style.css は JSVisualizer からコピーする。
 *
 *   node scripts/build-spike.mjs          # web/ にビルド
 *   node scripts/build-spike.mjs --serve  # ビルドして http://127.0.0.1:8123/ で配信
 */
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const JSV = realpathSync(join(ROOT, 'node_modules/js-visualizer'));
const WEB = join(ROOT, 'web');
const ENGINE = join(ROOT, 'src/engine/py-debugger.js');

const pythonEngine = {
  name: 'python-engine',
  setup(build) {
    build.onResolve({ filter: /interpreter\.bundle\.js$/ }, () => ({ path: ENGINE }));
  },
};

export async function buildSpike() {
  mkdirSync(join(WEB, 'samples'), { recursive: true });
  copyFileSync(join(JSV, 'web/index.html'), join(WEB, 'index.html'));
  copyFileSync(join(JSV, 'web/style.css'), join(WEB, 'style.css'));

  // Python のサンプルを JSVisualizer の ?exercise= / ?code= が読む形式で書き出す
  const files = readdirSync(join(ROOT, 'samples')).filter(f => f.endsWith('.py')).sort();
  const codes = files.map(f => ({ id: f.replace(/\.py$/, ''), title: f.replace(/\.py$/, ''), code: readFileSync(join(ROOT, 'samples', f), 'utf8') }));
  writeFileSync(join(WEB, 'samples/python.json'), JSON.stringify({ title: 'Python サンプル', codes }, null, 2));
  for (const c of codes) writeFileSync(join(WEB, `samples/${c.id}.json`), JSON.stringify({ title: c.title, code: c.code }));

  await esbuild.build({
    entryPoints: [join(JSV, 'src/app.js')],
    bundle: true,
    format: 'esm',
    outfile: join(WEB, 'app.bundle.js'),
    plugins: [pythonEngine],
    logLevel: 'warning',
  });
  return codes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildSpike();
  console.log('built web/');
  if (process.argv.includes('--serve')) {
    const ctx = await esbuild.context({});
    const { port } = await ctx.serve({ servedir: WEB, host: '127.0.0.1', port: 8123 });
    console.log(`http://127.0.0.1:${port}/?exercise=/samples/python.json`);
  }
}
