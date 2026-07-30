/**
 * Seed C — typo target not in the declared alphabet.
 * Expected: undeclared-state warning → non-zero exit.
 *
 * `Confirmng` is not a state, so this file does not typecheck — that is the
 * point of the seed: the analyzer must catch it structurally too.
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

export const transferLifecycleTypo = Machine.make({
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
      // Typo: `Confirmng` is not a declared state.
      Executed: ({ target }) =>
        target.full.Confirmng(new Confirming({ retryable: true })),
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
