import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { analyzeStateMachines, finalStatesOf } from './state-machine';
import { renderStatechartMermaid } from './output/mermaid-statechart';
import { renderXStateConfig } from './output/xstate-config';

const fixture = join(__dirname, '__fixtures__', 'effect-machine.ts');
vi.setConfig({ testTimeout: 15_000 });

const machineNamed = (name: string) =>
  analyzeStateMachines(fixture).machines.find((m) => m.name === name);

describe('analyzeStateMachines', () => {
  it('extracts every Machine.make in the file', () => {
    const { machines } = analyzeStateMachines(fixture);
    expect(machines.map((m) => m.name).sort()).toEqual([
      'CheckoutMachine',
      'EditorMachine',
      'OrderMachine',
    ]);
    expect(machines.every((m) => m.source === 'effect-machine')).toBe(true);
  });

  it('reads a flat machine: states, events, initial, transitions', () => {
    const checkout = machineNamed('CheckoutMachine');
    expect(checkout?.states).toEqual(['Idle', 'Paying', 'Paid', 'Failed']);
    expect(checkout?.initial).toBe('Idle');
    expect(checkout?.declaredEvents).toEqual(['Pay', 'Settled', 'Cancel']);
    expect(checkout?.alphabetSource).toBe('config');
    expect(checkout?.transitions).toEqual([
      { from: 'Idle', event: 'Pay', to: 'Paying' },
      { from: 'Paying', event: 'Settled', to: 'Paid' },
      { from: 'Paying', event: 'Cancel', to: 'Failed' },
    ]);
  });

  it('reads final states, entry actions and invokes', () => {
    const checkout = machineNamed('CheckoutMachine');
    expect(checkout?.finalStates).toEqual(['Paid']);
    expect(finalStatesOf(checkout!)).toEqual(new Set(['Paid']));
    expect(checkout?.entryActions).toEqual({ Paying: ['entry'] });
    expect(checkout?.invokes).toEqual({
      Paying: [{ src: 'chargeCard', id: 'chargeCard' }],
    });
  });

  it('flattens a hierarchical state tree into dotted paths', () => {
    const editor = machineNamed('EditorMachine');
    expect(editor?.states).toEqual([
      'workspace',
      'workspace.document',
      'workspace.document.Clean',
      'workspace.document.Dirty',
      'workspace.connection',
      'workspace.connection.Online',
      'workspace.connection.Offline',
    ]);
    expect(editor?.parallelStates).toEqual(['workspace']);
    expect(editor?.exitActions).toEqual({
      'workspace.document.Dirty': ['exit'],
    });
  });

  it('emits an initial-triggered edge for each compound state', () => {
    const editor = machineNamed('EditorMachine');
    expect(editor?.transitions).toContainEqual({
      from: 'workspace.document',
      event: '',
      to: 'workspace.document.Clean',
      trigger: 'initial',
    });
    expect(editor?.transitions).toContainEqual({
      from: 'workspace.connection',
      event: '',
      to: 'workspace.connection.Online',
      trigger: 'initial',
    });
  });

  it('resolves target.local against the nearest compound ancestor', () => {
    const editor = machineNamed('EditorMachine');
    expect(editor?.transitions).toContainEqual({
      from: 'workspace.document.Clean',
      event: 'Edit',
      to: 'workspace.document.Dirty',
    });
    expect(editor?.transitions).toContainEqual({
      from: 'workspace.connection.Online',
      event: 'Disconnect',
      to: 'workspace.connection.Offline',
    });
  });

  it('resolves target.local.with(...) to a child of the re-entered state', () => {
    const editor = machineNamed('EditorMachine');
    expect(editor?.transitions).toContainEqual({
      from: 'workspace.document',
      event: 'Rename',
      to: 'workspace.document.Dirty',
    });
  });

  it('targets the parallel parent when a builder re-enters every region', () => {
    // Shape taken from the upstream Pokémon example: entering both regions at
    // once means the parent — not a leaf — is the sound target.
    expect(machineNamed('EditorMachine')?.transitions).toContainEqual({
      from: 'workspace.document.Dirty',
      event: 'Reset',
      to: 'workspace',
    });
  });

  it('records every arm of an Option.match, with no invented guard', () => {
    const loaded = machineNamed('EditorMachine')?.transitions.filter(
      (t) => t.event === 'Loaded',
    );
    expect(loaded).toEqual([
      { from: 'workspace.document.Clean', to: 'workspace.document.Clean' },
      { from: 'workspace.document.Clean', to: 'workspace.document.Dirty' },
    ].map((t) => ({ ...t, event: 'Loaded' })));
    expect(loaded?.every((t) => t.guard === undefined)).toBe(true);
  });

  it('takes the deepest path from a nested initial builder', () => {
    // The parallel root enters two regions, so the sound initial is the root.
    expect(machineNamed('EditorMachine')?.initial).toBe('workspace');
  });
});

