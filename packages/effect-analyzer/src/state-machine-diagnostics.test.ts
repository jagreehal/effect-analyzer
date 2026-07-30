import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnoseStateMachines } from './state-machine-diagnostics';

const diagnose = (src: string) =>
  diagnoseStateMachines('/virtual/near-miss.ts', src);

describe('diagnoseStateMachines', () => {
  it('explains a machine whose state tree lives in another file', () => {
    const { machines, rejected } = diagnose(`
      import { Machine } from '@typeonce/effect-machine';
      import { States } from './states';
      export const Gate = Machine.make({
        states: States.states,
        events: [Shut],
        initial: () => States.initial.Open(new Open()),
      }).handle({
        Open: { on: { Shut: ({ target }) => target.full.Closed(new Closed()) } },
      });
    `);
    expect(machines).toEqual([]);
    const r = rejected.find((x) => x.name === 'Gate');
    expect(r?.kind).toBe('effect-machine');
    expect(r?.reason).toMatch(/not declared in this file/);
    expect(r?.hint).toMatch(/Machine\.defineStates/);
    expect(r?.location?.line).toBeGreaterThan(0);
  });

  it('explains a Machine binding that is not the packages own', () => {
    const { machines, rejected } = diagnose(`
      import { Machine } from './effect-kit';
      const States = Machine.defineStates({ Open, Closed });
      export const Gate = Machine.make({
        states: States.states,
        events: [Shut],
        initial: () => States.initial.Open(new Open()),
      }).handle({
        Open: { on: { Shut: ({ target }) => target.full.Closed(new Closed()) } },
      });
    `);
    expect(machines).toEqual([]);
    const r = rejected.find((x) => x.name === 'Gate');
    expect(r?.reason).toMatch(/not a `Machine` imported from @typeonce\/effect-machine/);
    expect(r?.hint).toMatch(/re-export cannot be followed/);
    // The `defineStates` above has the same root cause — say it once.
    expect(rejected).toHaveLength(1);
  });

  it('explains a barrel-imported defineStates with no machine beside it', () => {
    const { rejected } = diagnose(`
      import { Machine } from './effect-kit';
      export const States = Machine.defineStates({ Open, Closed });
    `);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.name).toBe('States');
    expect(rejected[0]?.reason).toMatch(/not a `Machine` imported/);
  });

  it('stays quiet about an unrelated make() with no handle chain', () => {
    const { rejected } = diagnose(`
      const FakeMachine = { make: (config: unknown) => config };
      const NotAStateMachine = FakeMachine.make({ states: { Open }, events: [] });
    `);
    expect(rejected).toEqual([]);
  });

  it('explains a state tree that no machine consumes', () => {
    const { rejected } = diagnose(`
      import { Machine } from '@typeonce/effect-machine';
      export const OrphanStates = Machine.defineStates({ Open, Closed });
    `);
    const r = rejected.find((x) => x.name === 'OrphanStates');
    expect(r?.reason).toMatch(/no Machine.make in this file uses them/);
    expect(r?.hint).toMatch(/OrphanStates\.states/);
  });

  it('does not flag a real machine as a near-miss', () => {
    const fixture = join(__dirname, '__fixtures__', 'effect-machine.ts');
    const { machines, rejected } = diagnoseStateMachines(fixture);
    expect(machines.length).toBeGreaterThan(0);
    const names = new Set(rejected.map((r) => r.name));
    expect(names.has('CheckoutMachine')).toBe(false);
    expect(names.has('EditorMachine')).toBe(false);
    expect(names.has('CheckoutStates')).toBe(false);
  });
});
