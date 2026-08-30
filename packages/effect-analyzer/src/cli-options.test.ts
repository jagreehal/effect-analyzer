/**
 * `parseArgs` is the whole CLI surface and was only ever exercised through
 * subprocess CLI tests, which cover a handful of flags and hide the rest. The
 * tables below are deliberately exhaustive: a flag that is not listed here is
 * a flag nothing checks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, type CLIOptions } from './cli-options';

const opts = (...args: readonly string[]) => parseArgs(args).options;
// Lazy: computed at import time, a mutant that guts `parseArgs` would break the
// module instead of failing a test, and mutation testing would score it as survived.
const defaults = () => opts();

/**
 * Each row is the argv that should end with the flag under test. Asserting the
 * prefix as well means a row works whether the flag flips the default (`-c`)
 * or reverses an earlier flag (`--test --no-test`).
 */
type Row = readonly [argv: readonly string[], key: keyof CLIOptions];

const TURNS_ON: readonly Row[] = [
  [['--colocate'], 'colocate'],
  [['--no-colocate'], 'noColocate'],
  [['--watch'], 'watch'],
  [['-w'], 'watch'],
  [['--migration'], 'migration'],
  [['-m'], 'migration'],
  [['--cache'], 'cache'],
  [['--coverage-audit'], 'coverageAudit'],
  [['--show-suspicious-zeros'], 'showSuspiciousZeros'],
  [['--show-top-unknown'], 'showTopUnknown'],
  [['--show-top-unknown-reasons'], 'showTopUnknownReasons'],
  [['--show-by-folder'], 'showOkZeroFailByFolder'],
  [['--per-file-timing'], 'perFileTiming'],
  [['--coverage-json'], 'coverageJson'],
  [['--open'], 'open'],
  [['--json-summary'], 'jsonSummary'],
  [['--quiet'], 'quiet'],
  [['-q'], 'quiet'],
  [['--quality'], 'quality'],
  [['--assert-diagram-fidelity'], 'assertDiagramFidelity'],
  [['--style-guide'], 'styleGuide'],
  [['--diff'], 'diff'],
  [['--regression'], 'regression'],
  [['--include-trivial'], 'includeTrivial'],
  [['--entry-points'], 'entryPoints'],
  [['--config-leaks'], 'configLeaks'],
  [['--cli-commands'], 'cliCommands'],
  [['--list-rules'], 'listRules'],
  [['--index-rules'], 'indexRules'],
  [['--lint-source'], 'lintSource'],
  [['--sarif'], 'sarif'],
  [['--fail-on-new'], 'failOnNew'],
  [['--require-suppression-reason'], 'requireSuppressionReason'],
  [['--fail-on-stale-suppressions'], 'failOnStaleSuppressions'],
  [['--service-cycles'], 'serviceCycles'],
  [['--scorecard'], 'scorecard'],
  [['--agent-report'], 'agentReport'],
  [['--error-channel'], 'errorChannel'],
  [['--service-health'], 'serviceHealth'],
  [['--performance'], 'performance'],
  [['--coupling'], 'coupling'],
  [['--coupling-transitive'], 'couplingTransitive'],
  [['--test'], 'test'],
  [['--test-overwrite'], 'testOverwrite'],
  [['--improve'], 'improve'],
  [['--improve-dry-run'], 'improve'],
  [['--compact', '--pretty'], 'pretty'],
  [['--no-service-map', '--service-map'], 'serviceMap'],
  [['--improve', '--improve-dry-run'], 'improveDryRun'],
];

const TURNS_OFF: readonly Row[] = [
  [['--compact'], 'pretty'],
  [['-c'], 'pretty'],
  [['--no-metadata'], 'includeMetadata'],
  [['--no-colocate-enhanced'], 'colocateEnhanced'],
  [['--no-color'], 'color'],
  [['--no-service-map'], 'serviceMap'],
  [['--test', '--no-test'], 'test'],
  [['--style-guide', '--no-style-guide'], 'styleGuide'],
  [['--coverage-audit', '--no-show-top-unknown'], 'showTopUnknown'],
  [['--coverage-audit', '--no-show-top-unknown-reasons'], 'showTopUnknownReasons'],
  [['--improve-dry-run', '--improve'], 'improveDryRun'],
];

