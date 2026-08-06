import { describe, it, expect } from 'vitest';
import { parseTsgoOutput, resolveTsgoBin, runTsgoDiagnostics } from './tsgo-diagnostics';

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

  it('resolves the effect-tsgo binary from the installed peer', () => {
    expect(resolveTsgoBin()).toMatch(/effect-tsgo/);
  });

  it('never throws when the project path is bogus', () => {
    // tsgo exits non-zero here; a lint run must survive it.
    expect(() => runTsgoDiagnostics({ project: 'no-such-tsconfig.json' })).not.toThrow();
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
});
