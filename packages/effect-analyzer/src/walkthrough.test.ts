import { describe, expect, it } from 'vitest';
import { advance, advanceWhileLinear, beginWalkthrough, rewind } from './walkthrough';
import type { StaticEffectIR, StaticFlowNode } from './types';

const effect = (id: string, callee: string): StaticFlowNode =>
  ({ id, type: 'effect', callee, displayName: callee }) as unknown as StaticFlowNode;

const ir = (children: readonly StaticFlowNode[]): StaticEffectIR =>
  ({
    root: { id: 'p1', type: 'program', programName: 'w', source: 'generator', children },
    metadata: { analyzedAt: 0, filePath: 'a.ts', stats: {} },
    references: new Map(),
  }) as unknown as StaticEffectIR;

const linear = () => ir([effect('a', 'validate'), effect('b', 'charge')]);

const withHandler = () =>
  ir([
    {
      id: 'h1',
      type: 'error-handler',
      displayName: 'catchTag',
      source: effect('a', 'charge'),
      handler: effect('r', 'refund'),
    } as unknown as StaticFlowNode,
  ]);

const conditional = (id: string, onTrue: StaticFlowNode, onFalse?: StaticFlowNode) =>
  ({ id, type: 'conditional', displayName: 'if', onTrue, onFalse }) as unknown as StaticFlowNode;

const parallel = (id: string, children: readonly StaticFlowNode[]) =>
  ({ id, type: 'parallel', displayName: 'all', children }) as unknown as StaticFlowNode;

const pipe = (id: string, initial: StaticFlowNode, transformations: readonly StaticFlowNode[]) =>
  ({ id, type: 'pipe', initial, transformations }) as unknown as StaticFlowNode;

const generator = (id: string, effects: readonly StaticFlowNode[]) =>
  ({ id, type: 'generator', yields: effects.map((e) => ({ effect: e })) }) as unknown as StaticFlowNode;

describe('beginWalkthrough', () => {
  it('starts with an empty timeline and the first choice offered', () => {
    const walk = beginWalkthrough(linear());
    expect(walk.timeline).toEqual([]);
    expect(walk.done).toBe(false);
    expect(walk.choices.map((c) => c.kind)).toEqual(['sequence']);
  });

  it('is immediately done for a program with nothing in it', () => {
    const walk = beginWalkthrough(ir([]));
    expect(walk.done).toBe(true);
    expect(walk.choices).toEqual([]);
  });
});

describe('advance', () => {
  it('records each taken step on the timeline', () => {
    let walk = beginWalkthrough(linear());
    expect(walk.choices[0]).toEqual({
      id: 'a:next',
      label: 'validate',
      kind: 'sequence',
      nodeId: 'a',
    });
    walk = advance(walk, walk.choices[0]!.id);
    // A plain sequential step carries no `via`: there was nothing to decide.
    expect(walk.timeline).toEqual([{ nodeId: 'a', label: 'validate' }]);
    walk = advance(walk, walk.choices[0]!.id);
    expect(walk.timeline.map((s) => s.label)).toEqual(['validate', 'charge']);
    expect(walk.done).toBe(true);
  });

  it('rejects a choice that is not on offer, listing what is', () => {
    const walk = beginWalkthrough(linear());
    expect(() => advance(walk, 'nonexistent')).toThrow(
      'Choice "nonexistent" is not available. On offer: a:next',
    );
    expect(() => advance(beginWalkthrough(withHandler()), 'nope')).toThrow(
      'On offer: h1:success, h1:failure',
    );
  });

  it('says so plainly when nothing at all is on offer', () => {
    const done = advanceWhileLinear(beginWalkthrough(linear()));
    expect(() => advance(done, 'anything')).toThrow(
      'Choice "anything" is not available. On offer: (none)',
    );
  });

  it('leaves the original walkthrough untouched', () => {
    const walk = beginWalkthrough(linear());
    advance(walk, walk.choices[0]!.id);
    expect(walk.timeline).toEqual([]);
  });
});

