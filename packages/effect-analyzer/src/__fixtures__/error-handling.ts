/**
 * Effect program with error handling patterns for testing static analysis
 */

import { Effect, Schedule } from 'effect';

// Error handling with catchAll
export const catchAllProgram = Effect.gen(function* () {
  yield* Effect.log('Starting');
  return yield* Effect.fail('error');
}).pipe(Effect.catchAll((error) => Effect.succeed(`Recovered from: ${error}`)));

// Error handling with catchTag
export const catchTagProgram = Effect.gen(function* () {
  return yield* Effect.fail({ _tag: 'NotFound' as const });
}).pipe(Effect.catchTag('NotFound', () => Effect.succeed(null)));

// Retry with schedule
export const retryProgram = Effect.gen(function* () {
  yield* Effect.log('Attempting...');
  return yield* Effect.succeed('success');
}).pipe(Effect.retry(Schedule.recurs(3)));

// Timeout
export const timeoutProgram = Effect.gen(function* () {
  return yield* Effect.sleep('1 seconds');
}).pipe(Effect.timeout('5 seconds'));

// OrElse fallback
export const orElseProgram = Effect.fail('first').pipe(
  Effect.orElse(() => Effect.succeed('fallback')),
);

// OrDie (fail on error)
export const orDieProgram = Effect.succeed(42).pipe(Effect.orDie);

export const main = catchAllProgram;
