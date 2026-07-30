/**
 * Seed B — declared state Cancelled is never targeted.
 * Expected: `unreachable-state: Cancelled`.
 */

import { Machine } from '@typeonce/effect-machine'
import { Schema } from 'effect'
import {
  Advance,
  Confirming,
  Converting,
  Done,
  ExecuteTransfer,
  Executed,
  Executing,
  Fail,
  Failed,
  FetchingRate,
  Validating,
} from '../transfer-lifecycle'

class Cancelled extends Schema.TaggedClass<Cancelled>('Cancelled')('Cancelled', {}) {}

const States = Machine.defineStates({
  Validating,
  FetchingRate,
  Converting,
  Executing,
  Confirming,
  Done: { schema: Done, type: 'final' },
  Failed: { schema: Failed, type: 'final' },
  // Declared, but nothing transitions here.
  Cancelled: { schema: Cancelled, type: 'final' },
})

export const transferLifecycleUnreachable = Machine.make({
  states: States.states,
  events: [Advance, Fail, Executed],
  initial: () => States.initial.Validating(new Validating()),
}).handle({
  Validating: {
    on: {
      Advance: ({ target }) => target.full.FetchingRate(new FetchingRate()),
      Fail: ({ target }) => target.full.Failed(new Failed()),
    },
  },
  FetchingRate: {
    on: {
      Advance: ({ target }) =>
        target.full.Converting(new Converting({ sufficientFunds: true })),
      Fail: ({ target }) => target.full.Failed(new Failed()),
    },
  },
  Converting: {
    on: {
      Advance: ({ target }) => target.full.Executing(new Executing()),
      Fail: ({ target }) => target.full.Failed(new Failed()),
    },
  },
  Executing: {
    invoke: () => ExecuteTransfer,
    on: {
      Executed: ({ target }) =>
        target.full.Confirming(new Confirming({ retryable: true })),
      Fail: ({ target }) => target.full.Failed(new Failed()),
    },
  },
  Confirming: {
    on: {
      Advance: ({ target }) => target.full.Done(new Done()),
      Fail: ({ target }) => target.full.Done(new Done()),
    },
  },
})
