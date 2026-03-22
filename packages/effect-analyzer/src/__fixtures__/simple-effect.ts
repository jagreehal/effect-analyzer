/**
 * Sample Effect program for testing static analysis
 */

import { Effect } from 'effect';

// Simple effect using Effect.gen
export const simpleProgram = Effect.gen(function* () {
  yield* Effect.log('Starting program');
  const value = yield* Effect.succeed(42);
  yield* Effect.log(`Value: ${value}`);
  return value;
});

// Effect with error handling
export const programWithErrorHandling = Effect.gen(function* () {
  const result = yield* Effect.tryPromise({
    try: () => Promise.resolve(100),
    catch: () => new Error('Failed'),
  });

  return result;
}).pipe(Effect.catchAll((_error) => Effect.succeed(0)));

// Exported for analysis
export const main = simpleProgram;
