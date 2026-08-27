import { describe, expect, it } from 'vitest';
import { summarizeAlphabet } from './state-machine';
import type { StateMachine } from './state-machine';

const machine = (over: Partial<StateMachine>): StateMachine =>
  ({
    name: 'M',
    source: 'effect-machine',
    initial: 'A',
    states: ['A', 'B'],
    transitions: [],
    location: { filePath: 'f.ts', line: 1, column: 1, offset: 0 },
    ...over,
  }) as StateMachine;

describe('summarizeAlphabet', () => {
  it('counts the declared alphabet, not automatic triggers', () => {
    const m = machine({
      declaredEvents: ['Go', 'Stop'],
      transitions: [
        { from: 'A', event: 'Go', to: 'B' },
        { from: 'B', event: 'onDone', to: 'A', trigger: 'done' },
        { from: 'A', event: '', to: 'B', trigger: 'initial' },
      ],
    });
    expect(summarizeAlphabet(m)).toEqual({ states: 2, events: 2 });
  });

  it('falls back to observed events when no alphabet is declared', () => {
    const m = machine({
      transitions: [
        { from: 'A', event: 'Go', to: 'B' },
        { from: 'B', event: 'onDone', to: 'A', trigger: 'done' },
      ],
    });
    expect(summarizeAlphabet(m)).toEqual({ states: 2, events: 1 });
  });
});
