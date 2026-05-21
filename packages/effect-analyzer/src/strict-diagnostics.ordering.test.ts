import { describe, expect, it } from 'vitest';
import type { StaticEffectIR } from './types';
import { validateStrict } from './strict-diagnostics';

const mockIR = (): StaticEffectIR => ({
  root: {
    id: 'root',
    type: 'program',
    programName: 'p',
    children: [
      {
        id: 'd-late',
        type: 'decision',
        decisionId: 'd-late',
        label: 'false',
        condition: 'condLate',
        source: 'raw-if',
        onTrue: [],
        onFalse: [],
        location: { filePath: 'a.ts', line: 20, column: 5 },
      },
      {
        id: 'd-early',
        type: 'decision',
        decisionId: 'd-early',
        label: 'true',
        condition: 'condEarly',
        source: 'raw-if',
        onTrue: [],
        onFalse: [],
        location: { filePath: 'a.ts', line: 3, column: 2 },
      },
      {
        id: 'd-early-dup',
        type: 'decision',
        decisionId: 'd-early-dup',
        label: 'true',
        condition: 'condEarly',
        source: 'raw-if',
        onTrue: [],
        onFalse: [],
        location: { filePath: 'a.ts', line: 3, column: 2 },
      },
    ],
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

describe('strict-diagnostics: deterministic ordering', () => {
  it('returns diagnostics in canonical location order', () => {
    const result = validateStrict(mockIR());
    const dead = result.diagnostics.filter((d) => d.rule === 'dead-code-path');
    expect(dead.length).toBe(2);
    expect(dead[0]?.location?.line).toBe(3);
    expect(dead[1]?.location?.line).toBe(20);
  });

  it('normalizes fix metadata by trimming whitespace', () => {
    const result = validateStrict(mockIR());
    const diagnosticsWithFix = result.diagnostics.filter((d) => typeof d.fix === 'string');
    for (const d of diagnosticsWithFix) {
      expect(d.fix).toBe(d.fix?.trim());
    }
  });
});
