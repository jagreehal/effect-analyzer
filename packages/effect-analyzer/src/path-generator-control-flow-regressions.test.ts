import { describe, it, expect } from 'vitest';
import { generatePathsWithMetadata } from './path-generator';
import { createEmptyStats } from './analysis-utils';
import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticDecisionNode,
  StaticTerminalNode,
} from './types';

function makeIr(children: readonly StaticFlowNode[]): StaticEffectIR {
  return {
    root: {
      id: 'program-1',
      type: 'program',
      programName: 'test-program',
      source: 'direct',
      children,
      dependencies: [],
      errorTypes: [],
    },
    metadata: {
      analyzedAt: Date.now(),
      filePath: '/tmp/test.ts',
      warnings: [],
      stats: createEmptyStats(),
    },
    references: new Map(),
  };
}

function effectNode(id: string, name = id): StaticFlowNode {
  return {
    id,
    type: 'effect',
    callee: name,
    name,
  };
}

describe('path-generator control-flow regressions', () => {
  it('return terminal should stop later sibling nodes from appearing in the same path', () => {
    const terminal: StaticTerminalNode = {
      id: 'ret-1',
      type: 'terminal',
      terminalKind: 'return',
      value: [effectNode('value-effect', 'computeReturn')],
    };

    const ir = makeIr([
      effectNode('before', 'before'),
      terminal,
      effectNode('after', 'after'),
    ]);

    const { paths } = generatePathsWithMetadata(ir);
    expect(paths).toHaveLength(1);

    const names = paths[0]!.steps.map((s) => s.name);
    expect(names).toContain('before');
    expect(names).toContain('computeReturn');
    expect(names).toContain('return');
    expect(names).not.toContain('after');
  });

  it('if-without-else decision should preserve the false condition on the fallthrough path', () => {
    const decision: StaticDecisionNode = {
      id: 'dec-1',
      type: 'decision',
      decisionId: 'd1',
      label: 'flag',
      condition: 'flag',
      source: 'raw-if',
      onTrue: [effectNode('true-branch', 'trueStep')],
      onFalse: undefined,
    };

    const ir = makeIr([decision, effectNode('after', 'after')]);
    const { paths } = generatePathsWithMetadata(ir);

    expect(paths).toHaveLength(2);

    const truePath = paths.find((p) => p.conditions.some((c) => c.expression === 'flag' && c.mustBe));
    const falsePath = paths.find((p) => p.conditions.some((c) => c.expression === 'flag' && !c.mustBe));

    expect(truePath).toBeDefined();
    expect(falsePath).toBeDefined();
  });
});
