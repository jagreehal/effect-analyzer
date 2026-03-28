import { Context, Effect, Schedule } from 'effect';

export class ValidationError {
  readonly _tag = 'ValidationError';
  constructor(readonly message: string) {}
}

export class RateUnavailableError {
  readonly _tag = 'RateUnavailableError';
}

export class InsufficientFundsError {
  readonly _tag = 'InsufficientFundsError';
  constructor(
    readonly available: number,
    readonly requested: number,
  ) {}
}

export class TransferRejectedError {
  readonly _tag = 'TransferRejectedError';
  constructor(readonly reason: string) {}
}

export class ConfirmationFailedError {
  readonly _tag = 'ConfirmationFailedError';
}

export interface TransferRequest {
  readonly senderId: string;
  readonly recipientIban: string;
  readonly amount: number;
  readonly fromCurrency: 'GBP' | 'EUR' | 'USD';
  readonly toCurrency: 'GBP' | 'EUR' | 'USD';
}

export class TransferValidation extends Context.Tag('TransferValidation')<
  TransferValidation,
  {
    readonly validate: (
      input: TransferRequest,
    ) => Effect.Effect<TransferRequest, ValidationError>;
  }
>() {}

export class ExchangeRates extends Context.Tag('ExchangeRates')<
  ExchangeRates,
  {
    readonly getRate: (
      from: TransferRequest['fromCurrency'],
      to: TransferRequest['toCurrency'],
    ) => Effect.Effect<number, RateUnavailableError>;
  }
>() {}

export class Accounts extends Context.Tag('Accounts')<
  Accounts,
  {
    readonly getBalance: (senderId: string) => Effect.Effect<number>;
  }
>() {}

export class Transfers extends Context.Tag('Transfers')<
  Transfers,
  {
    readonly execute: (args: {
      readonly recipientIban: string;
      readonly amount: number;
      readonly currency: TransferRequest['toCurrency'];
    }) => Effect.Effect<{ readonly transferId: string }, TransferRejectedError>;
  }
>() {}

export class Notifications extends Context.Tag('Notifications')<
  Notifications,
  {
    readonly sendConfirmation: (args: {
      readonly transferId: string;
      readonly amount: number;
      readonly currency: TransferRequest['toCurrency'];
    }) => Effect.Effect<void, ConfirmationFailedError>;
  }
>() {}

export const sendMoney = (input: TransferRequest) =>
  Effect.gen(function* () {
    const validation = yield* TransferValidation;
    const rates = yield* ExchangeRates;
    const accounts = yield* Accounts;
    const transfers = yield* Transfers;
    const notifications = yield* Notifications;

    const validated = yield* validation.validate(input);
    const rate = yield* rates.getRate(validated.fromCurrency, validated.toCurrency);
    const balance = yield* accounts.getBalance(validated.senderId);

    if (balance < validated.amount) {
      return yield* Effect.fail(
        new InsufficientFundsError(balance, validated.amount),
      );
    }

    const convertedAmount = Math.round(validated.amount * rate * 100) / 100;

    const transfer = yield* transfers.execute({
      recipientIban: validated.recipientIban,
      amount: convertedAmount,
      currency: validated.toCurrency,
    }).pipe(
      Effect.retry(
        Schedule.exponential('200 millis').pipe(
          Schedule.intersect(Schedule.recurs(2)),
        ),
      ),
    );

    yield* notifications.sendConfirmation({
      transferId: transfer.transferId,
      amount: convertedAmount,
      currency: validated.toCurrency,
    });

    return {
      transferId: transfer.transferId,
      convertedAmount,
      rate,
    };
  });
