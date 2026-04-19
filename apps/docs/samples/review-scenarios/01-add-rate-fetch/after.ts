// PR #1 — after: now fetches exchange rate
import { Effect } from 'effect';

type TransferInput = { amount: number; from: string; to: string };
type ValidatedTransfer = TransferInput & { validatedAt: Date };
type ValidationError = { _tag: 'ValidationError'; reason: string };
type ExchangeRate = { rate: number };
type RateUnavailableError = { _tag: 'RateUnavailableError' };

type Deps = {
  readonly validateTransfer: (
    input: TransferInput,
  ) => Effect.Effect<ValidatedTransfer, ValidationError>;
  readonly fetchRate: (args: {
    from: string;
    to: string;
  }) => Effect.Effect<ExchangeRate, RateUnavailableError>;
};

export const createSendMoneyWorkflow =
  (deps: Deps) => (input: TransferInput) =>
    Effect.gen(function* () {
      const validated = yield* deps.validateTransfer(input);
      const rate = yield* deps.fetchRate({
        from: validated.from,
        to: validated.to,
      });
      return { validated, rate };
    });
