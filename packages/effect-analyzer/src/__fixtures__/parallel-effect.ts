/**
 * Parallel Effect program for testing static analysis
 */

import { Effect } from 'effect';

// Parallel effects using Effect.all and Effect.allPar
export const parallelProgram = Effect.gen(function* () {
  // Sequential collection
  const results = yield* Effect.all([
    Effect.succeed(1),
    Effect.succeed(2),
    Effect.succeed(3),
  ]);

  // Parallel collection
  const parResults = yield* Effect.all([
    Effect.sync(() => 'a'),
    Effect.sync(() => 'b'),
  ], { concurrency: 'unbounded' });

  return { results, parResults };
});

// Race effects
export const raceProgram = Effect.race(
  Effect.succeed('first'),
  Effect.succeed('second'),
);

// ForEach loop
export const forEachProgram = Effect.gen(function* () {
  const items = [1, 2, 3];

  const results = yield* Effect.forEach(items, (item) =>
    Effect.succeed(item * 2),
  );

  return results;
});

export const main = parallelProgram;
