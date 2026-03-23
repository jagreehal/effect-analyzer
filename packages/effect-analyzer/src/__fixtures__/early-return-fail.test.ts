import { describe, it, expect, beforeAll } from 'vitest';
import { Effect } from 'effect';
import { analyze } from '../analyze';
import { resolve } from 'path';
import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticGeneratorNode,
  StaticDecisionNode,
  StaticTerminalNode,
} from '../types';
import { renderMermaid } from '../output/mermaid';

const FIXTURE_PATH = resolve(__dirname, 'early-return-fail.ts');

describe('Early return with Effect.fail - conditional branch fix', () => {
  let programsByName: Map<string, StaticEffectIR>;

  beforeAll(async () => {
    const results = await Effect.runPromise(
      analyze(FIXTURE_PATH).all(),
    );
    programsByName = new Map(
      results.map((ir) => [ir.root.programName, ir]),
    );
  }, 30_000);

  it('should produce correct IR: decision has no onFalse, success is a sibling', () => {
    const ir = programsByName.get('earlyReturnFail');
    expect(ir).toBeDefined();

    const gen = ir!.root.children.find(
      (n): n is StaticGeneratorNode => n.type === 'generator',
    );
    expect(gen).toBeDefined();

    const yields = gen!.yields;
    const decisionIdx = yields.findIndex(y => y.effect.type === 'decision');
    expect(decisionIdx).toBeGreaterThanOrEqual(0);

    const decision = yields[decisionIdx]!.effect as StaticDecisionNode;

    // onTrue should contain the error path (terminal return with fail)
    expect(decision.onTrue.length).toBeGreaterThan(0);
    expect(decision.onTrue.some(n => n.type === 'terminal')).toBe(true);

    // onFalse should be undefined — there is no else branch
    expect(decision.onFalse).toBeUndefined();

    // The success continuation should be AFTER the decision in the yields array,
    // NOT duplicated or misplaced inside onFalse
    const afterDecision = yields.slice(decisionIdx + 1);
    expect(afterDecision.length).toBeGreaterThan(0);

    // The success path should NOT contain a fail node
    const afterTypes = afterDecision.map(y => (y.effect as any).callee || y.effect.type);
    expect(afterTypes).not.toContain('Effect.fail');
  });

  it('should not duplicate yielded calls in the non-yielded scanner', () => {
    const ir = programsByName.get('earlyReturnFail');
    expect(ir).toBeDefined();

    const gen = ir!.root.children.find(
      (n): n is StaticGeneratorNode => n.type === 'generator',
    );
    expect(gen).toBeDefined();

    // Count how many Effect.succeed nodes appear in the yields.
    // The fixture has 3 yield* Effect.succeed calls + 1 yield* Effect.fail.
    // Without deduplication, the non-yielded scanner would add duplicates.
    const effectNodes = gen!.yields.filter(
      y => y.effect.type === 'effect',
    );
    const succeedCount = effectNodes.filter(
      y => (y.effect as any).callee === 'Effect.succeed',
    ).length;
    // Exactly 3: balance, amount, result (no duplicates)
    expect(succeedCount).toBe(3);

    // No fail nodes should appear as top-level yields (fail is inside the decision's onTrue)
    const failCount = effectNodes.filter(
      y => (y.effect as any).callee === 'Effect.fail',
    ).length;
    expect(failCount).toBe(0);
  });

  it('should generate Mermaid diagram without fail on success path', async () => {
    const ir = programsByName.get('earlyReturnFail');
    expect(ir).toBeDefined();

    const mermaid = await Effect.runPromise(renderMermaid(ir!));

    // The diagram should contain the decision node
    expect(mermaid).toContain('balance < amount');

    // The "no" path (success) should NOT go through a fail node
    const lines = mermaid.split('\n');
    const noEdges = lines.filter(l => l.includes('|no|'));
    for (const edge of noEdges) {
      expect(edge).not.toMatch(/fail/i);
    }

    // The fail node should only be reachable from the "yes" (error) path
    const yesEdges = lines.filter(l => l.includes('|yes|'));
    expect(yesEdges.length).toBeGreaterThan(0);
  });
});
