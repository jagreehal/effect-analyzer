import { Context, Effect } from 'effect';

export class AccountNotFoundError {
  readonly _tag = 'AccountNotFoundError';
  constructor(readonly accountId: string) {}
}

export class InsufficientFundsError {
  readonly _tag = 'InsufficientFundsError';
  constructor(
    readonly available: number,
    readonly requested: number,
  ) {}
}

export class AccountService extends Context.Tag('AccountService')<
  AccountService,
  {
    readonly getBalance: (
      accountId: string,
    ) => Effect.Effect<number, AccountNotFoundError>;
    readonly debit: (
      accountId: string,
      amount: number,
    ) => Effect.Effect<void, AccountNotFoundError>;
    readonly credit: (
      accountId: string,
      amount: number,
    ) => Effect.Effect<void, AccountNotFoundError>;
  }
>() {}

export class AuditLog extends Context.Tag('AuditLog')<
  AuditLog,
  {
    readonly record: (message: string) => Effect.Effect<void>;
  }
>() {}

export const transferWorkflow = (
  fromAccountId: string,
  toAccountId: string,
  amount: number,
) =>
  Effect.gen(function* () {
    const accounts = yield* AccountService;
    const audit = yield* AuditLog;

    const balance = yield* accounts.getBalance(fromAccountId);

    if (balance < amount) {
      return yield* Effect.fail(
        new InsufficientFundsError(balance, amount),
      );
    }

    yield* accounts.debit(fromAccountId, amount);
    yield* accounts.credit(toAccountId, amount);
    yield* audit.record(
      `Transferred ${amount} from ${fromAccountId} to ${toAccountId}`,
    );

    return {
      fromAccountId,
      toAccountId,
      amount,
    };
  });
