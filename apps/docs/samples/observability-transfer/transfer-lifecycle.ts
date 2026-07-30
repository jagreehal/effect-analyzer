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

export class Validating extends Schema.TaggedClass<Validating>('Validating')('Validating', {}) {}
export class FetchingRate extends Schema.TaggedClass<FetchingRate>('FetchingRate')('FetchingRate', {}) {}
export class Converting extends Schema.TaggedClass<Converting>('Converting')('Converting', {
  sufficientFunds: Schema.Boolean,
}) {}
export class Executing extends Schema.TaggedClass<Executing>('Executing')('Executing', {}) {}
export class Confirming extends Schema.TaggedClass<Confirming>('Confirming')('Confirming', {
  retryable: Schema.Boolean,
}) {}
export class Done extends Schema.TaggedClass<Done>('Done')('Done', {}) {}
export class Failed extends Schema.TaggedClass<Failed>('Failed')('Failed', {}) {}

export class Advance extends Schema.TaggedClass<Advance>('Advance')('Advance', {}) {}
export class Fail extends Schema.TaggedClass<Fail>('Fail')('Fail', {}) {}
export class Executed extends Schema.TaggedClass<Executed>('Executed')('Executed', {}) {}

/** The provider call. Its source is a label to the analyzer; Effect runs it. */
export const ExecuteTransfer = Machine.invoke({
  id: 'executeTransfer',
  src: () => Machine.effect(Effect.succeed(new Executed())),
})

export const TransferStates = Machine.defineStates({
  Validating,
  FetchingRate,
  Converting,
  Executing,
  Confirming,
  Done: { schema: Done, type: 'final' },
  Failed: { schema: Failed, type: 'final' },
})

export const TransferLifecycle = Machine.make({
  states: TransferStates.states,
  events: [Advance, Fail, Executed],
  initial: () => TransferStates.initial.Validating(new Validating()),
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
      // Balance check lives in convertCurrency; the branch is the guard label.
      Advance: ({ state, target }) =>
        state.sufficientFunds
          ? target.full.Executing(new Executing())
          : target.full.Failed(new Failed()),
      Fail: ({ target }) => target.full.Failed(new Failed()),
    },
  },
  Executing: {
    invoke: () => ExecuteTransfer,
    on: {
      Executed: ({ target }) =>
        target.full.Confirming(new Confirming({ retryable: true })),
      // Provider can still fail after invoke starts; keep an explicit Fail edge.
      Fail: ({ target }) => target.full.Failed(new Failed()),
    },
  },
  Confirming: {
    on: {
      Advance: ({ target }) => target.full.Done(new Done()),
      // Confirmation is best-effort in the Effect program; retry vs give up.
      Fail: ({ state, target }) =>
        state.retryable
          ? target.full.Confirming(new Confirming({ retryable: false }))
          : target.full.Done(new Done()),
    },
  },
})
