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
 * - マニュアル（manual/manual.html・manual.en.html と manual/ja・manual/en のスクリーンショット）を web/ にコピーする
 *
 *   node scripts/build.mjs          # web/ にビルド
 *   node scripts/build.mjs --serve  # ビルドして http://127.0.0.1:8123/ で配信
 */
import * as esbuild from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const JSV = realpathSync(join(ROOT, 'node_modules/js-visualizer'));
const WEB = join(ROOT, 'web');

/**
 * samples/*.py と samples/samples.json（表示名・分類・既定のサンプル）を読む。
 * samples.json に書いていない .py や、.py のない項目があればエラーにする。
 * @returns {{ samples: {id, label, code}[], groups: {label, keys}[], defaultSample: string }}
 */
export function readSamples() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'samples/samples.json'), 'utf8'));
  const files = readdirSync(join(ROOT, 'samples')).filter(f => f.endsWith('.py')).map(f => f.replace(/\.py$/, '')).sort();
  const labels = new Map(manifest.groups.flatMap(g => g.items));
  const missing = files.filter(id => !labels.has(id));
  const orphan = [...labels.keys()].filter(id => !files.includes(id));
  if (missing.length || orphan.length) {
    throw new Error(`samples/samples.json と samples/*.py が食い違っています（未登録: ${missing.join(', ') || 'なし'}、ファイルなし: ${orphan.join(', ') || 'なし'}）`);
  }
  return {
    samples: files.map(id => ({ id, label: labels.get(id), code: readFileSync(join(ROOT, 'samples', `${id}.py`), 'utf8') })),
    groups: manifest.groups.map(g => ({ label: g.label, keys: g.items.map(([id]) => id) })),
    defaultSample: manifest.default,
  };
}

const pyVisualizerPlugin = {
  name: 'py-visualizer',
  setup(build) {
    // 組み込みサンプル
    build.onResolve({ filter: /^virtual:python-samples$/ }, () => ({ path: 'python-samples', namespace: 'virtual' }));
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => {
      const { samples, groups, defaultSample } = readSamples();
      const map = Object.fromEntries(samples.map(s => [s.id, { label: s.label, code: s.code }]));
      return {
        contents: `export const SAMPLES = ${JSON.stringify(map)};\n`
          + `export const SAMPLE_GROUPS = ${JSON.stringify(groups)};\n`
          + `export const DEFAULT_SAMPLE = ${JSON.stringify(defaultSample)};\n`,
        loader: 'js',
      };
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
  // マニュアル（manual/ が元。「使い方」のボタンが web/manual.html・manual.en.html を開く）
  for (const f of ['manual.html', 'manual.en.html']) copyFileSync(join(ROOT, 'manual', f), join(WEB, f));
  for (const lang of ['ja', 'en']) {
    if (existsSync(join(ROOT, 'manual', lang))) cpSync(join(ROOT, 'manual', lang), join(WEB, 'manual', lang), { recursive: true });
  }

  // ?exercise= / ?code= で読める形でもサンプルを書き出す（確認用）
  const { samples } = readSamples();
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
