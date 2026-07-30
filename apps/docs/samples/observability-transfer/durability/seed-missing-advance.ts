/**
 * Seed A — remove the Validating.Advance edge.
 * Expected: everything past Validating becomes unreachable, coverage drops.
 */

import { Machine } from '@typeonce/effect-machine'
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

const States = Machine.defineStates({
  Validating,
  FetchingRate,
  Converting,
  Executing,
  Confirming,
  Done: { schema: Done, type: 'final' },
  Failed: { schema: Failed, type: 'final' },
})

export const transferLifecycleMissingAdvance = Machine.make({
  states: States.states,
  events: [Advance, Fail, Executed],
  initial: () => States.initial.Validating(new Validating()),
}).handle({
  // Advance removed — Validating can only Fail.
  Validating: {
    on: { Fail: ({ target }) => target.full.Failed(new Failed()) },
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
