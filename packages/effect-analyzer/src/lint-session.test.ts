import { describe, expect, it } from 'vitest';
import {
  buildLintScorecard,
  compareAgainstBaseline,
  exitCodeFor,
  fingerprintOf,
  toSarif,
} from './lint-session';

describe('finding fingerprints', () => {
  it('matches the fingerprint earlier releases wrote into baselines', () => {
    // Captured from the pre-`source` implementation: sha256 of
    // filePath|line|column|rule|severity|message|suggestion, first 20 chars.
    // A baseline written by an earlier release must still match, or --fail-on-new
    // reports every existing finding as new after an upgrade.
    expect(
      fingerprintOf({
        filePath: '/tmp/a.ts',
        line: 7,
        column: 3,
        rule: 'floatingEffect',
        severity: 'error',
        message: 'This Effect is neither yielded nor assigned.',
        suggestion: undefined,
        source: 'tsgo',
      }),
    ).toBe('6bf628ba0d41a61c62c9');
  });

  it('does not let the reporting checker change a finding’s identity', () => {
    const base = {
      filePath: '/tmp/a.ts',
      line: 7,
      column: 3,
      rule: 'floatingEffect',
      severity: 'error' as const,
      message: 'm',
      suggestion: undefined,
    };
    expect(fingerprintOf({ ...base, source: 'tsgo' })).toBe(
      fingerprintOf({ ...base, source: 'analyzer' }),
    );
  });
});

describe('exitCodeFor', () => {
  const at = (severity: 'error' | 'warning' | 'info') => ({
    filePath: '/tmp/a.ts',
    rule: 'r',
    severity,
    message: 'm',
    line: 1,
    column: 1,
    source: 'analyzer' as const,
    fingerprint: 'fp',
  });

  it('never fails an advisory run', () => {
    expect(exitCodeFor([at('error')], undefined)).toBe(0);
  });

  it('fails on findings at or above the gate', () => {
    expect(exitCodeFor([at('error')], 'error')).toBe(1);
    expect(exitCodeFor([at('error')], 'warning')).toBe(1);
    expect(exitCodeFor([at('warning')], 'info')).toBe(1);
  });

  it('passes when every finding is below the gate', () => {
    expect(exitCodeFor([at('warning'), at('info')], 'error')).toBe(0);
    expect(exitCodeFor([at('info')], 'warning')).toBe(0);
  });

  it('passes on an empty scan', () => {
    expect(exitCodeFor([], 'info')).toBe(0);
  });
});

describe('lint-session baseline diff', () => {
  it('detects new/resolved/unchanged deterministically by fingerprint', () => {
    const a = {
      filePath: '/tmp/a.ts',
      rule: 'x',
      severity: 'warning' as const,
      message: 'm1',
      line: 1,
      column: 1,
      fingerprint: 'fp1',
    };
    const b = {
      filePath: '/tmp/b.ts',
      rule: 'y',
      severity: 'error' as const,
      message: 'm2',
      line: 2,
      column: 1,
      fingerprint: 'fp2',
    };
    const c = {
      filePath: '/tmp/c.ts',
      rule: 'z',
      severity: 'info' as const,
      message: 'm3',
      line: 3,
      column: 1,
      fingerprint: 'fp3',
    };

    const delta = compareAgainstBaseline([a, b], [a, c]);
    expect(delta.newFindings.map((x) => x.fingerprint)).toEqual(['fp2']);
    expect(delta.resolvedFindings.map((x) => x.fingerprint)).toEqual(['fp3']);
    expect(delta.unchangedFindings.map((x) => x.fingerprint)).toEqual(['fp1']);
  });
});

describe('lint-session sarif', () => {
  it('emits stable sarif shape', () => {
    const findings = [
      {
        filePath: '/tmp/a.ts',
        rule: 'runSync-on-async',
        severity: 'error' as const,
        message: 'bad',
        line: 4,
        column: 2,
        fingerprint: 'abc123',
      },
    ];
    const sarif = toSarif(findings);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.tool.driver.name).toBe('effect-analyzer');
    expect(sarif.runs[0]?.results[0]?.ruleId).toBe('runSync-on-async');
    expect(sarif.runs[0]?.results[0]?.fingerprints.primaryLocationLineHash).toBe('abc123');
    const ruleMeta = sarif.runs[0]?.tool.driver.rules?.find((r) => r.id === 'runSync-on-async');
    expect(ruleMeta?.helpUri?.includes('/tooling/effect-analyzer/rules/')).toBe(true);
  });
});

describe('lint-session scorecard', () => {
  it('builds deterministic per-file weighted scores', () => {
    const findings = [
      {
        filePath: '/tmp/b.ts',
        rule: 'unsafe-api-usage',
        severity: 'warning' as const,
        message: 'unsafe',
        line: 1,
        column: 1,
        fingerprint: '1',
      },
      {
        filePath: '/tmp/a.ts',
        rule: 'x',
        severity: 'warning' as const,
        message: 'w',
        line: 1,
        column: 1,
        fingerprint: '2',
      },
      {
        filePath: '/tmp/a.ts',
        rule: 'y',
        severity: 'info' as const,
        message: 'i',
        line: 2,
        column: 1,
        fingerprint: '3',
      },
    ];

    const rows = buildLintScorecard(findings);
    expect(rows.map((r) => r.filePath)).toEqual(['/tmp/b.ts', '/tmp/a.ts']);
    expect(rows[0]).toMatchObject({ score: 88, penalty: 12, findings: 1, warnings: 1 });
    expect(rows[1]).toMatchObject({ score: 95, penalty: 5, findings: 2, warnings: 1, info: 1 });
  });
});
