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
import type { StaticEffectIR, StaticEffectNode, StaticGeneratorNode, StaticDecisionNode, StaticFlowNode } from '../types';

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

    it('only emits classDef for styles actually used by nodes', () => {
      const ir = makeIR([
        makeEffectNode('e1', 'Effect.succeed'),
      ]);
      const diagram = renderStaticMermaid(ir);
      // Start and end styles should always be emitted
      expect(diagram).toContain('classDef startStyle');
      expect(diagram).toContain('classDef endStyle');
      // effectStyle should be emitted since we have an effect node
      expect(diagram).toContain('classDef effectStyle');
      // Styles for node types NOT present should NOT be emitted
      expect(diagram).not.toContain('classDef parallelStyle');
      expect(diagram).not.toContain('classDef raceStyle');
      expect(diagram).not.toContain('classDef retryStyle');
      expect(diagram).not.toContain('classDef timeoutStyle');
      expect(diagram).not.toContain('classDef resourceStyle');
      expect(diagram).not.toContain('classDef layerStyle');
      expect(diagram).not.toContain('classDef streamStyle');
      expect(diagram).not.toContain('classDef channelStyle');
      expect(diagram).not.toContain('classDef sinkStyle');
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
    it('does not duplicate type signature when displayName is present', () => {
      const effectWithType = makeEffectNode('e1', 'deps.validateTransfer');
      const typed = effectWithType as StaticEffectNode & {
        typeSignature?: unknown;
        displayName?: string;
        semanticRole?: string;
      };
      typed.typeSignature = {
        successType: 'ValidatedTransfer',
        errorType: 'ValidationError',
        requirementsType: 'never',
        isInferred: true,
        typeConfidence: 'declared',
      };
      typed.displayName = 'validated <- deps.validateTransfer';
      typed.semanticRole = 'side-effect';
      const ir = makeIR([
        makeGeneratorNode('gen-1', [{ effect: effectWithType }]),
      ]);
      const diagram = renderEnhancedMermaid(ir);
      // displayName should appear
      expect(diagram).toContain('validated <- deps.validateTransfer');
      // semantic role should still be appended
      expect(diagram).toContain('side-effect');
      // type signature should NOT appear (it would be a duplicate)
      const matches = diagram.match(/ValidatedTransfer/g);
      expect(matches).toBeNull();
    });

    it('still appends type signature when displayName is NOT present', () => {
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
      expect(diagram).toContain('number');
    });

    it('keeps type signature in static Mermaid when displayName is present', () => {
      const effectWithType = makeEffectNode('e1', 'deps.validateTransfer');
      const typed = effectWithType as StaticEffectNode & {
        typeSignature?: unknown;
        displayName?: string;
      };
      typed.typeSignature = {
        successType: 'ValidatedTransfer',
        errorType: 'ValidationError',
        requirementsType: 'never',
        isInferred: true,
        typeConfidence: 'declared',
      };
      typed.displayName = 'validated <- deps.validateTransfer';
      const ir = makeIR([
        makeGeneratorNode('gen-1', [{ effect: effectWithType }]),
      ]);

      const diagram = renderStaticMermaid(ir);

      expect(diagram).toContain('validated <- deps.validateTransfer');
      expect(diagram).toContain('ValidatedTransfer');
      expect(diagram).toContain('ValidationError');
    });

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

  describe('compact detail level', () => {
    it('collapses inner generators to summary nodes', () => {
      const innerGen = makeGeneratorNode('inner-gen', [
        { effect: makeEffectNode('ie1', 'db.query') },
        { effect: makeEffectNode('ie2', 'db.insert') },
        { effect: makeEffectNode('ie3', 'db.commit') },
      ]);
      (innerGen as any).name = 'processMessage';

      const outerGen = makeGeneratorNode('outer-gen', [
        { effect: makeEffectNode('e1', 'Effect.log') },
        { effect: innerGen as any },
        { effect: makeEffectNode('e2', 'Effect.succeed') },
      ]);
      const ir = makeIR([outerGen]);

      const diagram = renderStaticMermaid(ir, { detail: 'compact' });

      expect(diagram).toContain('processMessage (3 steps)');
      expect(diagram).not.toContain('db.query');
      expect(diagram).not.toContain('db.insert');
      expect(diagram).not.toContain('db.commit');
      expect(diagram).toContain('Effect.log');
      expect(diagram).toContain('Effect.succeed');
    });

    it('does not collapse root-level generator children', () => {
      const gen = makeGeneratorNode('gen-1', [
        { effect: makeEffectNode('e1', 'Effect.log') },
        { effect: makeEffectNode('e2', 'Effect.succeed') },
      ]);
      const ir = makeIR([gen]);

      const diagram = renderStaticMermaid(ir, { detail: 'compact' });

      expect(diagram).toContain('Effect.log');
      expect(diagram).toContain('Effect.succeed');
    });

    it('falls back to Generator label when inner generator has no name', () => {
      const innerGen = makeGeneratorNode('inner-gen', [
        { effect: makeEffectNode('ie1', 'db.query') },
        { effect: makeEffectNode('ie2', 'db.insert') },
      ]);
      const outerGen = makeGeneratorNode('outer-gen', [
        { effect: innerGen as any },
      ]);
      const ir = makeIR([outerGen]);

      const diagram = renderStaticMermaid(ir, { detail: 'compact' });

      expect(diagram).toContain('Generator (2 steps)');
      expect(diagram).not.toContain('db.query');
    });

    it('collapses nested generators inside top-level parallel branches', () => {
      const branchGen = makeGeneratorNode('branch-gen', [
        { effect: makeEffectNode('ie1', 'db.query') },
        { effect: makeEffectNode('ie2', 'db.insert') },
      ]);
      (branchGen as any).name = 'processBranch';

      const parallel = {
        id: 'p1',
        type: 'parallel',
        callee: 'Effect.all',
        children: [branchGen as any],
        mode: 'parallel',
      } satisfies StaticFlowNode;

      const ir = makeIR([parallel]);
      const diagram = renderStaticMermaid(ir, { detail: 'compact' });

      expect(diagram).toContain('processBranch (2 steps)');
      expect(diagram).not.toContain('db.query');
      expect(diagram).not.toContain('db.insert');
    });

    it('collapses nested generators inside top-level decision branches', () => {
      const branchGen = makeGeneratorNode('branch-gen', [
        { effect: makeEffectNode('ie1', 'db.query') },
        { effect: makeEffectNode('ie2', 'db.insert') },
      ]);
      (branchGen as any).name = 'processBranch';

      const decision: StaticDecisionNode = {
        id: 'dec-compact',
        type: 'decision',
        decisionId: 'dec-compact',
        label: 'Should process?',
        condition: 'shouldProcess',
        source: 'raw-if',
        onTrue: [branchGen as any],
        onFalse: [makeEffectNode('e-false', 'Effect.void')],
      };

      const ir = makeIR([decision as unknown as StaticFlowNode]);
      const diagram = renderStaticMermaid(ir, { detail: 'compact' });

      expect(diagram).toContain('processBranch (2 steps)');
      expect(diagram).not.toContain('db.query');
      expect(diagram).not.toContain('db.insert');
    });
  });

  describe('auto detail level selection', () => {
    function makeWideGenerator(count: number): StaticGeneratorNode {
      const yields = Array.from({ length: count }, (_, i) => ({
        effect: makeEffectNode(`e${i}`, `step${i}`),
      }));
      return makeGeneratorNode('wide-gen', yields);
    }

    it('uses verbose for programs with < 30 nodes', () => {
      const ir = makeIR([makeWideGenerator(10)]);
      const diagram = renderStaticMermaid(ir);
      for (let i = 0; i < 10; i++) {
        expect(diagram).toContain(`step${i}`);
      }
    });

    it('uses standard for programs with 30-80 nodes', () => {
      const ir = makeIR([makeWideGenerator(40)]);
      const diagram = renderStaticMermaid(ir);
      for (let i = 0; i < 40; i++) {
        expect(diagram).toContain(`step${i}`);
      }
    });

    it('uses compact for programs with > 80 nodes and collapses inner programs', () => {
      const innerGens = Array.from({ length: 10 }, (_, i) => {
        const inner = makeGeneratorNode(`inner-${i}`,
          Array.from({ length: 10 }, (_, j) => ({
            effect: makeEffectNode(`e${i}-${j}`, `inner.step${i}.${j}`),
          }))
        );
        (inner as any).name = `innerProgram${i}`;
        return inner;
      });
      const outerGen = makeGeneratorNode('outer',
        innerGens.map(g => ({ effect: g as any }))
      );
      const ir = makeIR([outerGen]);

      const diagram = renderStaticMermaid(ir);

      expect(diagram).toContain('innerProgram0 (10 steps)');
      expect(diagram).not.toContain('inner.step0.0');
    });

    it('explicit detail overrides auto-selection', () => {
      const innerGens = Array.from({ length: 10 }, (_, i) => {
        const inner = makeGeneratorNode(`inner-${i}`,
          Array.from({ length: 10 }, (_, j) => ({
            effect: makeEffectNode(`e${i}-${j}`, `inner.step${i}.${j}`),
          }))
        );
        return inner;
      });
      const outerGen = makeGeneratorNode('outer',
        innerGens.map(g => ({ effect: g as any }))
      );
      const ir = makeIR([outerGen]);

      const diagram = renderStaticMermaid(ir, { detail: 'verbose' });

      expect(diagram).toContain('inner.step0.0');
    });
  });

  describe('decision nodes', () => {
    it('does not create orphan rectangular nodes for decision type', () => {
      const decision: StaticDecisionNode = {
        id: 'dec-1',
        type: 'decision',
        decisionId: 'dec-1',
        label: 'Is valid?',
        condition: 'isValid',
        source: 'raw-if',
        onTrue: [makeEffectNode('e1', 'Effect.succeed')],
        onFalse: [makeEffectNode('e2', 'Effect.fail')],
      };
      const ir = makeIR([decision as unknown as StaticFlowNode]);
      const diagram = renderStaticMermaid(ir);

      // The diamond decision node should exist
      expect(diagram).toContain('{');
      expect(diagram).toContain('Is valid?');

      // Count how many node definitions reference "Is valid?" — should be exactly 1 (the diamond)
      const nodeDefLines = diagram.split('\n').filter(
        (line) => line.includes('Is valid?') && (line.includes('[') || line.includes('{'))
      );
      expect(nodeDefLines).toHaveLength(1);
      // That single definition should be the diamond shape, not a rectangle
      expect(nodeDefLines[0]).toContain('{');
      expect(nodeDefLines[0]).not.toMatch(/\["/);
    });
  });
});
