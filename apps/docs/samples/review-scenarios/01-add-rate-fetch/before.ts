// PR #1 — before: validation only
import { Effect } from 'effect';

type TransferInput = { amount: number; from: string; to: string };
type ValidatedTransfer = TransferInput & { validatedAt: Date };
type ValidationError = { _tag: 'ValidationError'; reason: string };

type Deps = {
  readonly validateTransfer: (
    input: TransferInput,
  ) => Effect.Effect<ValidatedTransfer, ValidationError>;
};

export const createSendMoneyWorkflow =
  (deps: Deps) => (input: TransferInput) =>
    Effect.gen(function* () {
      const validated = yield* deps.validateTransfer(input);
      return { validated };
    });
