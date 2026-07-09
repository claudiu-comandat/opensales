import path from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '../../vitest.config.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'next/headers': path.resolve(__dirname, 'test/mocks/next-headers.ts'),
      },
    },
    test: {
      name: '@opensales/web',
      environment: 'jsdom',
      include: [
        'app/**/*.{test,spec}.{ts,tsx}',
        'lib/**/*.{test,spec}.{ts,tsx}',
        'components/**/*.{test,spec}.{ts,tsx}',
        'middleware.{test,spec}.ts',
      ],
      setupFiles: ['./test/setup.ts'],
    },
  }),
);
