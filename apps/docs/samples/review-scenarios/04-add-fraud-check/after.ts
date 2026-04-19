// PR #4 — after: adds a fraud check before execution
import { Context, Effect } from 'effect';

type TransferId = { id: string };
type TransferRejectedError = { _tag: 'TransferRejectedError' };
type FraudDeniedError = { _tag: 'FraudDeniedError' };

export class Payments extends Context.Tag('Payments')<
  Payments,
  {
    readonly execute: (
      amount: number,
    ) => Effect.Effect<TransferId, TransferRejectedError>;
  }
>() {}

export class FraudCheck extends Context.Tag('FraudCheck')<
  FraudCheck,
  {
    readonly verify: (amount: number) => Effect.Effect<void, FraudDeniedError>;
  }
>() {}

export const initiateTransfer = (amount: number) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const fraud = yield* FraudCheck;
    yield* fraud.verify(amount);
    const transfer = yield* payments.execute(amount);
    return transfer;
  });