/** argv, the option it sets, and the value it should end up with. */
type ValueRow = readonly [argv: readonly string[], key: keyof CLIOptions, value: unknown];

const SETS_VALUE: readonly ValueRow[] = [
  [['--export', 'Transfer'], 'openapiExport', 'Transfer'],
  [['--output', 'out.md'], 'output', 'out.md'],
  [['-o', 'out.md'], 'output', 'out.md'],
  [['--tsconfig', 'a/tsconfig.json'], 'tsconfig', 'a/tsconfig.json'],
  [['--tsconfig=a/tsconfig.json'], 'tsconfig', 'a/tsconfig.json'],
  [['--colocate-suffix', 'notes'], 'colocateSuffix', 'notes'],
  [['--colocate-suffix=notes'], 'colocateSuffix', 'notes'],
  [['--known-effect-internals-root', '/effect'], 'knownEffectInternalsRoot', '/effect'],
  [['--quality-eslint', 'report.json'], 'qualityEslint', 'report.json'],
  [['--quality-eslint=report.json'], 'qualityEslint', 'report.json'],
  [['--search-rules', 'retry'], 'searchRules', 'retry'],
  [['--search-rules=retry'], 'searchRules', 'retry'],
  [['--explain-rule', 'EA001'], 'explainRule', 'EA001'],
  [['--explain-rule=EA001'], 'explainRule', 'EA001'],
  [['--export-session', 'a.json'], 'exportSession', 'a.json'],
  [['--export-session=a.json'], 'exportSession', 'a.json'],
  [['--import-session', 'a.json'], 'importSession', 'a.json'],
  [['--import-session=a.json'], 'importSession', 'a.json'],
  [['--baseline', 'base.json'], 'baseline', 'base.json'],
  [['--baseline=base.json'], 'baseline', 'base.json'],
  [['--bundle-output', 'bundle'], 'bundleOutput', 'bundle'],
  [['--bundle-output=bundle'], 'bundleOutput', 'bundle'],
  [['--tsgo=custom.json'], 'tsgoProject', 'custom.json'],
  [['--exclude-from-suspicious-zero', 'gen'], 'excludeFromSuspiciousZeros', ['gen']],
  [['--improve-rule', 'EA001'], 'improveRules', ['EA001']],
  [['--improve-exclude-rule', 'EA002'], 'improveExcludeRules', ['EA002']],
  [['--min-meaningful-nodes', '3'], 'minMeaningfulNodes', 3],
  [['--min-coverage', '80'], 'minCoverage', 80],
  [['--max-audit-failed-files', '5'], 'maxAuditFailedFiles', 5],
  [['--max-audit-suspicious-zeros', '7'], 'maxAuditSuspiciousZeros', 7],
  [['--min-audit-effect-adoption', '60'], 'minAuditEffectAdoption', 0.6],
  [['--min-audit-source-resolution', '90'], 'minAuditSourceResolution', 0.9],
  [['--max-files', '10'], 'maxFiles', 10],
  [['--max-files=10'], 'maxFiles', 10],
  [['--cursor', '4'], 'cursor', 4],
  [['--cursor=4'], 'cursor', 4],
  [['--improve-max-fixes', '2'], 'improveMaxFixes', 2],
  // The inclusive ends of every range, so `>= 0` cannot quietly become `> 0`
  // nor `<= 100` become `< 100`.
  [['--min-meaningful-nodes', '0'], 'minMeaningfulNodes', 0],
  [['--min-coverage', '0'], 'minCoverage', 0],
  [['--min-coverage', '100'], 'minCoverage', 100],
  [['--max-audit-failed-files', '0'], 'maxAuditFailedFiles', 0],
  [['--max-audit-suspicious-zeros', '0'], 'maxAuditSuspiciousZeros', 0],
  [['--min-audit-effect-adoption', '0'], 'minAuditEffectAdoption', 0],
  [['--min-audit-effect-adoption', '100'], 'minAuditEffectAdoption', 1],
  [['--min-audit-source-resolution', '0'], 'minAuditSourceResolution', 0],
  [['--min-audit-source-resolution', '100'], 'minAuditSourceResolution', 1],
];

