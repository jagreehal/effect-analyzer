/**
 * Explicit lifecycle state machine for the send-money workflow.
 *
 * Mirrors the Effect pipeline in `send-money-workflow.ts` as a deterministic
 * transition table so effect-analyze can diagram it and gate completeness in CI.
 *
 * Events are intentionally dense (`Advance` / `Fail` at every active stage) so
 * structural coverage is meaningful — not a sparse (state × event) matrix that
 * would score low while still being a valid linear workflow.
 */

type TransferState =
  | { readonly _tag: 'Validating' }
  | { readonly _tag: 'FetchingRate' }
  | { readonly _tag: 'Converting' }
  | { readonly _tag: 'Executing' }
  | { readonly _tag: 'Confirming' }
  | { readonly _tag: 'Done' }
  | { readonly _tag: 'Failed' }

type TransferEvent =
  | { readonly _tag: 'Advance' }
  | { readonly _tag: 'Fail' }

type Target =
  | TransferState['_tag']
  | { readonly target: TransferState['_tag']; readonly guard?: string }
  | readonly { readonly target: TransferState['_tag']; readonly guard?: string }[]

/** @initial Validating */
export const transferLifecycle = {
  Validating: {
    Advance: 'FetchingRate',
    Fail: 'Failed',
  },
  FetchingRate: {
    Advance: 'Converting',
    Fail: 'Failed',
  },
  Converting: {
    // Balance check lives in convertCurrency; this guard is a label only.
    Advance: { target: 'Executing', guard: 'sufficientFunds' },
    Fail: 'Failed',
  },
  Executing: {
    invoke: {
      src: 'executeTransfer',
      onDone: 'Confirming',
      onError: 'Failed',
    },
    // Provider can still fail after invoke starts; keep an explicit Fail edge.
    Fail: 'Failed',
  },
  Confirming: {
    Advance: 'Done',
    // Confirmation is best-effort in the Effect program; model retry vs give up.
    Fail: [{ target: 'Confirming', guard: 'retryable' }, { target: 'Done' }],
  },
  Done: { type: 'final' },
  Failed: { type: 'final' },
} as const satisfies Record<
  TransferState['_tag'],
  Partial<Record<TransferEvent['_tag'], Target>> & {
    readonly type?: 'final'
    readonly invoke?: {
      readonly src: string
      readonly onDone?: Target
      readonly onError?: Target
    }
  }
>
