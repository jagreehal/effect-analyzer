import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  parseTsgoProjectArgument,
  parseTsgoOutput,
  readTsgoLspConfig,
  resolveTsgoBin,
  resolveTsgoProjectPath,
  runTsgoDiagnostics,
} from './tsgo-diagnostics';

const SAMPLE = JSON.stringify({
  diagnostics: [
    {
      file: '/repo/src/a.ts',
      start: 10,
      length: 5,
      line: 3,
      column: 7,
      endLine: 3,
      endColumn: 12,
      severity: 'error',
      code: 377024,
      name: 'floatingEffect',
      message: 'This Effect is neither yielded nor assigned.',
    },
    {
      file: '/repo/src/b.ts',
      start: 1,
      length: 1,
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 2,
      severity: 'message',
      code: 377065,
      name: 'globalConsoleInEffect',
      message: 'Use Effect.log.',
    },
  ],
  summary: { filesChecked: 2, totalFiles: 2, errors: 1, warnings: 0, messages: 1 },
});

describe('tsgo-diagnostics', () => {
  it('maps diagnostics and downgrades "message" to info', () => {
    const parsed = parseTsgoOutput(SAMPLE);
    expect(parsed).toEqual([
      {
        filePath: '/repo/src/a.ts',
        rule: 'floatingEffect',
        severity: 'error',
        message: 'This Effect is neither yielded nor assigned.',
        line: 3,
        column: 7,
      },
      {
        filePath: '/repo/src/b.ts',
        rule: 'globalConsoleInEffect',
        severity: 'info',
        message: 'Use Effect.log.',
        line: 1,
        column: 1,
      },
    ]);
  });

  it('tolerates leading noise on stdout', () => {
    expect(parseTsgoOutput(`Checking project...\n${SAMPLE}`)).toHaveLength(2);
  });

  it('returns undefined instead of throwing on unusable output', () => {
    expect(parseTsgoOutput('')).toBeUndefined();
    expect(parseTsgoOutput('no json here')).toBeUndefined();
    expect(parseTsgoOutput('{ broken')).toBeUndefined();
    expect(parseTsgoOutput('{"summary":{}}')).toBeUndefined();
  });

  describe('readTsgoLspConfig', () => {
    const withTsconfig = (contents: string, fn: (path: string) => void) => {
      const root = mkdtempSync(join(tmpdir(), 'effect-analyze-lspconfig-'));
      try {
        const p = join(root, 'tsconfig.json');
        writeFileSync(p, contents, 'utf8');
        fn(p);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };

    it('forwards the plugin options, dropping the name', () => {
      withTsconfig(
        JSON.stringify({
          compilerOptions: {
            plugins: [
              { name: 'other-plugin', diagnosticSeverity: { ignored: 'error' } },
              { name: '@effect/tsgo', diagnosticSeverity: { floatingEffect: 'error' } },
            ],
          },
        }),
        (p) => {
          expect(JSON.parse(readTsgoLspConfig(p))).toEqual({
            diagnosticSeverity: { floatingEffect: 'error' },
          });
        },
      );
    });

    it('falls back to rule defaults when there is no plugin entry', () => {
      withTsconfig(JSON.stringify({ compilerOptions: {} }), (p) => {
        expect(readTsgoLspConfig(p)).toBe('{}');
      });
    });

    it('parses comments and trailing commas accepted by tsconfig', () => {
      withTsconfig(
        `{
          // Keep CLI diagnostics aligned with the editor.
          "compilerOptions": {
            "plugins": [{
              "name": "@effect/tsgo",
              "diagnosticSeverity": { "globalConsoleInEffect": "warning" },
            }],
          },
        }`,
        (p) => {
          expect(JSON.parse(readTsgoLspConfig(p))).toEqual({
            diagnosticSeverity: { globalConsoleInEffect: 'warning' },
          });
        },
      );
    });

    it('follows inherited plugin options', () => {
      const root = mkdtempSync(join(tmpdir(), 'effect-analyze-lspconfig-extends-'));
      try {
        writeFileSync(
          join(root, 'base.json'),
          JSON.stringify({
            compilerOptions: {
              plugins: [
                {
                  name: '@effect/tsgo',
                  diagnosticSeverity: { globalErrorInEffectFailure: 'error' },
                },
              ],
            },
          }),
          'utf8',
        );
        const project = join(root, 'tsconfig.json');
        writeFileSync(project, '{ "extends": "./base.json" }', 'utf8');

        expect(JSON.parse(readTsgoLspConfig(project))).toEqual({
          diagnosticSeverity: { globalErrorInEffectFailure: 'error' },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('falls back to rule defaults on an unreadable tsconfig', () => {
      expect(readTsgoLspConfig('/nonexistent/tsconfig.json')).toBe('{}');
    });
  });

  describe('CLI argument handling', () => {
    it('does not consume the source path when bare --tsgo appears first', () => {
      expect(parseTsgoProjectArgument(['--tsgo', './src'], 0, false)).toEqual({
        project: 'tsconfig.json',
        consumed: 0,
      });
    });

    it('retains the documented separated project argument after a source path', () => {
      expect(
        parseTsgoProjectArgument(['./src', '--tsgo', './configs/tsconfig.json'], 1, true),
      ).toEqual({
        project: './configs/tsconfig.json',
        consumed: 1,
      });
    });

    it('resolves a relative project against the requested child-process cwd', () => {
      expect(resolveTsgoProjectPath('configs/tsconfig.json', '/repo')).toBe(
        '/repo/configs/tsconfig.json',
      );
    });
  });

  it('resolves the effect-tsgo binary from the installed peer', () => {
    expect(resolveTsgoBin()).toMatch(/effect-tsgo/);
  });

  it('fails clearly when the project path is bogus', () => {
    expect(() => runTsgoDiagnostics({ project: 'no-such-tsconfig.json' })).toThrow(
      /No files to check|diagnostics failed/,
    );
  }, 60_000);

  it('runs the real binary and returns parsed diagnostics', () => {
    const result = runTsgoDiagnostics({ project: 'tsconfig.json' });
    expect(Array.isArray(result)).toBe(true);
    for (const d of result ?? []) {
      expect(d.filePath).toMatch(/\.tsx?$/);
      expect(['error', 'warning', 'info']).toContain(d.severity);
      expect(d.line).toBeGreaterThan(0);
    }
  }, 120_000);

  it('resolves the peer and consumer TypeScript when invoked from another cwd', () => {
    const packageRoot = resolve(__dirname, '..');
    const root = mkdtempSync(join(packageRoot, '.tmp-tsgo-cwd-'));
    let shortTmp: string | undefined;
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(
        join(root, 'src', 'program.ts'),
        `import { Effect } from 'effect';
export const program = Effect.gen(function* () {
  Effect.succeed(1);
  return yield* Effect.succeed(2);
});
`,
        'utf8',
      );
      const project = join(root, 'tsconfig.json');
      writeFileSync(
        project,
        JSON.stringify({
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
        }),
        'utf8',
      );

      // Run in a child process rooted somewhere unrelated rather than calling
      // `process.chdir()`. The point of the test is that the *host* process's
      // cwd is nowhere near the consumer project, so `@effect/tsgo` has to
      // resolve that consumer's TypeScript instead of falling back on this
      // package's own. `process.chdir()` expressed that but mutates global
      // state, and it throws outright under a worker-based runner — which is
      // how Stryker executes the suite, so it blocked mutation testing
      // entirely.
      const helper = join(root, 'run-diagnostics.mts');
      writeFileSync(
        helper,
        `import { runTsgoDiagnostics } from ${JSON.stringify(join(__dirname, 'tsgo-diagnostics.ts'))};\n` +
          `const result = runTsgoDiagnostics({ project: ${JSON.stringify(project)} });\n` +
          `process.stdout.write(JSON.stringify(result ?? []));\n`,
        'utf8',
      );

      // `tsx` opens a unix socket under TMPDIR and the socket path limit is
      // ~104 bytes, but `vitest.setup.ts` points TMPDIR at a long repo-local
      // path — so the child gets a short one, and uses it as the unrelated cwd
      // too. Same constraint the runtime-probe tests work around.
      shortTmp = mkdtempSync(join(sep, 'tmp', 'tsgo-cwd-'));
      const tsxCli = join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const run = spawnSync(process.execPath, [tsxCli, helper], {
        cwd: shortTmp,
        encoding: 'utf8',
        timeout: 110_000,
        env: { ...process.env, TMPDIR: shortTmp, TMP: shortTmp, TEMP: shortTmp },
      });

      expect(run.stderr).not.toContain('Unable to resolve @effect/tsgo');
      expect(run.status).toBe(0);
      const result = JSON.parse(run.stdout) as readonly { rule: string }[];
      expect(result.some((diagnostic) => diagnostic.rule === 'floatingEffect')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      if (shortTmp) rmSync(shortTmp, { recursive: true, force: true });
    }
  }, 120_000);
});
