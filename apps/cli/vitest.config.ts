import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@opensales/cli',
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
