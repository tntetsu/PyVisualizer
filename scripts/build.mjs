/**
 * build.mjs — PyVisualizer のビルド
 *
 * JSVisualizer のフロントエンド（js-visualizer、作業ブランチ feature/multilang）を、Python の言語プロファイル
 * （src/lang/python.js）で起動する入口 src/app.js をバンドルし、web/ に出力する。
 *
 * - virtual:python-samples … samples/*.py を組み込みサンプルにする
 * - JSVisualizer の JS プロファイルが import する JS のエンジン（web/interpreter.bundle.js）は空の代わりに差し替える
 *   （Python のサイトには JS のエンジンを含めない）
 * - codemirror・@codemirror/*・@lezer/{common,highlight,lr} は JSVisualizer 側の 1 か所から解決する
 *   （CodeMirror は同じパッケージが 2 つ読み込まれると動かない）
 * - index.html・style.css は JSVisualizer からコピーし、画面の名前を PyVisualizer にする
 *
 *   node scripts/build.mjs          # web/ にビルド
 *   node scripts/build.mjs --serve  # ビルドして http://127.0.0.1:8123/ で配信
 */
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const JSV = realpathSync(join(ROOT, 'node_modules/js-visualizer'));
const WEB = join(ROOT, 'web');

/** samples/NN_name.py → { id, label, code } */
export function readSamples() {
  return readdirSync(join(ROOT, 'samples')).filter(f => f.endsWith('.py')).sort().map(f => {
    const id = f.replace(/\.py$/, '');
    const words = id.replace(/^\d+_/, '').split('_');
    const label = words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
    return { id, label, code: readFileSync(join(ROOT, 'samples', f), 'utf8') };
  });
}

const pyVisualizerPlugin = {
  name: 'py-visualizer',
  setup(build) {
    // 組み込みサンプル
    build.onResolve({ filter: /^virtual:python-samples$/ }, () => ({ path: 'python-samples', namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => {
      const samples = Object.fromEntries(readSamples().map(s => [s.id, { label: s.label, code: s.code }]));
      return { contents: `export const SAMPLES = ${JSON.stringify(samples)};`, loader: 'js' };
    });
    // JS のエンジンは含めない
    build.onResolve({ filter: /interpreter\.bundle\.js$/ }, () => ({ path: 'js-engine-stub', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export class JSDebugger {}\nexport class ExecutionError extends Error {}\n', loader: 'js',
    }));
    // CodeMirror と Lezer の共有パッケージは JSVisualizer 側から解決する
    build.onResolve({ filter: /^(codemirror|@codemirror\/(state|view|language|autocomplete|commands|lint|search)|@lezer\/(common|highlight|lr))$/ }, async (args) => {
      if (args.pluginData?.dedupe) return undefined;
      const r = await build.resolve(args.path, { kind: args.kind, resolveDir: JSV, pluginData: { dedupe: true } });
      return r.errors.length ? undefined : { path: r.path };
    });
  },
};

export async function build() {
  mkdirSync(join(WEB, 'samples'), { recursive: true });
  const html = readFileSync(join(JSV, 'web/index.html'), 'utf8')
    .replace('<title>JSVisualizer</title>', '<title>PyVisualizer</title>')
    .replace('<h1 class="app-title">JSVisualizer</h1>', '<h1 class="app-title">PyVisualizer</h1>');
  writeFileSync(join(WEB, 'index.html'), html);
  copyFileSync(join(JSV, 'web/style.css'), join(WEB, 'style.css'));

  // ?exercise= / ?code= で読める形でもサンプルを書き出す（確認用）
  const samples = readSamples();
  writeFileSync(join(WEB, 'samples/python.json'), JSON.stringify({ title: 'Python サンプル', codes: samples.map(s => ({ title: s.id, code: s.code })) }, null, 2));
  for (const s of samples) writeFileSync(join(WEB, `samples/${s.id}.json`), JSON.stringify({ title: s.id, code: s.code }));

  await esbuild.build({
    entryPoints: [join(ROOT, 'src/app.js')],
    bundle: true,
    format: 'esm',
    outfile: join(WEB, 'app.bundle.js'),
    plugins: [pyVisualizerPlugin],
    logLevel: 'warning',
  });
  return samples;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await build();
  console.log('built web/');
  if (process.argv.includes('--serve')) {
    const ctx = await esbuild.context({});
    const { port } = await ctx.serve({ servedir: WEB, host: '127.0.0.1', port: 8123 });
    console.log(`http://127.0.0.1:${port}/`);
  }
}
