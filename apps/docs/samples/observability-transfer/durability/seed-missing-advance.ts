/**
 * Seed A — remove the Validating.Advance edge.
 * Expected: everything past Validating becomes unreachable, coverage drops.
 */

import { Machine } from '@typeonce/effect-machine'
import { Schema } from 'effect'
import { TransferState, executeTransfer } from '../transfer-lifecycle'

const States = Machine.states({
  Validating: {},
  FetchingRate: {},
  Converting: TransferState.cases.Converting,
  Executing: {},
  Confirming: TransferState.cases.Confirming,
  Done: { type: 'final' },
  Failed: { type: 'final' },
})

// Declared here rather than imported: the analyzer reads one file at a time, so
// a seed's alphabet has to be visible in the seed.
const Events = Machine.events(Schema.TaggedUnion({ Advance: {}, Fail: {} }))

export const transferLifecycleMissingAdvance = Machine.make({
  states: States.states,
  events: Events,
  initial: (to) => to.Validating(),
}).handle({
  // Advance removed — Validating can only Fail.
  Validating: {
    on: { Fail: (to) => to.full.Failed() },
  },
  FetchingRate: {
    on: {
      Advance: (to) =>
        to.full.Converting().resolve(({ target }) => target.from({ sufficientFunds: true })),
      Fail: (to) => to.full.Failed(),
    },
  },
  Converting: {
    on: {
      Advance: (to) => to.full.Executing(),
      Fail: (to) => to.full.Failed(),
    },
  },
  Executing: {
    invoke: (from) =>
      from
        .effect('executeTransfer', () => executeTransfer)
        .onDone((to) =>
          to.full.Confirming().resolve(({ target }) => target.from({ retryable: true })),
        )
        .onFailure((to) => to.full.Failed()),
    on: {
      Fail: (to) => to.full.Failed(),
    },
  },
  Confirming: {
    on: {
      Advance: (to) => to.full.Done(),
      Fail: (to) => to.full.Done(),
    },
  },
  Done: {},
  Failed: {},
})
