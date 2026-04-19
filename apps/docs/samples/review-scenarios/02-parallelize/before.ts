// PR #2 — before: sequential rate + balance lookup
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
    const rate = yield* deps.fetchRate({ from, to });
    const balance = yield* deps.getBalance();
    return { rate, balance };
  });