/** A value the parser must reject, leaving the option at its default. */
const REJECTS: readonly (readonly [argv: readonly string[], key: keyof CLIOptions])[] = [
  [['--format', 'not-a-format'], 'format'],
  [['--direction', 'sideways'], 'direction'],
  [['--detail', 'loud'], 'detail'],
  [['--profile', 'lax'], 'profile'],
  [['--profile=lax'], 'profile'],
  [['--improve-min-priority', 'P9'], 'improveMinPriority'],
  [['--colocate-suffix', ''], 'colocateSuffix'],
  [['--min-meaningful-nodes', '-1'], 'minMeaningfulNodes'],
  [['--min-meaningful-nodes', 'abc'], 'minMeaningfulNodes'],
  [['--min-coverage', '101'], 'minCoverage'],
  [['--min-coverage', '-1'], 'minCoverage'],
  [['--max-audit-failed-files', '-1'], 'maxAuditFailedFiles'],
  [['--max-audit-suspicious-zeros', '-1'], 'maxAuditSuspiciousZeros'],
  [['--min-audit-effect-adoption', '101'], 'minAuditEffectAdoption'],
  [['--min-audit-effect-adoption', '-1'], 'minAuditEffectAdoption'],
  [['--min-audit-source-resolution', '101'], 'minAuditSourceResolution'],
  [['--min-audit-source-resolution', '-1'], 'minAuditSourceResolution'],
  [['--max-files', '0'], 'maxFiles'],
  [['--max-files=0'], 'maxFiles'],
  [['--cursor', '-1'], 'cursor'],
  [['--cursor=-1'], 'cursor'],
  [['--improve-max-fixes', '0'], 'improveMaxFixes'],
  [['--improve-rule', ''], 'improveRules'],
  [['--improve-exclude-rule', ''], 'improveExcludeRules'],
];

const FORMATS: readonly CLIOptions['format'][] = [
  'auto', 'json', 'mermaid', 'mermaid-paths', 'mermaid-enhanced', 'mermaid-railway',
  'mermaid-services', 'mermaid-errors', 'mermaid-decisions', 'mermaid-causes',
  'mermaid-concurrency', 'mermaid-timeline', 'mermaid-layers', 'mermaid-retry',
  'mermaid-testability', 'mermaid-dataflow', 'mermaid-statechart', 'svg-statechart',
  'statechart-html', 'xstate-config', 'statechart-coverage', 'stats', 'migration',
  'showcase', 'explain', 'summary', 'architecture', 'matrix', 'api-docs',
  'openapi-paths', 'json-schema', 'openapi-runtime',
];

