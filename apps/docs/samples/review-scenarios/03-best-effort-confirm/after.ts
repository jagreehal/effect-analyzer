// PR #3 — after: confirmation is best-effort
import { Effect } from 'effect';

type TransferId = { id: string };
type ConfirmationReceipt = { receiptId: string };
type TransferRejectedError = { _tag: 'TransferRejectedError' };
type ConfirmationFailedError = { _tag: 'ConfirmationFailedError' };

type Deps = {
  readonly executeTransfer: () => Effect.Effect<
    TransferId,
    TransferRejectedError
  >;
  readonly sendConfirmation: (
    id: string,
  ) => Effect.Effect<ConfirmationReceipt, ConfirmationFailedError>;
};

export const completeTransfer = (deps: Deps) => () =>
  Effect.gen(function* () {
    const transfer = yield* deps.executeTransfer();
    const receipt = yield* Effect.orElseSucceed(
      deps.sendConfirmation(transfer.id),
      () => null as ConfirmationReceipt | null,
    );
    return { transfer, receipt };
  });
