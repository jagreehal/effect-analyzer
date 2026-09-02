/**
 * `effect-analyze diagnostics` — a drop-in replacement for
 * `effect-tsgo diagnostics` that also reports the analyzer's own rules.
 *
 * These tests pin the contract that makes it safe to swap: the same flags, the
 * same exit-code behaviour, and one merged stream where every entry says which
 * checker produced it.
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..');

/** A floating Effect (`floatingEffect`) plus a barrel import (analyzer rule). */
const SOURCE = `import { Effect } from 'effect';

export const program = Effect.gen(function* () {
  Effect.succeed(1);
  return yield* Effect.succeed(2);
});
`;

const withProject = (
  fn: (root: string, tsconfig: string) => void,
  diagnosticSeverity?: Record<string, string>,
) => {
  const root = mkdtempSync(join(REPO_ROOT, '.tmp-tsgo-diag-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'program.ts'), SOURCE, 'utf8');
    const plugin = diagnosticSeverity
      ? { name: '@effect/language-service', diagnosticSeverity }
      : { name: '@effect/language-service' };
    const tsconfig = join(root, 'tsconfig.json');
    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          plugins: [plugin],
        },
        include: ['src/**/*.ts'],
      }),
      'utf8',
    );
    fn(root, tsconfig);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const run = (args: readonly string[]) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

interface Entry {
  readonly name: string;
  readonly source: string;
  readonly severity: string;
  readonly code: number;
}

const parse = (stdout: string): readonly Entry[] => {
  const start = stdout.indexOf('{');
  const parsed = JSON.parse(stdout.slice(start)) as { diagnostics?: readonly Entry[] };
  return parsed.diagnostics ?? [];
};

describe('effect-analyze diagnostics', () => {
  it('reports language service and analyzer findings in one stream', () => {
    withProject((_root, tsconfig) => {
      const result = run(['diagnostics', '--project', tsconfig, '--format', 'json']);
      const entries = parse(result.stdout);

      const sources = new Set(entries.map((e) => e.source));
      expect(sources).toContain('tsgo');
      expect(sources).toContain('analyzer');
      expect(entries.find((e) => e.name === 'floatingEffect')?.code).toBeGreaterThanOrEqual(
        377_000,
      );
      // Analyzer entries carry a code outside the Effect range, so a consumer
      // filtering on 377xxx keeps seeing exactly what effect-tsgo showed it.
      expect(entries.find((e) => e.source === 'analyzer')?.code).toBe(0);
    });
  });

  it('filters by severity the way effect-tsgo does', () => {
    withProject(
      (_root, tsconfig) => {
        const result = run([
          'diagnostics',
          '--project',
          tsconfig,
          '--format',
          'json',
          '--severity',
          'error',
        ]);
        const severities = new Set(parse(result.stdout).map((e) => e.severity));
        expect(severities).toEqual(new Set(['error']));
      },
      { floatingEffect: 'error' },
    );
  });

  // effect-tsgo exits 1 when any error is present, and --strict additionally
  // counts warnings. A drop-in replacement has to agree on both.
  it('exits 1 on an error, matching effect-tsgo', () => {
    withProject(
      (_root, tsconfig) => {
        const result = run(['diagnostics', '--project', tsconfig, '--format', 'json']);
        expect(result.status).toBe(1);
      },
      { floatingEffect: 'error' },
    );
  });

  it('ignores warnings unless --strict, matching effect-tsgo', () => {
    withProject(
      (_root, tsconfig) => {
        expect(run(['diagnostics', '--project', tsconfig, '--format', 'json']).status).toBe(0);
        expect(
          run(['diagnostics', '--project', tsconfig, '--format', 'json', '--strict']).status,
        ).toBe(1);
      },
      { floatingEffect: 'warning' },
    );
  });

  it('can be made advisory-only with --fail-on=none', () => {
    withProject(
      (_root, tsconfig) => {
        const result = run([
          'diagnostics',
          '--project',
          tsconfig,
          '--format',
          'json',
          '--fail-on=none',
        ]);
        expect(result.status).toBe(0);
      },
      { floatingEffect: 'error' },
    );
  });

  it('emits GitHub workflow commands for CI', () => {
    withProject(
      (_root, tsconfig) => {
        const result = run([
          'diagnostics',
          '--project',
          tsconfig,
          '--format',
          'github-actions',
        ]);
        // GitHub workflow command syntax, with the rule as the annotation
        // title so the Effect rule name shows up in the PR annotation.
        expect(result.stdout).toMatch(
          /^::error file=.+program\.ts,line=\d+,col=\d+,endLine=\d+,endColumn=\d+,title=floatingEffect::/m,
        );
      },
      { floatingEffect: 'error' },
    );
  });
});

