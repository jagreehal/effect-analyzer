// PR #5 — after: retry removed during "cleanup" refactor
import { Effect } from 'effect';

type TransferId = { id: string };
type TransferRejectedError = { _tag: 'TransferRejectedError' };
type ConfirmationFailedError = { _tag: 'ConfirmationFailedError' };

type Deps = {
  readonly executeTransfer: () => Effect.Effect<
    TransferId,
    TransferRejectedError
  >;
  readonly sendConfirmation: (
    id: string,
  ) => Effect.Effect<void, ConfirmationFailedError>;
};

export const completeTransfer = (deps: Deps) => () =>
  Effect.gen(function* () {
    const transfer = yield* deps.executeTransfer();
    yield* deps.sendConfirmation(transfer.id);
    return transfer;
  });
