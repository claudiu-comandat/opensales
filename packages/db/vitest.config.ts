import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@opensales/db',
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // DB integration tests share a single Postgres instance — run files sequentially
    // to avoid TRUNCATE lock contention between parallel workers.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
  },
});
