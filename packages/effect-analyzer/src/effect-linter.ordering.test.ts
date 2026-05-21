import { describe, expect, it } from 'vitest';
import type { StaticEffectIR } from './types';
import { lintEffectProgram, type LintRule } from './effect-linter';

const mockIR = (): StaticEffectIR => ({
  root: {
    id: 'root',
    type: 'program',
    programName: 'p',
    children: [],
  },
  metadata: {
    analyzedAt: 0,
    filePath: 'x.ts',
    stats: {
      nodesVisited: 0,
      maxDepth: 0,
      parseTimeMs: 0,
      analysisTimeMs: 0,
      hasUnknownPatterns: false,
      unknownPatternCount: 0,
      unsupportedCalls: [],
      unsupportedCallCount: 0,
      unsupportedNamespaces: [],
      unsupportedNamespaceCount: 0,
      unknownCallees: [],
      unknownCalleeCount: 0,
    },
    warnings: [],
  },
});

describe('effect-linter: deterministic ordering', () => {
  it('sorts issues canonically regardless of rule emission order', () => {
    const rules: readonly LintRule[] = [
      {
        name: 'z',
        description: 'z',
        severity: 'warning',
        check: () => [
          {
            rule: 'z-rule',
            message: 'later line',
            severity: 'warning',
            location: { filePath: 'a.ts', line: 10, column: 2 },
          },
        ],
      },
      {
        name: 'a',
        description: 'a',
        severity: 'warning',
        check: () => [
          {
            rule: 'a-rule',
            message: 'earlier line',
            severity: 'warning',
            location: { filePath: 'a.ts', line: 2, column: 9 },
          },
        ],
      },
    ];

    const result = lintEffectProgram(mockIR(), rules);
    expect(result.issues.map((i) => i.rule)).toEqual(['a-rule', 'z-rule']);
  });

  it('orders same-location issues by severity error->warning->info and dedupes exact duplicates', () => {
    const rules: readonly LintRule[] = [
      {
        name: 'dup-1',
        description: 'dup-1',
        severity: 'warning',
        check: () => [
          {
            rule: 'same',
            message: 'm',
            severity: 'warning',
            location: { filePath: 'a.ts', line: 1, column: 1 },
          },
        ],
      },
      {
        name: 'dup-2',
        description: 'dup-2',
        severity: 'warning',
        check: () => [
          {
            rule: 'same',
            message: 'm',
            severity: 'warning',
            location: { filePath: 'a.ts', line: 1, column: 1 },
          },
        ],
      },
      {
        name: 'sev',
        description: 'sev',
        severity: 'warning',
        check: () => [
          {
            rule: 's',
            message: 'i',
            severity: 'info',
            location: { filePath: 'a.ts', line: 5, column: 1 },
          },
          {
            rule: 's',
            message: 'e',
            severity: 'error',
            location: { filePath: 'a.ts', line: 5, column: 1 },
          },
        ],
      },
    ];

    const result = lintEffectProgram(mockIR(), rules);
    const same = result.issues.filter((i) => i.rule === 'same');
    expect(same.length).toBe(1);
    const sameLoc = result.issues.filter(
      (i) => i.location?.filePath === 'a.ts' && i.location?.line === 5,
    );
    expect(sameLoc.map((i) => i.severity)).toEqual(['error', 'info']);
  });

  it('normalizes quick-fix metadata (trimmed message/suggestion/fix)', () => {
    const rules: readonly LintRule[] = [
      {
        name: 'meta',
        description: 'meta',
        severity: 'warning',
        check: () => [
          {
            rule: 'meta-rule',
            message: '  message with padding  ',
            severity: 'warning',
            location: { filePath: 'a.ts', line: 1, column: 1 },
            suggestion: '  suggestion text  ',
            fix: '  replacement()  ',
          },
        ],
      },
    ];

    const result = lintEffectProgram(mockIR(), rules);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toBe('message with padding');
    expect(result.issues[0]?.suggestion).toBe('suggestion text');
    expect(result.issues[0]?.fix).toBe('replacement()');
  });
});
