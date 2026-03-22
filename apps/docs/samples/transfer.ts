import { Effect, Context } from "effect"

class AccountRepo extends Context.Tag("AccountRepo")<
  AccountRepo,
  {
    readonly getBalance: (id: string) => Effect.Effect<number, AccountNotFoundError>
    readonly debit: (id: string, amount: number) => Effect.Effect<void, InsufficientFundsError>
    readonly credit: (id: string, amount: number) => Effect.Effect<void, AccountNotFoundError>
  }
>() {}

class AuditLog extends Context.Tag("AuditLog")<
  AuditLog,
  { readonly record: (event: string) => Effect.Effect<void> }
>() {}

class AccountNotFoundError {
  readonly _tag = "AccountNotFoundError"
  constructor(readonly accountId: string) {}
}

class InsufficientFundsError {
  readonly _tag = "InsufficientFundsError"
  constructor(readonly available: number, readonly required: number) {}
}

export const transfer = Effect.gen(function* () {
  const repo = yield* AccountRepo
  const audit = yield* AuditLog

  const balance = yield* repo.getBalance("from-account")

  if (balance < 100) {
    yield* Effect.fail(new InsufficientFundsError(balance, 100))
  }

  yield* repo.debit("from-account", 100)
  yield* repo.credit("to-account", 100)
  yield* audit.record("transfer-complete")

  return { success: true, amount: 100 }
})
