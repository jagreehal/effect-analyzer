/**
 * Seed B — declared state Cancelled is never targeted.
 * Expected: unreachable-state warning → non-zero exit.
 */
type TransferState =
  | { readonly _tag: 'Validating' }
  | { readonly _tag: 'FetchingRate' }
  | { readonly _tag: 'Converting' }
  | { readonly _tag: 'Executing' }
  | { readonly _tag: 'Confirming' }
  | { readonly _tag: 'Done' }
  | { readonly _tag: 'Failed' }
  | { readonly _tag: 'Cancelled' }

type TransferEvent =
  | { readonly _tag: 'Advance' }
  | { readonly _tag: 'Fail' }

type Target =
  | TransferState['_tag']
  | { readonly target: TransferState['_tag']; readonly guard?: string }
  | readonly { readonly target: TransferState['_tag']; readonly guard?: string }[]

/** @initial Validating */
export const transferLifecycleUnreachable = {
  Validating: {
    Advance: 'FetchingRate',
    Fail: 'Failed',
  },
  FetchingRate: {
    Advance: 'Converting',
    Fail: 'Failed',
  },
  Converting: {
    Advance: { target: 'Executing', guard: 'sufficientFunds' },
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
  // Declared in the alphabet via satisfies, but nothing transitions here.
  Cancelled: { type: 'final' },
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
