/**
 * Test fixture: Early return with Effect.fail in if-block,
 * followed by success continuation.
 *
 * Bug: The success path (after the if-block) should be a sequential
 * sibling after the decision node, NOT placed inside onFalse.
 */

import { Effect } from 'effect';

class InsufficientFundsError {
  readonly _tag = 'InsufficientFundsError';
  constructor(readonly message: string) {}
}

// Pattern: if (condition) { return yield* Effect.fail(...) }
// followed by success continuation
export const earlyReturnFail = Effect.gen(function* () {
  const balance = yield* Effect.succeed(100);
  const amount = yield* Effect.succeed(50);

  if (balance < amount) {
    return yield* Effect.fail(new InsufficientFundsError('Not enough funds'));
  }

  const result = yield* Effect.succeed('converted!');
  return result;
});
