import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { analyzeStateMachines } from './state-machine';

const fixture = join(__dirname, '__fixtures__', 'effect-machine-v25.ts');
vi.setConfig({ testTimeout: 15_000 });

const machineNamed = (name: string) =>
  analyzeStateMachines(fixture).machines.find((m) => m.name === name);

describe('analyzeStateMachines — Machine.states descriptor API', () => {
  it('reads a state tree declared with Machine.states', () => {
    const checkout = machineNamed('CheckoutMachine');
    expect(checkout?.source).toBe('effect-machine');
    expect(checkout?.states).toEqual(['Idle', 'Paying', 'Paid', 'Failed']);
  });

  it('reads transitions from the `(to) => to.full.X()` builder', () => {
    const checkout = machineNamed('CheckoutMachine');
    expect(checkout?.transitions.filter((t) => t.trigger === undefined)).toEqual([
      { from: 'Idle', event: 'Pay', to: 'Paying' },
      { from: 'Paying', event: 'Cancel', to: 'Failed' },
    ]);
  });

  it('reads the event alphabet from a Machine.events descriptor', () => {
    const checkout = machineNamed('CheckoutMachine');
    expect(checkout?.declaredEvents).toEqual(['Pay', 'Cancel']);
    expect(checkout?.alphabetSource).toBe('config');
  });

  it('reads a final state declared without a schema', () => {
    const checkout = machineNamed('CheckoutMachine');
    expect(checkout?.finalStates).toEqual(['Paid']);
  });

  it('flattens a nested Machine.states tree into dotted paths', () => {
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
  });

  it('reads the initial state from the `(to) => to.<state>` builder', () => {
    expect(machineNamed('CheckoutMachine')?.initial).toBe('Idle');
    // Not the first declared state, so a "first wins" fallback cannot pass.
    expect(machineNamed('OrderMachine')?.initial).toBe('Cart');
    // A parallel root resolves to the root itself, not the `.initial` verb.
    expect(machineNamed('EditorMachine')?.initial).toBe('workspace');
  });

  it('resolves `to.local.X()` against the enclosing compound region', () => {
    const editor = machineNamed('EditorMachine');
    expect(editor?.transitions.filter((t) => t.event !== '')).toEqual([
      {
        from: 'workspace.document.Clean',
        event: 'Edit',
        to: 'workspace.document.Dirty',
      },
      {
        from: 'workspace.document.Dirty',
        event: 'Save',
        to: 'workspace.document.Clean',
      },
      {
        from: 'workspace.connection.Online',
        event: 'Disconnect',
        to: 'workspace.connection.Offline',
      },
      {
        from: 'workspace.connection.Offline',
        event: 'Reconnect',
        to: 'workspace.connection.Online',
      },
    ]);
  });

  it('records entry and exit actions', () => {
    expect(machineNamed('EditorMachine')?.exitActions).toEqual({
      'workspace.document.Dirty': ['exit'],
    });
    expect(machineNamed('CheckoutMachine')?.entryActions).toEqual({
      Paying: ['logCharge'],
    });
  });

  it('reads state-owned work and its completion transitions', () => {
    const checkout = machineNamed('CheckoutMachine');
    expect(checkout?.invokes).toEqual({
      Paying: [{ src: 'charge-card', id: 'charge-card' }],
    });
    expect(checkout?.transitions.filter((t) => t.trigger !== undefined)).toEqual([
      {
        from: 'Paying',
        event: 'onDone',
        to: 'Paid',
        trigger: 'done',
        invokeIndex: 0,
      },
      {
        from: 'Paying',
        event: 'onError',
        to: 'Failed',
        trigger: 'error',
        invokeIndex: 0,
      },
    ]);
  });

  it('reads every implementation of a stored definition', () => {
    const { machines } = analyzeStateMachines(fixture);
    expect(machines.map((m) => m.name).sort()).toEqual([
      'CheckoutMachine',
      'EditorMachine',
      'OrderMachine',
      'ProductionToggle',
      'ReviewMachine',
      'TestingToggle',
    ]);
    expect(machineNamed('ProductionToggle')?.transitions).toEqual([
      { from: 'Off', event: 'Flip', to: 'On' },
      { from: 'On', event: 'Flip', to: 'Off' },
    ]);
    expect(machineNamed('TestingToggle')?.transitions).toEqual([
      { from: 'Off', event: 'Flip', to: 'On' },
      { from: 'On', event: 'Reset', to: 'Off' },
    ]);
  });

  it('labels branch targets with their branch name', () => {
    expect(machineNamed('ReviewMachine')?.transitions).toEqual([
      { from: 'Pending', event: 'Evaluate', to: 'Accepted', guard: 'accepted' },
      { from: 'Pending', event: 'Evaluate', to: 'Rejected', guard: 'rejected' },
    ]);
  });
});