describe('parseArgs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each([
    ['on', TURNS_ON, false, true] as const,
    ['off', TURNS_OFF, true, false] as const,
  ])('turns %s', (_label, rows, before, after) => {
    it.each(rows)('%s -> %s', (argv, key) => {
      expect(opts(...argv.slice(0, -1))[key]).toBe(before);
      expect(opts(...argv)[key]).toBe(after);
    });
  });

  it.each(SETS_VALUE)('%s sets %s', (argv, key, value) => {
    expect(defaults()[key]).not.toEqual(value);
    expect(opts(...argv)[key]).toEqual(value);
  });

  it.each([['--cursor', '0'], ['--cursor=0']])('%s is accepted (the range is inclusive)', (...argv) => {
    expect(opts('--cursor', '4', ...argv).cursor).toBe(0);
  });

  it.each(REJECTS)('%s leaves %s at its default', (argv, key) => {
    expect(opts(...argv)[key]).toEqual(defaults()[key]);
  });

  it.each(FORMATS)('--format %s is accepted', (format) => {
    expect(opts('--format', format).format).toBe(format);
    expect(opts('-f', format).format).toBe(format);
  });

  it.each(['TB', 'LR', 'BT', 'RL'] as const)('--direction %s is accepted', (direction) => {
    expect(opts('--direction', direction).direction).toBe(direction);
    expect(opts('-d', direction).direction).toBe(direction);
  });

  it.each(['compact', 'standard', 'verbose'] as const)('--detail %s is accepted', (detail) => {
    expect(opts('--detail', detail).detail).toBe(detail);
  });

  it.each(['strict', 'ci', 'migration', 'docs'] as const)('--profile %s is accepted', (profile) => {
    expect(opts('--profile', profile).profile).toBe(profile);
    expect(opts(`--profile=${profile}`).profile).toBe(profile);
  });

  it.each(['P0', 'P1', 'P2', 'P3'] as const)(
    '--improve-min-priority %s is accepted',
    (priority) => {
      expect(opts('--improve-min-priority', priority).improveMinPriority).toBe(priority);
    },
  );

  it.each(['vitest', 'jest', 'mocha'] as const)('--test-runner %s is accepted', (runner) => {
    expect(opts('--test-runner', runner).testRunner).toBe(runner);
    expect(opts(`--test-runner=${runner}`).testRunner).toBe(runner);
  });

  it.each([
    ['--exclude-from-suspicious-zero', 'excludeFromSuspiciousZeros'],
    ['--improve-rule', 'improveRules'],
    ['--improve-exclude-rule', 'improveExcludeRules'],
    ['--min-meaningful-nodes', 'minMeaningfulNodes'],
    ['--min-coverage', 'minCoverage'],
    ['--max-files', 'maxFiles'],
    ['--cursor', 'cursor'],
    ['--improve-max-fixes', 'improveMaxFixes'],
    ['--test-runner', 'testRunner'],
    ['--max-audit-failed-files', 'maxAuditFailedFiles'],
    ['--max-audit-suspicious-zeros', 'maxAuditSuspiciousZeros'],
    ['--min-audit-effect-adoption', 'minAuditEffectAdoption'],
    ['--min-audit-source-resolution', 'minAuditSourceResolution'],
  ] as const)('%s at the end of argv leaves %s alone', (flag, key) => {
    expect(opts(flag)[key]).toEqual(defaults()[key]);
  });

  describe('positional arguments', () => {
    it('takes the first non-flag argument as the path', () => {
      expect(parseArgs(['src/a.ts', 'src/b.ts']).pathArg).toBe('src/a.ts');
    });

    it('does not treat a flag value as the path', () => {
      expect(parseArgs(['--output', 'out.md']).pathArg).toBeUndefined();
    });

    it('collects positionals as diff sources only in diff mode', () => {
      expect(parseArgs(['--diff', 'HEAD:a.ts', 'a.ts']).options.diffSources).toEqual([
        'HEAD:a.ts',
        'a.ts',
      ]);
      expect(parseArgs(['HEAD:a.ts', 'a.ts']).options.diffSources).toEqual([]);
    });
  });

  describe('--tsgo', () => {
    it('defaults to tsconfig.json', () => {
      expect(opts('--tsgo').tsgoProject).toBe('tsconfig.json');
    });

    it('consumes a following path only once a path argument has been seen', () => {
      expect(parseArgs(['src', '--tsgo', 'custom.json'])).toEqual({
        pathArg: 'src',
        options: expect.objectContaining({ tsgoProject: 'custom.json' }),
        errors: [],
      });
      // No path yet, so `other.ts` stays the path argument rather than the project.
      expect(parseArgs(['--tsgo', 'other.ts'])).toEqual({
        pathArg: 'other.ts',
        options: expect.objectContaining({ tsgoProject: 'tsconfig.json' }),
        errors: [],
      });
    });
  });

  describe('--coupling-priority', () => {
    it('parses pairs in both argument forms', () => {
      const expected = { 'critical-fanin': 'P0', 'high-fanin': 'P1' };
      expect(opts('--coupling-priority', 'critical-fanin=P0,high-fanin=P1').couplingPriority)
        .toEqual(expected);
      expect(opts('--coupling-priority=critical-fanin=P0,high-fanin=P1').couplingPriority)
        .toEqual(expected);
    });

    it('ignores trailing separators, blank entries and surrounding whitespace', () => {
      expect(opts('--coupling-priority', ' high-fanout = P2 ,').couplingPriority).toEqual({
        'high-fanout': 'P2',
      });
      expect(
        opts('--coupling-priority', 'critical-fanin=P0, ,high-fanin=P1').couplingPriority,
      ).toEqual({ 'critical-fanin': 'P0', 'high-fanin': 'P1' });
    });

    it.each(['critical-fanin', 'high-fanin', 'high-fanout', 'hub-without-annotation'] as const)(
      'accepts the %s issue type',
      (type) => {
        expect(opts('--coupling-priority', `${type}=P3`).couplingPriority).toEqual({ [type]: 'P3' });
      },
    );

    const failing = () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      return { exit, error };
    };

    it('exits asking for a value when the flag has none', () => {
      const raw = '';
      const { exit, error } = failing();
      expect(() => opts('--coupling-priority', raw)).toThrow('exit');
      expect(exit).toHaveBeenCalledWith(2);
      expect(error.mock.calls.at(0)?.at(0)).toContain('requires a value');
    });

    it.each([
      [' ', 'only whitespace'],
      ['critical-fanin', 'a pair with no ='],
      ['not-a-type=P0', 'an unknown issue type'],
      ['critical-fanin=P9', 'an unknown priority'],
      [',', 'no pairs at all'],
    ])('exits reporting the bad value on %s (%s)', (raw) => {
      const { exit, error } = failing();
      expect(() => opts('--coupling-priority', raw)).toThrow('exit');
      expect(exit).toHaveBeenCalledWith(2);
      expect(error.mock.calls.at(0)?.at(0)).toContain(`invalid value "${raw}"`);
    });
  });

  describe('--test-runner', () => {
    it('trims the value of the = form', () => {
      expect(opts('--test-runner=  jest  ').testRunner).toBe('jest');
    });

    // Was `process.exit(1)` from inside the parser. It now reports through the
    // same channel as every other bad enum value, so the caller decides.
    it.each([
      ['--test-runner', 'gradle'],
      ['--test-runner=gradle'],
    ])('reports the unknown runner without exiting (%s)', (...argv) => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      const { errors, options } = parseArgs(argv);
      expect(exit).not.toHaveBeenCalled();
      expect(errors).toEqual([
        'Unknown value for --test-runner: gradle. Accepted: vitest, jest, mocha.',
      ]);
      expect(options.testRunner).toBe('vitest');
    });
  });

  describe('--help', () => {
    it.each(['--help', '-h'])('prints help and exits cleanly (%s)', (flag) => {
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      expect(() => opts(flag)).toThrow('exit');
      expect(exit).toHaveBeenCalledWith(0);
      expect(write).toHaveBeenCalled();
    });
  });

  describe('derived defaults', () => {
    it('--migration forces the migration format, overriding --format', () => {
      expect(opts('--migration').format).toBe('migration');
      expect(opts('--format', 'json', '--migration').format).toBe('migration');
    });

    it('turns the style guide on for mermaid-paths unless it was refused', () => {
      expect(opts('--format', 'mermaid-paths').styleGuide).toBe(true);
      expect(opts('--format', 'mermaid-paths', '--no-style-guide').styleGuide).toBe(false);
    });

    it('shows top unknowns under --coverage-audit unless quiet', () => {
      const audit = opts('--coverage-audit');
      expect(audit.showTopUnknown).toBe(true);
      expect(audit.showTopUnknownReasons).toBe(true);

      const quiet = opts('--coverage-audit', '--quiet');
      expect(quiet.showTopUnknown).toBe(false);
      expect(quiet.showTopUnknownReasons).toBe(false);
    });

    it('leaves the improve rule lists undefined when none were given', () => {
      expect(defaults().improveRules).toBeUndefined();
      expect(defaults().improveExcludeRules).toBeUndefined();
    });

    it('accumulates repeated list flags', () => {
      expect(opts('--improve-rule', 'A', '--improve-rule', 'B').improveRules).toEqual(['A', 'B']);
      expect(
        opts('--exclude-from-suspicious-zero', 'a', '--exclude-from-suspicious-zero', 'b')
          .excludeFromSuspiciousZeros,
      ).toEqual(['a', 'b']);
    });
  });

  describe('defaults', () => {
    it('parses an empty argv into the documented defaults', () => {
      expect(parseArgs([])).toEqual({
        pathArg: undefined,
        options: expect.objectContaining({
          format: 'auto',
          pretty: true,
          includeMetadata: true,
          direction: 'TB',
          detail: undefined,
          colocateSuffix: 'effect-analysis',
          colocateEnhanced: true,
          serviceMap: true,
          color: true,
          cursor: 0,
          testRunner: 'vitest',
          improveDryRun: true,
          diffSources: [],
        }),
        errors: [],
      });
    });

    it('ignores an unknown flag rather than failing', () => {
      expect(opts('--not-a-flag')).toEqual(defaults());
    });
  });
});
