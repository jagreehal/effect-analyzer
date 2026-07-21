import { describe, expect, it } from 'vitest';
import { fromMachineJSON, type MachineJSON } from './state-machine-json';
import { computeStateMachineCoverage } from './state-machine-coverage';
import { renderStatechartMermaid } from './output/mermaid-statechart';
import { renderXStateConfig } from './output/xstate-config';

const door: MachineJSON = {
  id: 'door',
  initial: 'Closed',
  states: {
    Closed: { on: { Toggle: 'Open' } },
    Open: { on: { Toggle: 'Closed' } },
  },
};

describe('fromMachineJSON', () => {
  it('extracts event transitions as (from,event,to) triples', () => {
    const m = fromMachineJSON(door);
    expect(m.name).toBe('door');
    expect(m.source).toBe('machine-json');
    expect(m.initial).toBe('Closed');
    expect(m.transitions).toEqual([
      { from: 'Closed', event: 'Toggle', to: 'Open' },
      { from: 'Open', event: 'Toggle', to: 'Closed' },
    ]);
  });

  it('derives an exact declared alphabet from the config', () => {
    const m = fromMachineJSON(door);
    expect(m.alphabetSource).toBe('config');
    expect(m.declaredStates).toEqual(['Closed', 'Open']);
    expect(m.declaredEvents).toEqual(['Toggle']);
  });

  it('uses schema-declared events as the exact event alphabet', () => {
    const m = fromMachineJSON({
      initial: 'Idle',
      schemas: {
        events: {
          Start: { $unserializable: 'schema', id: 'Start' },
          Cancel: { $unserializable: 'schema', id: 'Cancel' },
        },
      },
      states: { Idle: { on: { Start: 'Running' } }, Running: {} },
    });
    expect(m.declaredEvents).toEqual(['Start', 'Cancel']);
    expect(computeStateMachineCoverage(m).unhandledEvents).toEqual(['Cancel']);
  });

  it('includes final/orphan states in the state set (not just those in transitions)', () => {
    const m = fromMachineJSON({
      initial: 'Running',
      states: {
        Running: { on: { Finish: 'Done' } },
        Done: { type: 'final', on: {} },
        Orphan: { on: {} },
      },
    });
    expect(m.states).toEqual(['Running', 'Done', 'Orphan']);
  });

  it('flattens nested states and follows compound initial transitions', () => {
    const m = fromMachineJSON({
      initial: 'Checkout',
      states: {
        Checkout: {
          initial: { target: 'Cart' },
          states: {
            Cart: { on: { Submit: 'Payment' } },
            Payment: { on: { Back: 'Cart' } },
          },
        },
        Done: {},
      },
    });

    expect(m.states).toEqual(['Checkout', 'Checkout.Cart', 'Checkout.Payment', 'Done']);
    expect(m.transitions).toEqual([
      { from: 'Checkout', event: 'initial', to: 'Checkout.Cart', trigger: 'initial' },
      { from: 'Checkout.Cart', event: 'Submit', to: 'Checkout.Payment' },
      { from: 'Checkout.Payment', event: 'Back', to: 'Checkout.Cart' },
    ]);
    expect(computeStateMachineCoverage(m).unreachableStates).toEqual(['Done']);
  });

  it('accepts an object-form machine initial transition', () => {
    const m = fromMachineJSON({
      initial: { target: 'Ready', input: { source: 'test' } },
      states: { Ready: {} },
    });
    expect(m.initial).toBe('Ready');
  });

  it('carries guard names and branches on guarded transition arrays', () => {
    const m = fromMachineJSON({
      initial: 'Pending',
      states: {
        Pending: {
          on: {
            Decide: [
              { target: 'Approved', guard: { type: 'canApprove' } },
              { target: 'Rejected' },
            ],
          },
        },
        Approved: { on: {} },
        Rejected: { on: {} },
      },
    });
    expect(m.transitions).toEqual([
      { from: 'Pending', event: 'Decide', to: 'Approved', guard: 'canApprove' },
      { from: 'Pending', event: 'Decide', to: 'Rejected' },
    ]);
  });

  it('fans multi-target transitions out and preserves serialized guard labels', () => {
    const m = fromMachineJSON({
      initial: 'Waiting',
      states: {
        Waiting: {
          on: {
            Start: {
              target: ['Left', 'Right'],
              guard: { $unserializable: 'function', id: 'canStart' },
            },
          },
        },
        Left: {},
        Right: {},
      },
    });
    expect(m.transitions).toEqual([
      { from: 'Waiting', event: 'Start', to: 'Left', guard: 'canStart' },
      { from: 'Waiting', event: 'Start', to: 'Right', guard: 'canStart' },
    ]);
  });

  it('accepts expression and code guard records', () => {
    const m = fromMachineJSON({
      initial: 'A',
      states: {
        A: { on: { Expr: { target: 'B', guard: { '@expr': 'context.ready' } } } },
        B: { on: { Code: { target: 'A', guard: { '@code': 'return true' } } } },
      },
    });
    expect(m.transitions).toEqual([
      { from: 'A', event: 'Expr', to: 'B', guard: 'context.ready' },
      { from: 'B', event: 'Code', to: 'A', guard: 'return true' },
    ]);
  });

  it('models a targetless (internal) transition as a self-edge', () => {
    const m = fromMachineJSON({
      initial: 'Idle',
      states: { Idle: { on: { Ping: { guard: { type: 'g' } } } } },
    });
    expect(m.transitions).toEqual([
      { from: 'Idle', event: 'Ping', to: 'Idle', guard: 'g' },
    ]);
  });

  it('feeds coverage: reachability, dead-ends, unhandled events', () => {
    const cov = computeStateMachineCoverage(
      fromMachineJSON({
        initial: 'A',
        states: {
          A: { on: { Go: 'B', Skip: 'A' } },
          B: { on: {} }, // dead-end (final by convention)
          C: { on: { Go: 'A' } }, // unreachable from A
        },
      }),
    );
    expect(cov.alphabetKnown).toBe(true);
    expect(cov.alphabetSource).toBe('config');
    expect(cov.unreachableStates).toEqual(['C']);
    expect(cov.deadEndStates).toEqual(['B']);
    // B declares no `on`, so 'Go'/'Skip' are unhandled there — but coverage
    // counts unhandled *events* at the alphabet level; every declared event is
    // used somewhere, so none are globally unhandled here.
    expect(cov.unhandledEvents).toEqual([]);
  });

  it('ingests always (eventless) transitions as automatic reachability edges', () => {
    const m = fromMachineJSON({
      initial: 'Cart',
      states: {
        Cart: { on: { Submit: 'Validating' } },
        Validating: {
          on: {},
          always: [
            { target: 'Paid', guard: { type: 'itemsInStock' } },
            { target: 'Cart' },
          ],
        },
        Paid: { on: {} },
      },
    });
    expect(m.transitions).toEqual([
      { from: 'Cart', event: 'Submit', to: 'Validating' },
      { from: 'Validating', event: 'always', to: 'Paid', guard: 'itemsInStock', trigger: 'always' },
      { from: 'Validating', event: 'always', to: 'Cart', trigger: 'always' },
    ]);
    // 'always' is not a user event, so the declared alphabet stays clean.
    expect(m.declaredEvents).toEqual(['Submit']);
  });

  it('ingests after (delayed) transitions with readable labels', () => {
    const m = fromMachineJSON({
      initial: 'Green',
      states: {
        Green: { on: {}, after: { 5000: 'Yellow' } },
        Yellow: { on: {}, after: { 2000: 'Red' } },
        Red: { on: { Go: 'Green' } },
      },
    });
    expect(m.transitions).toEqual([
      { from: 'Green', event: 'after 5000ms', to: 'Yellow', trigger: 'after' },
      { from: 'Yellow', event: 'after 2000ms', to: 'Red', trigger: 'after' },
      { from: 'Red', event: 'Go', to: 'Green' },
    ]);
    expect(m.declaredEvents).toEqual(['Go']);
  });

  it('treats automatic transitions as reachability edges but not events in coverage', () => {
    const cov = computeStateMachineCoverage(
      fromMachineJSON({
        initial: 'Green',
        states: {
          Green: { on: {}, after: { 5000: 'Yellow' } },
          Yellow: { on: {}, after: { 2000: 'Red' } },
          Red: { on: { Go: 'Green' } },
        },
      }),
    );
    // Every state is reachable via the after-edges — no false unreachables.
    expect(cov.unreachableStates).toEqual([]);
    // A state whose only exit is automatic is not a dead end.
    expect(cov.deadEndStates).toEqual([]);
    // Only 'Go' is a real event; the synthetic after-labels never leak.
    expect(cov.declaredEvents).toEqual(['Go']);
    expect(cov.usedEvents).toEqual(['Go']);
    expect(cov.undeclaredEvents).toEqual([]);
    // Coverage denominator counts only event-handling states (just 'Red').
    expect(cov.coverageRatio).toBe(1);
  });

  it('renders to a mermaid statechart', () => {
    const mermaid = renderStatechartMermaid(fromMachineJSON(door));
    expect(mermaid).toContain('stateDiagram-v2');
    expect(mermaid).toContain('[*] --> Closed');
    expect(mermaid).toContain('Closed --> Open: Toggle');
  });

  it('round-trips a nested config through the renderers', () => {
    const m = fromMachineJSON({
      id: 'checkout',
      initial: 'Checkout',
      states: {
        Checkout: {
          initial: { target: 'Cart' },
          states: {
            Cart: { on: { Submit: 'Payment' } },
            Payment: { on: { Back: 'Cart', Pay: '#checkout.Done' } },
          },
        },
        Done: { type: 'final' },
        Abandoned: {},
      },
    });

    const mermaid = renderStatechartMermaid(m);
    // Composite block with the compound initial rendered inside it.
    expect(mermaid).toContain('state Checkout {');
    expect(mermaid).toContain('[*] --> Checkout_Cart');
    expect(mermaid).toContain('state "Cart" as Checkout_Cart');
    expect(mermaid).not.toContain(': initial');

    const config = renderXStateConfig(m);
    expect(config).toContain("initial: 'Checkout',");
    expect(config).toContain("initial: 'Cart'");
    expect(config).toContain("Submit: '#checkout.Checkout.Payment'");
    // Only an explicit `type: 'final'` is final; a transitionless `{}` node
    // is still active and must not be converted.
    expect(config).toContain("Done: { type: 'final' }");
    expect(config).toContain('Abandoned: {}');
    expect(config).not.toContain('on: { initial:');
    expect(mermaid).toContain('Done --> [*]');
    expect(mermaid).not.toContain('Abandoned --> [*]');
  });

  it('ingests invoke, entry/exit actions, and transition actions', () => {
    const m = fromMachineJSON({
      id: 'payment',
      initial: 'Editing',
      states: {
        Editing: {
          entry: [{ type: 'focusForm' }],
          on: {
            Submit: { target: 'Submitting', actions: [{ type: 'persistDraft' }] },
          },
        },
        Submitting: {
          invoke: {
            src: 'submitPayment',
            onDone: 'Done',
            onError: { target: 'Editing', guard: { type: 'retryable' } },
          },
        },
        Done: { type: 'final' },
      },
    });

    expect(m.entryActions).toEqual({ Editing: ['focusForm'] });
    expect(m.invokes).toEqual({ Submitting: [{ src: 'submitPayment' }] });
    expect(m.transitions).toContainEqual({
      from: 'Editing',
      event: 'Submit',
      to: 'Submitting',
      actions: ['persistDraft'],
    });
    expect(m.transitions).toContainEqual({
      from: 'Submitting',
      event: 'onDone',
      to: 'Done',
      trigger: 'done',
      invokeIndex: 0,
    });
    // invoke completions are reachability edges, not events, in coverage
    const cov = computeStateMachineCoverage(m);
    expect(cov.usedEvents).toEqual(['Submit']);
    expect(cov.unreachableStates).toEqual([]);

    const config = renderXStateConfig(m);
    expect(config).toContain(
      "invoke: { src: 'submitPayment', onDone: 'Done', onError: [{ target: 'Editing', guard: 'retryable' }] }",
    );
    expect(config).toContain("entry: ['focusForm']");
  });

  it('preserves every invoke and associates completion transitions by index', () => {
    const m = fromMachineJSON({
      id: 'multiInvoke',
      initial: 'Busy',
      states: {
        Busy: {
          invoke: [
            { id: 'loadUser', src: 'loadUser', onDone: 'UserReady' },
            { id: 'loadTeam', src: 'loadTeam', onDone: 'TeamReady' },
          ],
        },
        UserReady: {},
        TeamReady: {},
      },
    });

    expect(m.invokes).toEqual({
      Busy: [
        { id: 'loadUser', src: 'loadUser' },
        { id: 'loadTeam', src: 'loadTeam' },
      ],
    });
    expect(m.transitions).toContainEqual({
      from: 'Busy',
      event: 'onDone',
      to: 'UserReady',
      trigger: 'done',
      invokeIndex: 0,
    });
    expect(m.transitions).toContainEqual({
      from: 'Busy',
      event: 'onDone',
      to: 'TeamReady',
      trigger: 'done',
      invokeIndex: 1,
    });

    const config = renderXStateConfig(m);
    expect(config).toContain(
      "invoke: [{ src: 'loadUser', id: 'loadUser', onDone: 'UserReady' }, { src: 'loadTeam', id: 'loadTeam', onDone: 'TeamReady' }]",
    );
  });

  it('carries parallel states through to the exported config', () => {
    const m = fromMachineJSON({
      id: 'checkout',
      initial: 'Active',
      states: {
        Active: {
          type: 'parallel',
          states: {
            Payment: {
              initial: 'Editing',
              states: { Editing: { on: { Save: 'Saved' } }, Saved: {} },
            },
            Validation: {
              initial: 'Pending',
              states: { Pending: { on: { Validate: 'Valid' } }, Valid: {} },
            },
          },
        },
      },
    });
    expect(m.parallelStates).toEqual(['Active']);

    const config = renderXStateConfig(m);
    expect(config).toContain("type: 'parallel'");
    // a parallel node has no initial of its own; its regions keep theirs
    expect(config).toMatch(/Active: \{\n\s+type: 'parallel',\n\s+states: \{/);
    expect(config).toContain("initial: 'Editing'");
    expect(config).toContain("initial: 'Pending'");
  });

  it('honors a name override', () => {
    expect(fromMachineJSON(door, { name: 'FrontDoor' }).name).toBe('FrontDoor');
    expect(fromMachineJSON({ initial: 'X', states: { X: { on: {} } } }).name).toBe('machine');
  });

  describe('validation (trust boundary)', () => {
    it('rejects a non-string initial', () => {
      expect(() => fromMachineJSON({ states: {} } as unknown as MachineJSON)).toThrow(/initial/);
    });
    it('rejects non-object states', () => {
      expect(() =>
        fromMachineJSON({ initial: 'A', states: null } as unknown as MachineJSON),
      ).toThrow(/states/);
    });
    it('rejects a malformed transition target', () => {
      expect(() =>
        fromMachineJSON({
          initial: 'A',
          states: { A: { on: { Go: { target: 42 } } } },
        } as unknown as MachineJSON),
      ).toThrow(/target/);
    });
    it.each([42, null, {}, { $unserializable: 'unknown' }])(
      'rejects malformed invoke src %j',
      (src) => {
        expect(() =>
          fromMachineJSON({
            initial: 'A',
            states: { A: { invoke: { src } } },
          } as unknown as MachineJSON),
        ).toThrow(/fromMachineJSON:.*invoke\[0\]\.src/);
      },
    );
  });
});
