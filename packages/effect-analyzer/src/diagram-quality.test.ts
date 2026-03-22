import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { StaticEffectIR, StaticFlowNode, SemanticRole } from './types';
import {
  computeProgramDiagramQuality,
  computeFileDiagramQuality,
  buildTopOffendersReport,
} from './diagram-quality';
import { loadDiagramQualityHintsFromEslintJson } from './diagram-quality-eslint';

function makeEffect(
  id: string,
  callee: string,
  semanticRole?: SemanticRole,
): StaticFlowNode {
  return {
    id,
    type: 'effect',
    callee,
    ...(semanticRole ? { semanticRole } : {}),
  } as StaticFlowNode;
}

function makeUnknown(id: string): StaticFlowNode {
  return {
    id,
    type: 'unknown',
    reason: 'Could not determine effect type',
  } as StaticFlowNode;
}

function makePipe(id: string, steps: readonly StaticFlowNode[]): StaticFlowNode {
  const first = steps[0];
  return {
    id,
    type: 'pipe',
    initial: first ?? makeEffect(`${id}-init`, 'Effect.succeed'),
    transformations: steps.slice(1),
  } as StaticFlowNode;
}

function makeIR(programName: string, children: readonly StaticFlowNode[], filePath = 'test.ts'): StaticEffectIR {
  return {
    root: {
      id: `${programName}-root`,
      type: 'program',
      programName,
      source: 'generator',
      children,
      dependencies: [],
      errorTypes: [],
    },
    metadata: {
      analyzedAt: Date.now(),
      filePath,
      stats: {
        totalEffects: children.length,
        parallelCount: 0,
        raceCount: 0,
        errorHandlerCount: 0,
        retryCount: 0,
        timeoutCount: 0,
        resourceCount: 0,
        loopCount: 0,
        conditionalCount: 0,
        layerCount: 0,
        interruptionCount: 0,
        unknownCount: children.filter((n) => n.type === 'unknown').length,
      },
      warnings: [],
    },
    references: new Map(),
  };
}

describe('diagram quality', () => {
  it('is deterministic for same program input', () => {
    const ir = makeIR('a', [
      makeEffect('n1', 'Effect.logInfo', 'side-effect'),
      makeEffect('n2', 'repo.getUser', 'service-call'),
      makePipe('p1', [
        makeEffect('n3', 'Effect.succeed'),
        makeEffect('n4', 'map', 'transform'),
      ]),
      makeUnknown('u1'),
    ]);

    const first = computeProgramDiagramQuality(ir);
    const second = computeProgramDiagramQuality(ir);

    expect(second).toEqual(first);
  });

  it('caps tips and uses non-judgmental prefixes', () => {
    const ir = makeIR('tips', [
      makeEffect('n1', 'Effect.logInfo', 'side-effect'),
      makeEffect('n2', 'Effect.logInfo', 'side-effect'),
      makeEffect('n3', 'Effect.logInfo', 'side-effect'),
      makeEffect('n4', '_', 'service-call'),
      makeEffect('n5', 'Effect', 'side-effect'),
      makeUnknown('u1'),
      makeUnknown('u2'),
      makePipe('p1', [
        makeEffect('n6', 'Effect.succeed'),
        makeEffect('n7', 'map', 'transform'),
        makeEffect('n8', 'map', 'transform'),
        makeEffect('n9', 'map', 'transform'),
      ]),
    ]);
    const quality = computeProgramDiagramQuality(ir);

    expect(quality.tips.length).toBeLessThanOrEqual(3);
    for (const tip of quality.tips) {
      expect(
        tip.startsWith('Consider') ||
          tip.startsWith('If you want clearer diagrams') ||
          tip.startsWith('For larger programs'),
      ).toBe(true);
    }
  });

  it('builds deterministic top offenders with tie-break by file path', () => {
    const qa = computeFileDiagramQuality(
      '/repo/b.ts',
      [makeIR('b', [makeEffect('n1', 'Effect.logInfo', 'side-effect')], '/repo/b.ts')],
    );
    const qb = computeFileDiagramQuality(
      '/repo/a.ts',
      [makeIR('a', [makeEffect('n1', 'Effect.logInfo', 'side-effect')], '/repo/a.ts')],
    );

    const report = buildTopOffendersReport([qa, qb], 2);
    expect(report.highestLogRatio).toHaveLength(2);
    expect(report.highestLogRatio[0]?.filePath).toBe('/repo/a.ts');
    expect(report.highestLogRatio[1]?.filePath).toBe('/repo/b.ts');
  });
});

describe('diagram quality eslint ingestion', () => {
  it('maps effect-like eslint rules and ignores non-effect ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'diagram-quality-eslint-'));
    const jsonPath = join(dir, 'eslint.json');
    writeFileSync(
      jsonPath,
      JSON.stringify(
        [
          {
            filePath: '/repo/src/a.ts',
            messages: [
              { ruleId: '@effect/untagged-yield', message: 'yield should be tagged', severity: 1 },
              { ruleId: 'no-unused-vars', message: 'unused', severity: 1 },
            ],
          },
        ],
        null,
        2,
      ),
      'utf-8',
    );

    const hints = await loadDiagramQualityHintsFromEslintJson(jsonPath);
    const fileHints = hints.get('/repo/src/a.ts');
    expect(fileHints).toBeDefined();
    expect((fileHints?.reasons ?? []).some((r) => r.includes('@effect/untagged-yield'))).toBe(true);
    expect((fileHints?.reasons ?? []).some((r) => r.includes('no-unused-vars'))).toBe(false);
  });
});

