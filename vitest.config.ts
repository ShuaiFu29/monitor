import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@monitor/types': path.resolve(__dirname, 'packages/types/src'),
      '@monitor/utils': path.resolve(__dirname, 'packages/utils/src'),
      '@monitor/core': path.resolve(__dirname, 'packages/core/src'),
      '@monitor/browser': path.resolve(__dirname, 'packages/browser/src'),
      '@monitor/error': path.resolve(__dirname, 'packages/error/src'),
      '@monitor/performance': path.resolve(__dirname, 'packages/performance/src'),
      '@monitor/network': path.resolve(__dirname, 'packages/network/src'),
      '@monitor/behavior': path.resolve(__dirname, 'packages/behavior/src'),
      '@monitor/transport': path.resolve(__dirname, 'packages/transport/src'),
      '@monitor/replay': path.resolve(__dirname, 'packages/replay/src'),
      '@monitor/web-vitals': path.resolve(__dirname, 'packages/web-vitals/src'),
    },
  },
});