describe('error handlers', () => {
  it('offers only success when there is no handler to run', () => {
    const walk = beginWalkthrough(
      ir([
        {
          id: 'h1',
          type: 'error-handler',
          displayName: 'orDie',
          source: effect('a', 'charge'),
        } as unknown as StaticFlowNode,
      ]),
    );
    expect(walk.choices).toEqual([
      { id: 'h1:success', label: 'orDie — succeeds', kind: 'success', nodeId: 'a' },
    ]);
  });

  it('keeps the handler off the timeline, recording only the nodes underneath', () => {
    let walk = beginWalkthrough(withHandler());
    walk = advance(walk, 'h1:failure');
    expect(walk.timeline).toEqual([]);
  });

  // The devtools rule: a branch is a decision the reader makes, never a guess.
  it('offers success and failure as explicit choices', () => {
    const walk = beginWalkthrough(withHandler());
    expect(walk.choices).toEqual([
      { id: 'h1:success', label: 'catchTag — succeeds', kind: 'success', nodeId: 'a' },
      { id: 'h1:failure', label: 'catchTag — fails, handler runs', kind: 'failure', nodeId: 'r' },
    ]);
  });

  it('skips the handler on the success branch', () => {
    let walk = beginWalkthrough(withHandler());
    walk = advance(walk, walk.choices.find((c) => c.kind === 'success')!.id);
    walk = advanceWhileLinear(walk);
    expect(walk.timeline.map((s) => s.label)).toEqual(['charge']);
  });

  it('runs the handler on the failure branch', () => {
    let walk = beginWalkthrough(withHandler());
    walk = advance(walk, walk.choices.find((c) => c.kind === 'failure')!.id);
    walk = advanceWhileLinear(walk);
    expect(walk.timeline.map((s) => s.label)).toEqual(['charge', 'refund']);
  });
});

describe('rewind', () => {
  it('is a no-op when asked for a point at or past the end', () => {
    const walk = advanceWhileLinear(beginWalkthrough(linear()));
    expect(rewind(walk, walk.timeline.length)).toBe(walk);
    expect(rewind(walk, walk.timeline.length + 1)).toBe(walk);
  });

  it('stops at an intermediate point rather than replaying everything', () => {
    const walk = advanceWhileLinear(
      beginWalkthrough(ir([effect('a', 'validate'), effect('b', 'charge'), effect('c', 'notify')])),
    );
    expect(rewind(walk, 1).timeline.map((s) => s.label)).toEqual(['validate']);
  });

  it('truncates the timeline so another branch can be explored', () => {
    let walk = beginWalkthrough(withHandler());
    walk = advance(walk, walk.choices.find((c) => c.kind === 'failure')!.id);
    walk = advanceWhileLinear(walk);
    expect(walk.timeline).toHaveLength(2);

    const back = rewind(walk, 0);
    expect(back.timeline).toEqual([]);
    expect(back.choices.map((c) => c.kind)).toEqual(['success', 'failure']);

    const other = advanceWhileLinear(
      advance(back, back.choices.find((c) => c.kind === 'success')!.id),
    );
    expect(other.timeline.map((s) => s.label)).toEqual(['charge']);
  });
});

describe('branching nodes', () => {
  it('offers one condition per arm of a conditional', () => {
    const walk = beginWalkthrough(
      ir([conditional('c1', effect('t', 'ship'), effect('f', 'cancel'))]),
    );
    expect(walk.choices).toEqual([
      { id: 'c1:cond:0', label: 'if — ship', kind: 'condition', nodeId: 't' },
      { id: 'c1:cond:1', label: 'if — cancel', kind: 'condition', nodeId: 'f' },
    ]);
  });

  it('offers only the arm a one-sided conditional has', () => {
    const walk = beginWalkthrough(ir([conditional('c1', effect('t', 'ship'))]));
    expect(walk.choices.map((c) => c.nodeId)).toEqual(['t']);
  });

  it('steps onto the chosen arm and records how it was reached', () => {
    let walk = beginWalkthrough(
      ir([conditional('c1', effect('t', 'ship'), effect('f', 'cancel')), effect('z', 'log')]),
    );
    walk = advance(walk, 'c1:cond:1');
    expect(walk.timeline).toEqual([{ nodeId: 'f', label: 'if', via: 'condition' }]);
    expect(advanceWhileLinear(walk).timeline.map((s) => s.label)).toEqual([
      'if',
      'cancel',
      'log',
    ]);
  });

  it('treats a decision like a conditional, arms in order', () => {
    const decision = {
      id: 'd1',
      type: 'decision',
      displayName: 'route',
      onTrue: [effect('t', 'ship')],
      onFalse: [effect('f', 'cancel')],
    } as unknown as StaticFlowNode;
    expect(beginWalkthrough(ir([decision])).choices.map((c) => c.id)).toEqual([
      'd1:cond:0',
      'd1:cond:1',
    ]);
  });

  it('offers one condition per switch case body', () => {
    const node = {
      id: 's1',
      type: 'switch',
      displayName: 'match',
      cases: [{ body: [effect('a', 'paid')] }, { body: [effect('b', 'refunded')] }],
    } as unknown as StaticFlowNode;
    expect(beginWalkthrough(ir([node])).choices.map((c) => c.label)).toEqual([
      'match — paid',
      'match — refunded',
    ]);
  });

  it('treats a race like a parallel node', () => {
    const node = {
      id: 'r1',
      type: 'race',
      displayName: 'race',
      children: [effect('a', 'primary'), effect('b', 'fallback')],
    } as unknown as StaticFlowNode;
    expect(beginWalkthrough(ir([node])).choices.map((c) => c.id)).toEqual([
      'r1:branch:0',
      'r1:branch:1',
    ]);
  });

  it('steps into the chosen branch rather than past it', () => {
    let walk = beginWalkthrough(
      ir([parallel('p', [effect('a', 'fetchRate'), effect('b', 'fetchFees')]), effect('z', 'log')]),
    );
    walk = advanceWhileLinear(advance(walk, 'p:branch:1'));
    expect(walk.timeline.map((s) => s.label)).toEqual(['all', 'fetchFees', 'log']);
  });

  it('offers one branch per child of a parallel node', () => {
    const walk = beginWalkthrough(
      ir([parallel('p', [effect('a', 'fetchRate'), effect('b', 'fetchFees')])]),
    );
    expect(walk.choices).toEqual([
      { id: 'p:branch:0', label: 'all — fetchRate', kind: 'branch', nodeId: 'a' },
      { id: 'p:branch:1', label: 'all — fetchFees', kind: 'branch', nodeId: 'b' },
    ]);
    expect(advance(walk, 'p:branch:1').timeline).toEqual([
      { nodeId: 'b', label: 'all', via: 'branch' },
    ]);
  });

  // The devtools rule again: say "I cannot see in here" rather than invent a step.
  it.each(['unknown', 'opaque'])('reports a %s node as opaque instead of guessing', (type) => {
    const walk = beginWalkthrough(
      ir([{ id: 'o', type, displayName: 'thirdParty' } as unknown as StaticFlowNode]),
    );
    expect(walk.choices).toEqual([
      {
        id: 'o:opaque',
        label: 'thirdParty — not analyzable, contents unknown',
        kind: 'opaque',
        nodeId: 'o',
      },
    ]);
    expect(advance(walk, 'o:opaque').timeline).toEqual([
      { nodeId: 'o', label: 'thirdParty', via: 'opaque' },
    ]);
  });

  it('drops a branch choice whose node is no longer among the children', () => {
    const walk = beginWalkthrough(ir([parallel('p', [effect('a', 'one')]), effect('z', 'log')]));
    const stale = { ...walk.choices[0]!, nodeId: 'gone' };
    const patched = { ...walk, choices: [stale] };
    expect(advanceWhileLinear(advance(patched, stale.id)).timeline.map((s) => s.label)).toEqual([
      'all',
      'log',
    ]);
  });
});

