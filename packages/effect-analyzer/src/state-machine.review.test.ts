import { describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import { renderXStateConfig } from './output/xstate-config';
import { analyzeStateMachines } from './state-machine';

const analyze = (source: string) =>
  analyzeStateMachines('/virtual/review-machine.ts', source).machines;

describe('effect-machine review regressions', () => {
  it('recognizes an aliased Machine import', () => {
    const machines = analyze(`
      import { Machine as FSM } from '@typeonce/effect-machine';

      const Gate = FSM.make({
        states: { Open, Closed },
        events: [],
        initial: () => States.initial.Open(new Open()),
      });
    `);

    expect(machines.map((machine) => machine.name)).toEqual(['Gate']);
  });

  it('does not recognize an unrelated object whose name ends in Machine', () => {
    const machines = analyze(`
      const FakeMachine = {
        make: (config: unknown) => config,
      };

      const NotAStateMachine = FakeMachine.make({
        states: { Open, Closed },
        events: [],
        initial: () => 'Open',
      });
    `);

    expect(machines).toEqual([]);
  });

  it('resolves the declared event alphabet through a local const', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';

      const Events = [OpenDoor, CloseDoor] as const;
      const Door = Machine.make({
        states: { Open, Closed },
        events: Events,
        initial: () => States.initial.Closed(new Closed()),
      });
    `);

    expect(machine?.declaredEvents).toEqual(['OpenDoor', 'CloseDoor']);
  });

  it('records final states declared by the handler tree', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';

      const Job = Machine.make({
        states: { Running, Done },
        events: [],
        initial: () => States.initial.Running(new Running()),
      }).handle({
        Done: { type: 'final' },
      });
    `);

    expect(machine?.finalStates).toEqual(['Done']);
  });

  it('records every invoke returned by an invoke factory', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';

      const Load = Machine.invoke({ id: 'load', src: () => loadLogic });
      const Watch = Machine.invoke({ id: 'watch', src: () => watchLogic });
      const App = Machine.make({
        states: { Running },
        events: [],
        initial: () => States.initial.Running(new Running()),
      }).handle({
        Running: {
          invoke: () => [Load, Watch],
        },
      });
    `);

    expect(machine?.invokes).toEqual({
      Running: [
        { src: 'load', id: 'load' },
        { src: 'watch', id: 'watch' },
      ],
    });
  });

  it('emits valid TypeScript when an anonymous machine id is not an identifier', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';

      export default Machine.make({
        id: 'checkout-flow',
        states: { Idle },
        events: [],
        initial: () => States.initial.Idle(new Idle()),
      });
    `);
    const rendered = renderXStateConfig(machine!);
    const project = new Project({ useInMemoryFileSystem: true });
    const output = project.createSourceFile('/virtual/output.ts', rendered);

    expect(
      project
        .getProgram()
        .getSyntacticDiagnostics(output)
        .map((diagnostic) => diagnostic.getMessageText()),
    ).toEqual([]);
  });
});
