import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTsgoBin } from './tsgo-diagnostics';

const REPO_ROOT = resolve(__dirname, '..');

/**
 * A floating Effect — `floatingEffect` is on by default, so this fires without
 * any per-rule configuration.
 */
const SOURCE = `import { Effect } from 'effect';

export const program = Effect.gen(function* () {
  Effect.succeed(1);
  return yield* Effect.succeed(2);
});
`;

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    plugins: [{ name: '@effect/tsgo' }],
  },
  include: ['src/**/*.ts'],
};

interface Finding {
  readonly rule: string;
  readonly filePath: string;
  readonly line: number;
}

/**
 * The temp project lives inside the package so `effect`, `typescript` and
 * `@effect/tsgo` resolve through the normal parent-directory walk.
 */
const withProject = (fn: (dir: string, tsconfig: string) => void) => {
  const root = mkdtempSync(join(REPO_ROOT, '.tmp-tsgo-cli-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'program.ts'), SOURCE, 'utf8');
    const tsconfig = join(root, 'tsconfig.json');
    writeFileSync(tsconfig, JSON.stringify(TSCONFIG, null, 2), 'utf8');
    fn(join(root, 'src'), tsconfig);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const runLint = (args: readonly string[]) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

const parseFindings = (stdout: string): readonly Finding[] => {
  const start = stdout.indexOf('{');
  const parsed = JSON.parse(stdout.slice(start)) as { data?: readonly Finding[] };
  return parsed.data ?? [];
};

// The bridge shells out to a real Go binary; skip rather than fail when the
// optional peer is absent.
const describeWithTsgo = resolveTsgoBin() ? describe : describe.skip;

describeWithTsgo('cli --lint-source --tsgo', () => {
  it('merges type-aware tsgo diagnostics into the findings', () => {
    withProject((srcDir, tsconfig) => {
      const result = runLint([srcDir, '--lint-source', '--tsgo', tsconfig]);
      expect(result.status).toBe(0);

      const findings = parseFindings(result.stdout);
      const floating = findings.find((f) => f.rule === 'floatingEffect');

      // Regression guard: the bridge originally passed no --lspconfig, and
      // `effect-tsgo diagnostics` does not read plugin options from tsconfig,
      // so it reported filesChecked: 0 and this was silently always undefined.
      expect(floating).toBeDefined();
      expect(floating?.filePath).toMatch(/program\.ts$/);
      expect(floating?.line).toBe(4);
    });
  });

  it('reports only the built-in rules without --tsgo', () => {
    withProject((srcDir) => {
      const result = runLint([srcDir, '--lint-source']);
      expect(result.status).toBe(0);

      const rules = new Set(parseFindings(result.stdout).map((f) => f.rule));
      expect(rules.has('floatingEffect')).toBe(false);
      // ...but the source linter still runs.
      expect(rules.has('barrel-import-from-effect')).toBe(true);
    });
  });
});