describe('transparent wrappers', () => {
  it('steps through a generator to the effects it yields', () => {
    const walk = beginWalkthrough(ir([generator('g', [effect('a', 'validate')])]));
    expect(walk.choices.map((c) => c.label)).toEqual(['validate']);
  });

  it('steps through a pipe to its initial value and transformations', () => {
    const walk = beginWalkthrough(
      ir([pipe('p1', effect('a', 'fetch'), [effect('b', 'retry'), effect('c', 'timeout')])]),
    );
    expect(advanceWhileLinear(walk).timeline.map((s) => s.label)).toEqual([
      'fetch',
      'retry',
      'timeout',
    ]);
  });

  it('unwraps nested wrappers before offering anything', () => {
    const walk = beginWalkthrough(
      ir([generator('g1', [generator('g2', [effect('a', 'validate')])])]),
    );
    expect(walk.choices.map((c) => c.nodeId)).toEqual(['a']);
  });

  it('is done when a wrapper yields nothing', () => {
    expect(beginWalkthrough(ir([generator('g', [])])).done).toBe(true);
  });
});

describe('labels', () => {
  it('falls back through displayName, name, callee, then the node type', () => {
    const nodes = [
      { id: 'a', type: 'effect', displayName: 'shown', name: 'n', callee: 'c' },
      { id: 'b', type: 'effect', name: 'byName', callee: 'c' },
      { id: 'c', type: 'effect', callee: 'byCallee' },
      { id: 'd', type: 'effect' },
    ] as unknown as StaticFlowNode[];
    const labels = nodes.map((node) => beginWalkthrough(ir([node])).choices[0]!.label);
    expect(labels).toEqual(['shown', 'byName', 'byCallee', 'effect']);
  });
});

describe('advanceWhileLinear', () => {
  it('stops at the first fork', () => {
    const walk = advanceWhileLinear(
      beginWalkthrough(
        ir([effect('a', 'validate'), conditional('c1', effect('t', 'ship'), effect('f', 'cancel'))]),
      ),
    );
    expect(walk.timeline.map((s) => s.label)).toEqual(['validate']);
    expect(walk.choices.map((c) => c.kind)).toEqual(['condition', 'condition']);
  });

  it('returns the walkthrough untouched when it is already done', () => {
    const done = advanceWhileLinear(beginWalkthrough(linear()));
    expect(done.done).toBe(true);
    expect(advanceWhileLinear(done)).toBe(done);
  });
});
