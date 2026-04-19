// PR #5 — before: confirmation call retried on transient failure
import { Effect, Schedule } from 'effect';

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
  }).pipe(Effect.retry(Schedule.exponential('200 millis').pipe(Schedule.compose(Schedule.recurs(3)))));
