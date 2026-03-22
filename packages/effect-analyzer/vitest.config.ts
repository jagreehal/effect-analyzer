import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: '50%',
    setupFiles: ['./vitest.setup.ts'],
    exclude: [
      ...configDefaults.exclude,
      '**/.analysis-output/**',
      '.analysis-output/**',
    ],
  },
});
