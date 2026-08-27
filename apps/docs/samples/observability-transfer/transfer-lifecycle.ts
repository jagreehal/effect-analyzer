/**
 * Explicit lifecycle state machine for the send-money workflow.
 *
 * Mirrors the Effect pipeline in `send-money-workflow.ts` as an
 * `@typeonce/effect-machine` machine so effect-analyze can diagram it and gate
 * completeness in CI.
 *
 * Events are intentionally dense (`Advance` / `Fail` at every active stage) so
 * structural coverage is meaningful — not a sparse (state × event) matrix that
 * would score low while still being a valid linear workflow.
 */

import { Machine } from '@typeonce/effect-machine'
import { Effect, Schema } from 'effect'

/** Data owned by the stages that carry a decision into their next transition. */
export const TransferState = Schema.TaggedUnion({
  Converting: { sufficientFunds: Schema.Boolean },
  Confirming: { retryable: Schema.Boolean },
})

export const TransferStates = Machine.states({
  Validating: {},
  FetchingRate: {},
  Converting: TransferState.cases.Converting,
  Executing: {},
  Confirming: TransferState.cases.Confirming,
  Done: { type: 'final' },
  Failed: { type: 'final' },
})

export const TransferEvents = Machine.events(
  Schema.TaggedUnion({
    Advance: {},
    Fail: {},
  }),
)

/** The provider call. Its id is a label to the analyzer; Effect runs it. */
export const executeTransfer: Effect.Effect<void, Error> = Effect.void

export const TransferLifecycle = Machine.make({
  states: TransferStates.states,
  events: TransferEvents,
  initial: (to) => to.Validating(),
}).handle({
  Validating: {
    on: {
      Advance: (to) => to.full.FetchingRate(),
      Fail: (to) => to.full.Failed(),
    },
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
      // Balance check lives in convertCurrency; the branch names are the guards.
      Advance: (to) =>
        to
          .branches({
            sufficientFunds: { target: to.full.Executing() },
            insufficientFunds: { target: to.full.Failed() },
          })
          .resolve(({ state, select }) =>
            state.sufficientFunds
              ? select.sufficientFunds.from()
              : select.insufficientFunds.from(),
          ),
      Fail: (to) => to.full.Failed(),
    },
  },
  Executing: {
    // The provider call is owned by the state: entering starts it, leaving
    // interrupts it, and its outcome is a transition rather than an event.
    invoke: (from) =>
      from
        .effect('executeTransfer', () => executeTransfer)
        .onDone((to) =>
          to.full.Confirming().resolve(({ target }) => target.from({ retryable: true })),
        )
        .onFailure((to) => to.full.Failed()),
    on: {
      // Provider can still fail after invoke starts; keep an explicit Fail edge.
      Fail: (to) => to.full.Failed(),
    },
  },
  Confirming: {
    on: {
      Advance: (to) => to.full.Done(),
      // Confirmation is best-effort in the Effect program; retry vs give up.
      Fail: (to) =>
        to
          .branches({
            retry: { target: to.full.Confirming() },
            giveUp: { target: to.full.Done() },
          })
          .resolve(({ state, select }) =>
            state.retryable
              ? select.retry.from({ retryable: false })
              : select.giveUp.from(),
          ),
    },
  },
  Done: {},
  Failed: {},
})
