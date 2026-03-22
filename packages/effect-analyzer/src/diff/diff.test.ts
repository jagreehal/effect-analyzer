import { describe, it, expect } from 'vitest';
import { diffPrograms } from './diff-engine';
import { renderDiffMarkdown } from './render-markdown';
import { renderDiffJSON } from './render-json';
import type { StaticEffectIR } from '../types';

function makeIR(
  programName: string,
  nodes: { id: string; callee: string; displayName?: string }[],
): StaticEffectIR {
  return {
    root: {
      id: 'prog-1',
      type: 'program',
      programName,
      source: 'generator',
      children: nodes.map((n) => ({
        id: n.id,
        type: 'effect' as const,
        callee: n.callee,
        name: n.callee,
        displayName: n.displayName,
      })),
      dependencies: [],
      errorTypes: [],
    },
    metadata: {
      analyzedAt: Date.now(),
      filePath: 'test.ts',
      warnings: [],
      stats: {
        totalEffects: 0,
        parallelCount: 0,
        raceCount: 0,
        errorHandlerCount: 0,
        retryCount: 0,
        timeoutCount: 0,
        resourceCount: 0,
        loopCount: 0,
        conditionalCount: 0,
        layerCount: 0,
        unknownCount: 0,
        interruptionCount: 0,
        decisionCount: 0,
        switchCount: 0,
        tryCatchCount: 0,
        terminalCount: 0,
        opaqueCount: 0,
      },
    },
    references: new Map(),
  };
}

