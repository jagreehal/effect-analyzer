import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ts-morph project creation + type checking is CPU-heavy. At high
    // parallelism the heaviest fixture-sweep tests starve and time out, so cap
    // workers to keep each test fed. Pair with a generous timeout as a backstop.
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ['./vitest.setup.ts'],
    exclude: [
      ...configDefaults.exclude,
      '**/.analysis-output/**',
      '.analysis-output/**',
    ],
  },
});