describe('effect-analyze tsgo passthrough commands', () => {
  const tsgo = (args: readonly string[]) =>
    spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'node_modules', '@effect', 'tsgo', 'dist', 'effect-tsgo.cjs'), ...args],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );

  it('get-exe-path answers exactly as effect-tsgo does', () => {
    const ours = run(['get-exe-path']);
    const theirs = tsgo(['get-exe-path']);
    expect(ours.status).toBe(theirs.status);
    expect(ours.stdout.trim()).toBe(theirs.stdout.trim());
    expect(ours.stdout.trim().length).toBeGreaterThan(0);
  });

  it('forwards flags to the proxied command', () => {
    // `config` is the interactive rule picker, so --help is the observable,
    // side-effect-free way to prove the flag reached effect-tsgo.
    const ours = run(['config', '--help']);
    const theirs = tsgo(['config', '--help']);
    expect(ours.status).toBe(theirs.status);
    expect(ours.stdout).toContain('interactive rule picker');
    expect(ours.stdout).toBe(theirs.stdout);
  });

  it('still treats a path argument as a path, not a subcommand', () => {
    withProject((root) => {
      const result = run([join(root, 'src'), '--lint-source']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"findings"');
    });
  });
});

/**
 * These hold `effect-analyze diagnostics` against the native binary on the same
 * inputs. Anything that differs is a reason a project cannot swap the two.
 */
