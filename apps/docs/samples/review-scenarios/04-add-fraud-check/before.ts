// PR #4 — before: execute transfer directly
import { Context, Effect } from 'effect';

type TransferId = { id: string };
type TransferRejectedError = { _tag: 'TransferRejectedError' };

export class Payments extends Context.Service<
  Payments,
  {
    readonly execute: (
      amount: number,
    ) => Effect.Effect<TransferId, TransferRejectedError>;
  }
>()('Payments') {}

export const initiateTransfer = (amount: number) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const transfer = yield* payments.execute(amount);
    return transfer;
  });
