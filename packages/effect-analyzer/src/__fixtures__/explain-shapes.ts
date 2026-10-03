/**
 * Fixture: a workflow that yields a sub-program needing another service, a
 * plain-value early return, and promise calls lifted with tryPromise.
 */
import { Context, Data, Effect } from 'effect';

class StoreError extends Data.TaggedError('StoreError')<{}> {}

class Store extends Context.Service<
  Store,
  { readonly find: (key: string) => Effect.Effect<{ id: string } | undefined, StoreError> }
>()('Store') {}

class Gateway extends Context.Service<Gateway, { readonly charge: () => Effect.Effect<string> }>()(
  'Gateway',
) {}

type Wallet = {
  getBalance(id: string): Promise<number>;
  debit(id: string): Promise<void>;
  audit(id: string): void;
};

const charge = Effect.fn('charge')(function* () {
  const gateway = yield* Gateway;
  return yield* gateway.charge();
});

export const pay = Effect.fn('pay')(function* (key: string) {
  const store = yield* Store;
  const existing = yield* store.find(key);
  if (existing) {
    return { paymentId: existing.id };
  }
  const id = yield* charge();
  return { paymentId: id };
});

export const transfer = Effect.fn('transfer')(function* (wallet: Wallet, from: string) {
  const balance = yield* Effect.tryPromise({
    try: () => wallet.getBalance(from),
    catch: () => new StoreError(),
  });
  yield* Effect.tryPromise(() => wallet.debit(from));
  yield* Effect.sync(() => {
    wallet.audit(from);
  });
  return balance;
});