describe('effect-analyze diagnostics / effect-tsgo parity', () => {
  /**
   * A project configured the way a real one is: the language service enabled
   * through an `@effect/language-service` plugin entry, with the package's own
   * lint fixture copied in for a rich set of diagnostics.
   *
   * Parity is measured here rather than against this package's own tsconfig,
   * which has no plugin entry — both binaries would check nothing and every
   * comparison would hold vacuously. Neither side is passed `--lspconfig`:
   * upstream reads the configuration from the project, which is the whole point.
   */
  // Created in beforeAll, not in the describe body: the body is evaluated even
  // when a filter selects no test here, and afterAll would then never run to
  // clean it up.
  let PROJECT = '';
  let FIXTURE = '';
  let PROJECT_TSCONFIG = '';

  beforeAll(() => {
    PROJECT = mkdtempSync(join(REPO_ROOT, '.tmp-tsgo-parity-'));
    FIXTURE = join(PROJECT, 'src', 'lint-issues.ts');
    PROJECT_TSCONFIG = join(PROJECT, 'tsconfig.json');
    mkdirSync(join(PROJECT, 'src'), { recursive: true });
    writeFileSync(
      FIXTURE,
      readFileSync(join(REPO_ROOT, 'src', '__fixtures__', 'lint-issues.ts'), 'utf8'),
      'utf8',
    );
    writeFileSync(
      join(PROJECT, 'tsconfig.json'),
      JSON.stringify({
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
      }),
      'utf8',
    );
  });

  afterAll(() => {
    if (PROJECT !== '') rmSync(PROJECT, { recursive: true, force: true });
  });

  const native = (args: readonly string[]) =>
    spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'node_modules', '@effect', 'tsgo', 'dist', 'effect-tsgo.cjs'), ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

  const tsgoOnly = (stdout: string) => {
    const parsed = JSON.parse(stdout.slice(stdout.indexOf('{'))) as {
      diagnostics: readonly Record<string, unknown>[];
      summary: Record<string, number>;
    };
    return parsed;
  };

  it('checks the single file given to --file, not the whole project', () => {
    const ours = tsgoOnly(
      run(['diagnostics', '--file', FIXTURE, '--format', 'json', '--no-analyzer']).stdout,
    );
    const theirs = tsgoOnly(
      native(['diagnostics', '--file', FIXTURE, '--format', 'json']).stdout,
    );

    // One file checked, not the 154 in the project — and not zero, which is
    // what a single-file run reports without the plugin options.
    expect(ours.summary.filesChecked).toBe(1);
    expect(ours.summary.totalFiles).toBe(1);
    expect(ours.summary).toEqual(theirs.summary);
    // Identical to upstream once the one additive field is removed.
    const withoutSource = ours.diagnostics.map(({ source, ...rest }) => {
      expect(source).toBe('tsgo');
      return rest;
    });
    expect(withoutSource).toEqual(theirs.diagnostics);
  }, 300_000);

  it('emits the upstream diagnostic schema', () => {
    const ours = tsgoOnly(
      run(['diagnostics', '--file', FIXTURE, '--format', 'json', '--no-analyzer']).stdout,
    );
    const entry = ours.diagnostics[0]!;
    // Upstream field names and value domain, plus `source` as an addition.
    expect(Object.keys(entry).sort()).toEqual(
      [
        'code', 'column', 'endColumn', 'endLine', 'file', 'length', 'line',
        'message', 'name', 'severity', 'source', 'start',
      ].sort(),
    );
    expect(['error', 'warning', 'message']).toContain(entry['severity']);
  }, 300_000);

  it('fails like effect-tsgo when neither --file nor --project is given', () => {
    const ours = run(['diagnostics', '--format', 'json']);
    const theirs = native(['diagnostics', '--format', 'json']);
    expect(ours.status).toBe(theirs.status);
    expect(ours.status).toBe(1);
    expect(`${ours.stdout}${ours.stderr}`).toContain('No files to check');
  }, 300_000);

  it('forwards --progress and --list-files to the language service', () => {
    // --progress narrates to stderr and must not corrupt stdout.
    const progress = run(['diagnostics', '--file', FIXTURE, '--format', 'json', '--progress']);
    expect(() => tsgoOnly(progress.stdout)).not.toThrow();

    // --list-files must reach @effect/tsgo rather than being silently dropped;
    // the following test asserts the file metadata it returns.
    const ours = run(['diagnostics', '--file', FIXTURE, '--format', 'json', '--list-files']);
    const theirs = native(['diagnostics', '--file', FIXTURE, '--format', 'json', '--list-files']);
    expect(ours.status).toBe(theirs.status);
  }, 300_000);

  it('escapes GitHub workflow command data the way upstream does', () => {
    const ours = run([
      'diagnostics', '--file', FIXTURE, '--format', 'github-actions', '--no-analyzer',
    ]);
    const theirs = native([
      'diagnostics', '--file', FIXTURE, '--format', 'github-actions',
    ]);
    const commands = (out: string) =>
      out.split('\n').filter((l) => l.startsWith('::')).join('\n');
    expect(commands(ours.stdout)).toBe(commands(theirs.stdout));
    // A message may not smuggle a newline through an unescaped percent sign.
    expect(commands(ours.stdout)).not.toMatch(/[^%]%0A/);
  }, 300_000);

  it('renders pretty exactly as effect-tsgo does', () => {
    const ours = run(['diagnostics', '--file', FIXTURE, '--format', 'pretty', '--no-analyzer']);
    const theirs = native([
      'diagnostics', '--file', FIXTURE, '--format', 'pretty',
    ]);
    expect(ours.stdout).toBe(theirs.stdout);
    // Guards the comparison itself: pretty prints a source line and underline
    // per diagnostic, so a header-only renderer would be far shorter.
    expect(ours.stdout.split('\n').length).toBeGreaterThan(20);
  }, 300_000);

  it('preserves upstream diagnostic order across a whole project', () => {
    const ours = tsgoOnly(
      run(['diagnostics', '--project', PROJECT_TSCONFIG, '--format', 'json', '--no-analyzer'])
        .stdout,
    );
    const theirs = tsgoOnly(
      native(['diagnostics', '--project', PROJECT_TSCONFIG, '--format', 'json'])
        .stdout,
    );
    expect(ours.diagnostics.map((d) => `${String(d['file'])}:${String(d['line'])}:${String(d['name'])}`)).toEqual(
      theirs.diagnostics.map((d) => `${String(d['file'])}:${String(d['line'])}:${String(d['name'])}`),
    );
  }, 300_000);

  it('applies effect-tsgo\'s own --severity semantics', () => {
    // Upstream lowercases entries, ignores unrecognised ones, and filters not
    // at all when nothing in the list is recognised.
    for (const value of ['ERROR', 'warning,bogus', 'nonsense']) {
      const ours = run(['diagnostics', '--file', FIXTURE, '--format', 'json', '--severity', value]);
      const theirs = native([
        'diagnostics', '--file', FIXTURE, '--format', 'json', '--severity', value,
      ]);
      expect(`${value}:${String(ours.status)}`).toBe(`${value}:${String(theirs.status)}`);
    }
  }, 300_000);

  it('returns the per-file Effect versions for --list-files', () => {
    const parsed = tsgoOnly(
      run([
        'diagnostics', '--file', FIXTURE, '--format', 'json', '--list-files', '--no-analyzer',
      ]).stdout,
    ) as unknown as { files?: readonly Record<string, string>[] };
    expect(parsed.files).toEqual([
      {
        file: resolve(REPO_ROOT, FIXTURE),
        detectedEffect: 'v4',
        supportedEffect: 'v4',
      },
    ]);
  }, 300_000);

  it('renders text exactly as effect-tsgo does', () => {
    const ours = run(['diagnostics', '--file', FIXTURE, '--format', 'text', '--no-analyzer']);
    const theirs = native([
      'diagnostics', '--file', FIXTURE, '--format', 'text',
    ]);
    expect(ours.stdout).toBe(theirs.stdout);
  }, 300_000);
});

