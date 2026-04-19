// PR #2 — after: parallelized for speed
import { Effect } from 'effect';

type Currency = 'USD' | 'EUR' | 'GBP';
type ExchangeRate = { rate: number };
type RateUnavailableError = { _tag: 'RateUnavailableError' };

type Deps = {
  readonly fetchRate: (args: {
    from: Currency;
    to: Currency;
  }) => Effect.Effect<ExchangeRate, RateUnavailableError>;
  readonly getBalance: () => Effect.Effect<number, never>;
};

export const prepareTransfer = (deps: Deps) => (from: Currency, to: Currency) =>
  Effect.gen(function* () {
    const [rate, balance] = yield* Effect.all(
      [deps.fetchRate({ from, to }), deps.getBalance()],
      { concurrency: 'unbounded' },
    );
    return { rate, balance };
  });
