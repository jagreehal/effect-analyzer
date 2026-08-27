import { describe, expect, it } from 'vitest';
import { advance, beginWalkthrough } from './index';
import type { StaticEffectIR, StaticFlowNode } from './types';

describe('published walkthrough API', () => {
  it('lets a package-root consumer walk an Effect IR', () => {
    const effect: StaticFlowNode = {
      id: 'charge',
      type: 'effect',
      callee: 'chargeCard',
      location: { file: 'checkout.ts', line: 1, column: 1 },
    };
    const ir = {
      root: { id: 'root', type: 'root', children: [effect] },
      metadata: {},
    } as StaticEffectIR;

    const started = beginWalkthrough(ir);
    const completed = advance(started, 'charge:next');

    expect(completed.timeline).toEqual([
      { nodeId: 'charge', label: 'chargeCard' },
    ]);
    expect(completed.done).toBe(true);
  });
});
