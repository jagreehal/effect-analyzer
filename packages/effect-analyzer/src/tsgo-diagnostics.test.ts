import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseTsgoOutput,
  readTsgoLspConfig,
  resolveTsgoBin,
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

    it('falls back to rule defaults on an unreadable or comment-bearing tsconfig', () => {
      expect(readTsgoLspConfig('/nonexistent/tsconfig.json')).toBe('{}');
      withTsconfig('{ // a comment tsc allows but JSON.parse does not\n}', (p) => {
        expect(readTsgoLspConfig(p)).toBe('{}');
      });
    });
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