describe('diffPrograms', () => {
  it('detects identical programs as all unchanged', () => {
    const ir = makeIR('testProg', [
      { id: 's1', callee: 'Effect.succeed' },
      { id: 's2', callee: 'Effect.fail' },
    ]);
    const diff = diffPrograms(ir, ir);

    expect(diff.summary.stepsUnchanged).toBe(2);
    expect(diff.summary.stepsAdded).toBe(0);
    expect(diff.summary.stepsRemoved).toBe(0);
    expect(diff.steps.every((s) => s.kind === 'unchanged')).toBe(true);
  });

  it('detects added steps', () => {
    const before = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const after = makeIR('prog', [
      { id: 's1', callee: 'Effect.succeed' },
      { id: 's2', callee: 'Effect.fail' },
    ]);
    const diff = diffPrograms(before, after);

    expect(diff.summary.stepsAdded).toBe(1);
    expect(diff.summary.stepsUnchanged).toBe(1);
    expect(diff.steps.find((s) => s.kind === 'added')?.stepId).toBe('s2');
  });

  it('detects removed steps', () => {
    const before = makeIR('prog', [
      { id: 's1', callee: 'Effect.succeed' },
      { id: 's2', callee: 'Effect.fail' },
    ]);
    const after = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const diff = diffPrograms(before, after);

    expect(diff.summary.stepsRemoved).toBe(1);
    expect(diff.steps.find((s) => s.kind === 'removed')?.stepId).toBe('s2');
  });

  it('detects removed steps as regressions in regression mode', () => {
    const before = makeIR('prog', [
      { id: 's1', callee: 'Effect.succeed' },
      { id: 's2', callee: 'Effect.fail' },
    ]);
    const after = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const diff = diffPrograms(before, after, { regressionMode: true });

    expect(diff.summary.hasRegressions).toBe(true);
  });

  it('detects renamed steps (same callee, different id, same position)', () => {
    const before = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const after = makeIR('prog', [{ id: 's1-new', callee: 'Effect.succeed' }]);
    const diff = diffPrograms(before, after);

    expect(diff.summary.stepsRenamed).toBe(1);
    const renamed = diff.steps.find((s) => s.kind === 'renamed');
    expect(renamed?.stepId).toBe('s1-new');
    expect(renamed?.previousStepId).toBe('s1');
  });

  it('detects moved steps (same id, different container)', () => {
    // Before: effect inside root
    const before: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'prog',
        source: 'generator',
        children: [
          {
            id: 's1',
            type: 'effect',
            callee: 'Effect.succeed',
          },
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: 'test.ts',
        warnings: [],
        stats: {
          totalEffects: 0,
          parallelCount: 0,
          raceCount: 0,
          errorHandlerCount: 0,
          retryCount: 0,
          timeoutCount: 0,
          resourceCount: 0,
          loopCount: 0,
          conditionalCount: 0,
          layerCount: 0,
          unknownCount: 0,
          interruptionCount: 0,
          decisionCount: 0,
          switchCount: 0,
          tryCatchCount: 0,
          terminalCount: 0,
          opaqueCount: 0,
        },
      },
      references: new Map(),
    };

    // After: same effect inside a parallel block
    const after: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'prog',
        source: 'generator',
        children: [
          {
            id: 'p1',
            type: 'parallel',
            callee: 'Effect.all',
            mode: 'parallel',
            children: [
              {
                id: 's1',
                type: 'effect',
                callee: 'Effect.succeed',
              },
            ],
          },
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: 'test.ts',
        warnings: [],
        stats: {
          totalEffects: 0,
          parallelCount: 1,
          raceCount: 0,
          errorHandlerCount: 0,
          retryCount: 0,
          timeoutCount: 0,
          resourceCount: 0,
          loopCount: 0,
          conditionalCount: 0,
          layerCount: 0,
          unknownCount: 0,
          interruptionCount: 0,
          decisionCount: 0,
          switchCount: 0,
          tryCatchCount: 0,
          terminalCount: 0,
          opaqueCount: 0,
        },
      },
      references: new Map(),
    };

    const diff = diffPrograms(before, after);
    expect(diff.summary.stepsMoved).toBe(1);
    const moved = diff.steps.find((s) => s.kind === 'moved');
    expect(moved?.containerBefore).toBe('root');
    expect(moved?.containerAfter).toBe('parallel');
  });

  it('detects structural changes (parallel block added)', () => {
    const before = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const after: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'prog',
        source: 'generator',
        children: [
          {
            id: 's1',
            type: 'effect',
            callee: 'Effect.succeed',
          },
          {
            id: 'p1',
            type: 'parallel',
            callee: 'Effect.all',
            mode: 'parallel',
            children: [],
          },
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: 'test.ts',
        warnings: [],
        stats: {
          totalEffects: 0,
          parallelCount: 1,
          raceCount: 0,
          errorHandlerCount: 0,
          retryCount: 0,
          timeoutCount: 0,
          resourceCount: 0,
          loopCount: 0,
          conditionalCount: 0,
          layerCount: 0,
          unknownCount: 0,
          interruptionCount: 0,
          decisionCount: 0,
          switchCount: 0,
          tryCatchCount: 0,
          terminalCount: 0,
          opaqueCount: 0,
        },
      },
      references: new Map(),
    };

    const diff = diffPrograms(before, after);
    expect(diff.summary.structuralChanges).toBeGreaterThan(0);
    expect(diff.structuralChanges.some((sc) => sc.nodeType === 'parallel' && sc.kind === 'added')).toBe(true);
  });

  it('renders markdown with expected sections', () => {
    const before = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const after = makeIR('prog', [
      { id: 's1', callee: 'Effect.succeed' },
      { id: 's2', callee: 'Effect.fail' },
    ]);
    const diff = diffPrograms(before, after);
    const md = renderDiffMarkdown(diff);

    expect(md).toContain('# Effect Program Diff');
    expect(md).toContain('## Summary');
    expect(md).toContain('## Step Changes');
    expect(md).toContain('Effect.fail');
    expect(md).toContain('| Added | 1 |');
  });

  it('renders valid JSON with expected keys', () => {
    const before = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const after = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const diff = diffPrograms(before, after);
    const json = renderDiffJSON(diff);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('beforeName');
    expect(parsed).toHaveProperty('afterName');
    expect(parsed).toHaveProperty('diffedAt');
    expect(parsed).toHaveProperty('steps');
    expect(parsed).toHaveProperty('structuralChanges');
    expect(parsed).toHaveProperty('summary');
  });

  it('reports removed + added when rename detection is disabled', () => {
    const before = makeIR('prog', [{ id: 's1', callee: 'Effect.succeed' }]);
    const after = makeIR('prog', [{ id: 's1-new', callee: 'Effect.succeed' }]);
    const diff = diffPrograms(before, after, { detectRenames: false });

    expect(diff.summary.stepsRenamed).toBe(0);
    expect(diff.summary.stepsRemoved).toBe(1);
    expect(diff.summary.stepsAdded).toBe(1);
  });
});
