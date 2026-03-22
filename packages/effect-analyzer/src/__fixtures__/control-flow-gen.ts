/**
 * Test fixture: Control flow patterns inside Effect.gen generators.
 *
 * Each export exercises a specific control flow construct that the
 * statement-level walker should emit structured IR for.
 */

import { Effect } from 'effect';

// 1. Basic if/else with yields
export const ifElseProgram = Effect.gen(function* () {
  const user = yield* Effect.succeed({ isPremium: true });
  if (user.isPremium) {
    yield* Effect.succeed('premium');
  } else {
    yield* Effect.succeed('free');
  }
});

// 2. Switch with yields
export const switchProgram = Effect.gen(function* () {
  const tier = yield* Effect.succeed('gold');
  switch (tier) {
    case 'gold':
      yield* Effect.succeed('gold-path');
      break;
    case 'silver':
      yield* Effect.succeed('silver-path');
      break;
    default:
      yield* Effect.succeed('default-path');
  }
});

// 3. For-of loop with yields
export const forOfProgram = Effect.gen(function* () {
  const items = ['a', 'b', 'c'];
  for (const item of items) {
    yield* Effect.succeed(item);
  }
});

// 4. While loop with yields
export const whileProgram = Effect.gen(function* () {
  let i = 0;
  while (i < 3) {
    yield* Effect.succeed(i);
    i++;
  }
});

// 5. Try/catch/finally with yields
export const tryCatchProgram = Effect.gen(function* () {
  try {
    yield* Effect.succeed('try-body');
  } catch (e) {
    yield* Effect.succeed('catch-body');
  } finally {
    yield* Effect.succeed('finally-body');
  }
});

// 6. Return with yield
export const returnYieldProgram = Effect.gen(function* () {
  const x = yield* Effect.succeed(1);
  if (x > 0) {
    return yield* Effect.succeed('early-return');
  }
  yield* Effect.succeed('normal-path');
});

// 7. Nested control flow
export const nestedProgram = Effect.gen(function* () {
  const user = yield* Effect.succeed({ isPremium: true, tier: 'gold' as string });
  if (user.isPremium) {
    switch (user.tier) {
      case 'gold':
        yield* Effect.succeed('premium-gold');
        break;
      case 'silver':
        yield* Effect.succeed('premium-silver');
        break;
    }
  } else {
    yield* Effect.succeed('free');
  }
});

// 8. Ternary with yields
export const ternaryProgram = Effect.gen(function* () {
  const isPremium = true;
  const result = isPremium ? (yield* Effect.succeed('premium')) : (yield* Effect.succeed('free'));
  return result;
});

// 9. Short-circuit with yields
export const shortCircuitProgram = Effect.gen(function* () {
  const x = true;
  const y = x && (yield* Effect.succeed('value'));
  return y;
});

// 10. Nested function boundary (should NOT be treated as generator's yield)
export const nestedFunctionProgram = Effect.gen(function* () {
  yield* Effect.succeed('outer');
  const fn = () => Effect.gen(function* () {
    yield* Effect.succeed('inner-should-not-be-in-outer');
  });
  yield* Effect.succeed('after-fn');
});

// 11. Switch with fallthrough
export const fallthroughProgram = Effect.gen(function* () {
  const x = yield* Effect.succeed(1);
  switch (x) {
    case 1:
    case 2:
      yield* Effect.succeed('case-1-or-2');
      break;
    case 3:
      yield* Effect.succeed('case-3');
      break;
  }
});

// 12. Try/finally with return (finally must intercept)
export const tryFinallyReturnProgram = Effect.gen(function* () {
  try {
    return yield* Effect.succeed('try-return');
  } finally {
    yield* Effect.succeed('cleanup');
  }
});

// 13. Do-while loop
export const doWhileProgram = Effect.gen(function* () {
  let count = 0;
  do {
    yield* Effect.succeed(count);
    count++;
  } while (count < 3);
});