/**
 * When `@effect/tsgo` does not produce a diagnostics report — no target, a bad
 * flag, unparseable `--lspconfig`, `--help` — its stdout, stderr and status are
 * the whole answer. Overriding that status or appending analyzer findings to it
 * turns a failed invocation into a passing, plausible-looking run.
 */
describe('effect-analyze diagnostics / upstream invocation failures', () => {
  const FIXTURE = 'src/__fixtures__/lint-issues.ts';

  const native = (args: readonly string[]) =>
    spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'node_modules', '@effect', 'tsgo', 'dist', 'effect-tsgo.cjs'), ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

  const cases: readonly (readonly [string, readonly string[]])[] = [
    ['no target', ['diagnostics']],
    ['unsupported --format', ['diagnostics', '--file', FIXTURE, '--format', 'bogus']],
    [
      'unparseable --lspconfig',
      ['diagnostics', '--file', FIXTURE, '--format', 'json', '--lspconfig', 'notjson'],
    ],
    ['--help', ['diagnostics', '--file', FIXTURE, '--help']],
  ];

  it.each(cases)('reports a failed invocation faithfully: %s', (_name, args) => {
    for (const extra of [[], ['--fail-on=none'], ['--fail-on=warning']]) {
      const ours = run([...args, ...extra]);
      const theirs = native([...args]);
      // A failed invocation is never turned into a success by our own gate.
      expect(`${String(extra)}:${String(ours.status)}`).toBe(`${String(extra)}:${String(theirs.status)}`);
      // ...and nothing of ours is appended to what it printed.
      expect(ours.stdout).not.toContain('effect-analyzer(');
      expect(ours.stdout).not.toContain('"source": "analyzer"');
    }
  }, 300_000);

  it('analyzes the union of --project and --file, as effect-tsgo does', () => {
    // A project of one file, plus a second file the tsconfig does not include.
    // Upstream unions the two targets; narrowing to the file would check one.
    const root = mkdtempSync(join(REPO_ROOT, '.tmp-tsgo-union-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'extra'), { recursive: true });
      writeFileSync(join(root, 'src', 'inside.ts'), SOURCE, 'utf8');
      writeFileSync(join(root, 'extra', 'outside.ts'), SOURCE, 'utf8');
      const tsconfig = join(root, 'tsconfig.json');
      writeFileSync(
        tsconfig,
        JSON.stringify({
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
        }),
        'utf8',
      );

      const args = [
        '--project', tsconfig, '--file', join(root, 'extra', 'outside.ts'), '--format', 'json',
      ];
      const ours = run(['diagnostics', ...args, '--no-analyzer']);
      const parsed = JSON.parse(ours.stdout.slice(ours.stdout.indexOf('{'))) as {
        diagnostics: readonly Record<string, unknown>[];
        summary: Record<string, number>;
      };
      // Both targets are in scope — that is the union. Upstream checks only the
      // one whose project enables the language service, and we report what it
      // reported rather than a number of our own.
      expect(parsed.summary['totalFiles']).toBe(2);
      const theirs = JSON.parse(
        native(['diagnostics', ...args]).stdout.slice(
          native(['diagnostics', ...args]).stdout.indexOf('{'),
        ),
      ) as { summary: Record<string, number> };
      expect(parsed.summary).toEqual(theirs.summary);

      // Our own AST rules need no plugin, so they cover both halves.
      const withAnalyzer = JSON.parse(
        run(['diagnostics', ...args]).stdout.slice(run(['diagnostics', ...args]).stdout.indexOf('{')),
      ) as { diagnostics: readonly Record<string, unknown>[] };

      const analyzed = new Set(
        withAnalyzer.diagnostics
          .filter((d) => d['source'] === 'analyzer')
          .map((d) => String(d['file'])),
      );
      expect([...analyzed].some((f) => f.endsWith('inside.ts'))).toBe(true);
      expect([...analyzed].some((f) => f.endsWith('outside.ts'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
});

/**
 * The project's own plugin configuration must reach `@effect/tsgo` untouched.
 *
 * This regressed once: the wrapper looked for a plugin named `@effect/tsgo`,
 * never found the canonical `@effect/language-service`, and forwarded
 * `--lspconfig {}` — replacing every configured severity with the rule
 * defaults, silently. Fixtures using the same wrong name hid it.
 */
describe('effect-analyze diagnostics / project configuration', () => {
  const withConfiguredProject = (
    diagnosticSeverity: Record<string, string>,
    fn: (tsconfig: string) => void,
  ) => {
    const root = mkdtempSync(join(REPO_ROOT, '.tmp-tsgo-cfg-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'program.ts'), SOURCE, 'utf8');
      const tsconfig = join(root, 'tsconfig.json');
      writeFileSync(
        tsconfig,
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            plugins: [{ name: '@effect/language-service', diagnosticSeverity }],
          },
          include: ['src/**/*.ts'],
        }),
        'utf8',
      );
      fn(tsconfig);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const floatingEffectSeverities = (stdout: string): readonly string[] => {
    const parsed = JSON.parse(stdout.slice(stdout.indexOf('{'))) as {
      diagnostics: readonly { severity: string; name: string }[];
    };
    return parsed.diagnostics.filter((d) => d.name === 'floatingEffect').map((d) => d.severity);
  };

  it('honours a configured severity that differs from the rule default', () => {
    // floatingEffect defaults to error, so `warning` here can only come from
    // the project's own configuration reaching the language service.
    withConfiguredProject({ floatingEffect: 'warning' }, (tsconfig) => {
      const ours = run(['diagnostics', '--project', tsconfig, '--format', 'json', '--no-analyzer']);
      expect(floatingEffectSeverities(ours.stdout)).toEqual(['warning']);
    });
  }, 300_000);

  it('turns a rule off when the project turns it off', () => {
    withConfiguredProject({ floatingEffect: 'off' }, (tsconfig) => {
      const ours = run(['diagnostics', '--project', tsconfig, '--format', 'json', '--no-analyzer']);
      expect(floatingEffectSeverities(ours.stdout)).toEqual([]);
    });
  }, 300_000);
});
