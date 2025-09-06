// esbuild.ui.mjs — bundle UI for VS Code webview (browser)
// Works with esbuild ≥ 0.23 (uses context API for watch)

import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/ui/app.ts'],
  outfile: 'out/ui/app.js',
  bundle: true,
  format: 'esm',          // Browser ES module
  platform: 'browser',    // No Node 'require'
  target: ['es2020'],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  // If you import assets directly, enable loaders:
  // loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'css' },
};

if (isWatch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('[esbuild] watching… (out/ui/app.js)');
} else {
  await build(opts);
  console.log('[esbuild] UI bundled → out/ui/app.js');
}