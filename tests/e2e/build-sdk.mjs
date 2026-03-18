/**
 * Build a single IIFE bundle for E2E testing using esbuild
 * Usage: node tests/e2e/build-sdk.mjs
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

await build({
  entryPoints: [path.resolve(__dirname, 'sdk-entry.ts')],
  bundle: true,
  outfile: path.resolve(__dirname, 'fixtures/monitor-sdk.js'),
  format: 'iife',
  globalName: 'MonitorSDK',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  alias: {
    '@monitor/types': path.resolve(ROOT, 'packages/types/src'),
    '@monitor/utils': path.resolve(ROOT, 'packages/utils/src'),
    '@monitor/core': path.resolve(ROOT, 'packages/core/src'),
    '@monitor/browser': path.resolve(ROOT, 'packages/browser/src'),
    '@monitor/error': path.resolve(ROOT, 'packages/error/src'),
    '@monitor/performance': path.resolve(ROOT, 'packages/performance/src'),
    '@monitor/network': path.resolve(ROOT, 'packages/network/src'),
    '@monitor/behavior': path.resolve(ROOT, 'packages/behavior/src'),
    '@monitor/transport': path.resolve(ROOT, 'packages/transport/src'),
    '@monitor/replay': path.resolve(ROOT, 'packages/replay/src'),
  },
  tsconfig: path.resolve(ROOT, 'tsconfig.json'),
});

console.log('✅ E2E SDK bundle built at tests/e2e/fixtures/monitor-sdk.js');
