import { describe, it, expect } from 'vitest';
import { parseTsgoOutput, runTsgoDiagnostics } from './tsgo-diagnostics';

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

  it('is a no-op when @effect/tsgo is not installed', () => {
    // The optional dependency is absent in this workspace, so the bridge must
    // degrade silently rather than break a lint run.
    expect(runTsgoDiagnostics({ project: 'tsconfig.json' })).toBeUndefined();
  });
});
