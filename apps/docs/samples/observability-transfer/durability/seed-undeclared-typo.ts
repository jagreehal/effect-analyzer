/**
 * Seed C — typo target not in the declared alphabet.
 * Expected: undeclared-state warning → non-zero exit.
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
  | string
  | { readonly target: string; readonly guard?: string }
  | readonly { readonly target: string; readonly guard?: string }[]

/** @initial Validating */
export const transferLifecycleTypo = {
  Validating: {
    Advance: 'FetchingRate',
    Fail: 'Failed',
  },
  FetchingRate: {
    Advance: 'Converting',
    Fail: 'Failed',
  },
  Converting: {
    // Typo: not in TransferState alphabet
    Advance: { target: 'Executng', guard: 'sufficientFunds' },
    Fail: 'Failed',
  },
  Executing: {
    invoke: {
      src: 'executeTransfer',
      onDone: 'Confirming',
      onError: 'Failed',
    },
    Fail: 'Failed',
  },
  Confirming: {
    Advance: 'Done',
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