describe('source-string analysis', () => {
  const analyze = (src: string) =>
    analyzeStateMachines('/virtual/machine.ts', src).machines;

  it('reads an inline states literal and target.full', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';
      export const Gate = Machine.make({
        states: { Open, Closed },
        events: [Shut, Unlock],
        initial: () => States.initial.Open(new Open()),
      }).handle({
        Open: { on: { Shut: ({ target }) => target.full.Closed(new Closed()) } },
        Closed: { on: { Unlock: ({ target }) => target.full.Open(new Open()) } },
      });
    `);
    expect(machine?.name).toBe('Gate');
    expect(machine?.states).toEqual(['Open', 'Closed']);
    expect(machine?.initial).toBe('Open');
    expect(machine?.transitions).toEqual([
      { from: 'Open', event: 'Shut', to: 'Closed' },
      { from: 'Closed', event: 'Unlock', to: 'Open' },
    ]);
  });

  it('finds targets buried in a pipeline and both branches of a ternary', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';
      const M = Machine.make({
        states: { A, B, C },
        events: [Go],
        initial: () => S.initial.A(new A()),
      }).handle({
        A: {
          on: {
            Go: ({ target, state }) =>
              emit(new Noise()).pipe(
                Effect.as(state.ok ? target.full.B(new B()) : target.full.C(new C())),
              ),
          },
        },
      });
    `);
    expect(machine?.transitions).toEqual([
      { from: 'A', event: 'Go', to: 'B', guard: 'state.ok' },
      { from: 'A', event: 'Go', to: 'C', guard: '!(state.ok)' },
    ]);
  });

  it('records an always transition as an eventless edge', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';
      const M = Machine.make({
        states: { A, B },
        events: [],
        initial: () => S.initial.A(new A()),
      }).handle({
        A: { always: ({ target }) => target.full.B(new B()) },
      });
    `);
    expect(machine?.transitions).toEqual([
      { from: 'A', event: 'always', to: 'B', trigger: 'always' },
    ]);
  });

  it('ignores a machine whose state tree is imported', () => {
    expect(
      analyze(`
        import { Machine } from '@typeonce/effect-machine';
        import { States } from './states';
        const M = Machine.make({ states: States.states, events: [], initial: () => 1 });
      `),
    ).toEqual([]);
  });

  it('does not treat an arbitrary property of a local const as a state tree', () => {
    expect(
      analyze(`
        import { Machine } from '@typeonce/effect-machine';
        const Config = { Open, Closed };
        const M = Machine.make({ states: Config.somethingElse, events: [], initial: () => 1 });
      `),
    ).toEqual([]);
  });

  it('reads the initial path from a snapshot literal', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';
      const M = Machine.make({
        states: { payment: { schema: Payment, initial: 'entering', states: { entering, authorized } } },
        events: [Authorize],
        initial: () => ({
          path: 'payment',
          value: payment,
          state: { path: 'payment.entering', value: entering },
        }),
      });
    `);
    expect(machine?.initial).toBe('payment.entering');
  });

  it('never infers a final state: the source declares every one', () => {
    // OrderMachine marks nothing final, so `Confirmed` — a leaf with no
    // outgoing handler — must not be drawn as terminal.
    const order = machineNamed('OrderMachine');
    expect(order?.finalStates).toEqual([]);
    expect(renderXStateConfig(order!)).toContain('Confirmed: {}');
  });

  it('labels invoked children with their declared id', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';
      const Child = Machine.child('selection', SelectionMachine);
      const Search = () => Machine.invoke({ id: 'search', src: () => logic });
      const M = Machine.make({
        states: { A, B },
        events: [Go],
        initial: () => S.initial.A(new A()),
      }).handle({
        A: { invoke: Machine.invokeMachine({ child: Child }) },
        B: { invoke: () => Search() },
      });
    `);
    expect(machine?.invokes).toEqual({
      A: [{ src: 'selection' }],
      B: [{ src: 'search', id: 'search' }],
    });
  });

  it('names an entry action after the function it references', () => {
    const [machine] = analyze(`
      import { Machine } from '@typeonce/effect-machine';
      const M = Machine.make({
        states: { A, B },
        events: [Go],
        initial: () => S.initial.A(new A()),
      }).handle({
        A: {
          entry: recordArrival,
          exit: () => Machine.action(Effect.void),
          on: { Go: ({ target }) => target.full.B(new B()) },
        },
      });
    `);
    expect(machine?.entryActions).toEqual({ A: ['recordArrival'] });
    expect(machine?.exitActions).toEqual({ A: ['exit'] });
  });
});

describe('statechart rendering', () => {
  it('renders a hierarchical XState config with nested states', () => {
    const config = renderXStateConfig(machineNamed('EditorMachine')!);
    expect(config).toContain("id: 'EditorMachine'");
    expect(config).toContain("type: 'parallel'");
    expect(config).toContain("initial: 'Clean'");
    expect(config).toContain(
      "Edit: '#EditorMachine.workspace.document.Dirty'",
    );
  });

  it('renders the flat machine with invoke and final markers', () => {
    const config = renderXStateConfig(machineNamed('CheckoutMachine')!);
    expect(config).toContain("invoke: { src: 'chargeCard', id: 'chargeCard' }");
    expect(config).toContain("type: 'final'");
    expect(config).toContain("entry: ['entry']");
  });

  it('renders a mermaid statechart', () => {
    const mermaid = renderStatechartMermaid(machineNamed('CheckoutMachine')!);
    expect(mermaid).toContain('stateDiagram-v2');
    expect(mermaid).toContain('Idle --> Paying');
  });
});
