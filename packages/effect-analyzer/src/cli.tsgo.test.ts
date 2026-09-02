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
    plugins: [{ name: '@effect/language-service' }],
  },
  include: ['src/**/*.ts'],
};

interface Finding {
  readonly rule: string;
  readonly filePath: string;
  readonly line: number;
  readonly code?: number;
  readonly source?: string;
  readonly severity?: string;
}

/**
 * The temp project lives inside the package so `effect`, `typescript` and
 * `@effect/tsgo` resolve through the normal parent-directory walk.
 */
const withProject = (
  fn: (dir: string, tsconfig: string) => void,
  diagnosticSeverity?: Record<string, string>,
) => {
  const root = mkdtempSync(join(REPO_ROOT, '.tmp-tsgo-cli-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'program.ts'), SOURCE, 'utf8');
    const tsconfig = join(root, 'tsconfig.json');
    const plugin = diagnosticSeverity
      ? { name: '@effect/language-service', diagnosticSeverity }
      : { name: '@effect/language-service' };
    writeFileSync(
      tsconfig,
      JSON.stringify(
        { ...TSCONFIG, compilerOptions: { ...TSCONFIG.compilerOptions, plugins: [plugin] } },
        null,
        2,
      ),
      'utf8',
    );
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

describe('cli --lint-source --tsgo', () => {
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

  it('tells language-service findings apart from the analyzer’s own', () => {
    withProject((srcDir, tsconfig) => {
      const findings = parseFindings(
        runLint([srcDir, '--lint-source', '--tsgo', tsconfig]).stdout,
      );

      const floating = findings.find((f) => f.rule === 'floatingEffect');
      expect(floating?.source).toBe('tsgo');
      // Effect language service diagnostics occupy the 377xxx code range, so an
      // agent can prove a finding is advisory rather than a type-checker error.
      expect(floating?.code).toBeGreaterThanOrEqual(377_000);
      expect(floating?.code).toBeLessThan(378_000);

      const builtIn = findings.find((f) => f.rule === 'barrel-import-from-effect');
      expect(builtIn?.source).toBe('analyzer');
      expect(builtIn?.code).toBeUndefined();
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

describe('cli --lint-source --fail-on', () => {
  it('leaves the exit status alone when no gate is requested', () => {
    withProject(
      (srcDir, tsconfig) => {
        const result = runLint([srcDir, '--lint-source', '--tsgo', tsconfig]);
        // Advisory-only runs must not change the exit status, even with an
        // error-severity diagnostic present, or agents cannot tell an advisory
        // run apart from a broken one.
        expect(result.status).toBe(0);
        const severities = parseFindings(result.stdout).map((f) => f.severity);
        expect(severities).toContain('error');
      },
      { floatingEffect: 'error' },
    );
  });

  it('exits 1 when a finding reaches the requested severity', () => {
    withProject(
      (srcDir, tsconfig) => {
        const result = runLint([srcDir, '--lint-source', '--tsgo', tsconfig, '--fail-on=error']);
        expect(result.status).toBe(1);
      },
      { floatingEffect: 'error' },
    );
  });

  it('exits 0 when every finding is below the requested severity', () => {
    withProject(
      (srcDir, tsconfig) => {
        const result = runLint([srcDir, '--lint-source', '--tsgo', tsconfig, '--fail-on=error']);
        expect(result.status).toBe(0);
      },
      { floatingEffect: 'warning' },
    );
  });
});

describe('cli --lint-source --tsgo coverage', () => {
  /** A project where the tsconfig covers `src/` but not `extra/`. */
  const withPartialProject = (fn: (root: string, tsconfig: string) => void) => {
    const root = mkdtempSync(join(REPO_ROOT, '.tmp-tsgo-cov-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'extra'), { recursive: true });
      writeFileSync(join(root, 'src', 'program.ts'), SOURCE, 'utf8');
      writeFileSync(join(root, 'extra', 'other.ts'), SOURCE, 'utf8');
      const tsconfig = join(root, 'tsconfig.json');
      writeFileSync(tsconfig, JSON.stringify(TSCONFIG, null, 2), 'utf8');
      fn(root, tsconfig);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it('reports which scanned files the language service never checked', () => {
    withPartialProject((root, tsconfig) => {
      const result = runLint([root, '--lint-source', '--tsgo', tsconfig]);
      const start = result.stdout.indexOf('{');
      const envelope = JSON.parse(result.stdout.slice(start)) as {
        summary?: { tsgo?: { filesChecked?: number; unchecked?: readonly string[] } };
      };

      // extra/other.ts is linted by our AST rules but outside the tsconfig, so
      // its tsgo diagnostics silently never existed. A partial check must not
      // be reportable as a full one.
      expect(envelope.summary?.tsgo?.filesChecked).toBe(1);
      expect(envelope.summary?.tsgo?.unchecked).toEqual([
        join(root, 'extra', 'other.ts'),
      ]);
    });
  });
});
