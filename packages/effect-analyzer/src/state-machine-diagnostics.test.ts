import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnoseStateMachines } from './state-machine-diagnostics';

const nearMiss = join(__dirname, '__fixtures__', 'state-machine-near-miss.ts');

describe('diagnoseStateMachines', () => {
  it('finds no real machines in the near-miss fixture', () => {
    expect(diagnoseStateMachines(nearMiss).machines).toEqual([]);
  });

  it('explains a config-shaped table whose events lead nowhere', () => {
    const { rejected } = diagnoseStateMachines(nearMiss);
    const r = rejected.find((x) => x.name === 'settingsTransitions');
    expect(r?.kind).toBe('transition-table');
    expect(r?.reason).toMatch(/no event targets another state/);
    expect(r?.location?.line).toBeGreaterThan(0);
  });

  it('explains a Match.when handler that returns a non-literal state', () => {
    const { rejected } = diagnoseStateMachines(nearMiss);
    const r = rejected.find((x) => x.name === 'computedTransition');
    expect(r?.kind).toBe('match');
    expect(r?.reason).toMatch(/does not return a literal next state/);
  });

  it('explains single-level Match.tags as variant dispatch', () => {
    const { rejected } = diagnoseStateMachines(nearMiss);
    const r = rejected.find((x) => x.name === 'describe');
    expect(r?.reason).toMatch(/variant dispatch/);
    expect(r?.hint).toMatch(/nest/i);
  });

  it('does not flag a real machine as a near-miss', () => {
    const fixture = join(__dirname, '__fixtures__', 'state-machine.ts');
    const { machines, rejected } = diagnoseStateMachines(fixture);
    expect(machines.length).toBeGreaterThan(0);
    const names = new Set(rejected.map((r) => r.name));
    expect(names.has('supportTransitions')).toBe(false);
    expect(names.has('docTransition')).toBe(false);
  });
});
