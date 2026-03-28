import { Context, Effect } from 'effect';

export class Accounts extends Context.Tag('Accounts')<
  Accounts,
  {
    readonly debit: (accountId: string, amount: number) => Effect.Effect<void>;
    readonly credit: (accountId: string, amount: number) => Effect.Effect<void>;
  }
>() {}

export const sendMoneyAudit = Effect.gen(function* () {
  const accounts = yield* Accounts;
  yield* accounts.debit('acct_source', 125);
  yield* accounts.credit('acct_dest', 125);
  return { ok: true as const };
});
