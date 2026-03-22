/**
 * Unit tests for Mermaid output (no ts-morph or file fixtures).
 */

import { describe, it, expect } from 'vitest';
import {
  renderStaticMermaid,
  renderPathsMermaid,
  summarizePathSteps,
  renderEnhancedMermaid,
} from './mermaid';
import type { StaticEffectIR, StaticEffectNode, StaticGeneratorNode } from '../types';

function makeEffectNode(id: string, callee: string): StaticEffectNode {
  return {
    id,
    type: 'effect',
    callee,
  };
}

function makeGeneratorNode(
  id: string,
  yields: { effect: StaticEffectNode }[],
): StaticGeneratorNode {
  return {
    id,
    type: 'generator',
    yields: yields.map((y) => ({ effect: y.effect })),
  };
}

function makeIR(rootChildren: StaticEffectIR['root']['children']): StaticEffectIR {
  return {
    root: {
      id: 'program-1',
      type: 'program',
      programName: 'testProgram',
      source: 'generator',
      children: rootChildren,
      dependencies: [],
      errorTypes: [],
    },
    metadata: {
      analyzedAt: Date.now(),
      filePath: 'test.ts',
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
      },
    },
    references: new Map(),
  };
}

describe('mermaid', () => {
  describe('renderStaticMermaid', () => {
    it('includes Start and End nodes', () => {
      const ir = makeIR([
        makeGeneratorNode('gen-1', [
          { effect: makeEffectNode('e1', 'Effect.succeed') },
        ]),
      ]);
      const diagram = renderStaticMermaid(ir);
      expect(diagram).toContain('Start');
      expect(diagram).toContain('End');
      expect(diagram).toContain('flowchart');
    });

    it('includes program name in comment', () => {
      const ir = makeIR([
        makeEffectNode('e1', 'Effect.log'),
      ]);
      const diagram = renderStaticMermaid(ir);
      expect(diagram).toContain('testProgram');
    });

    it('respects direction option', () => {
      const ir = makeIR([makeEffectNode('e1', 'Effect.succeed')]);
      expect(renderStaticMermaid(ir, { direction: 'TB' })).toContain('flowchart TB');
      expect(renderStaticMermaid(ir, { direction: 'LR' })).toContain('flowchart LR');
    });
  });

  describe('renderPathsMermaid', () => {
    it('produces flowchart with Start and End', () => {
      const paths = [
        {
          id: 'path-1',
          description: 'path',
          steps: [
            { nodeId: 'e1', name: 'Effect.succeed', repeated: false },
            { nodeId: 'e2', name: 'Effect.log', repeated: false },
          ],
          conditions: [],
          hasLoops: false,
          hasUnresolvedRefs: false,
        },
      ];
      const diagram = renderPathsMermaid(paths);
      expect(diagram).toContain('flowchart');
      expect(diagram).toContain('start((Start))');
      expect(diagram).toContain('end_node((End))');
    });

    it('collapses repeated log and transform runs in summary mode', () => {
      const paths = [
        {
          id: 'path-1',
          description: 'path',
          steps: [
            { nodeId: 'e1', name: 'Effect.logInfo', repeated: false },
            { nodeId: 'e2', name: 'Effect.logDebug', repeated: false },
            { nodeId: 'e3', name: 'map', repeated: false },
            { nodeId: 'e4', name: 'flatMap', repeated: false },
            { nodeId: 'e5', name: 'repo.getUser', repeated: false },
          ],
          conditions: [],
          hasLoops: false,
          hasUnresolvedRefs: false,
        },
      ];
      const diagram = renderPathsMermaid(paths);
      expect(diagram).toContain('log steps ×2');
      expect(diagram).toContain('transform steps ×2');
      expect(diagram).toContain('repo.getUser');
    });

    it('can disable collapsing heuristics', () => {
      const paths = [
        {
          id: 'path-1',
          description: 'path',
          steps: [
            { nodeId: 'e1', name: 'Effect.logInfo', repeated: false },
            { nodeId: 'e2', name: 'Effect.logDebug', repeated: false },
          ],
          conditions: [],
          hasLoops: false,
          hasUnresolvedRefs: false,
        },
      ];
      const diagram = renderPathsMermaid(paths, {
        collapseRepeatedLogs: false,
        collapsePureTransforms: false,
      });
      expect(diagram).toContain('Effect.logInfo');
      expect(diagram).toContain('Effect.logDebug');
      expect(diagram).not.toContain('log steps ×2');
    });

    it('applies style-guide env grouping and service boundary prefixes', () => {
      const paths = [
        {
          id: 'path-1',
          description: 'path',
          steps: [
            { nodeId: 'e1', name: 'AppConfig', repeated: false },
            { nodeId: 'e2', name: 'Db', repeated: false },
            { nodeId: 'e3', name: 'repo.getUser', repeated: false },
            { nodeId: 'e4', name: 'billing.charge', repeated: false },
          ],
          conditions: [],
          hasLoops: false,
          hasUnresolvedRefs: false,
        },
      ];

      const summary = summarizePathSteps(paths[0], { styleGuide: true });
      expect(summary.steps.map((s) => s.name)).toEqual([
        'environment ×2',
        'svc: repo.getUser',
        'svc: billing.charge',
      ]);
      expect(summary.collapsedGroups).toBe(1);
    });
  });

  describe('renderEnhancedMermaid', () => {
    it('produces diagram with type annotations when effect has typeSignature', () => {
      const effectWithType = makeEffectNode('e1', 'Effect.succeed');
      (effectWithType as StaticEffectNode & { typeSignature?: unknown }).typeSignature = {
        successType: 'number',
        errorType: 'never',
        requirementsType: 'never',
        isInferred: true,
        typeConfidence: 'declared',
      };
      const ir = makeIR([
        makeGeneratorNode('gen-1', [{ effect: effectWithType }]),
      ]);
      const diagram = renderEnhancedMermaid(ir);
      expect(diagram).toContain('Start');
      expect(diagram).toContain('End');
      expect(diagram).toContain('number');
    });
  });
});
