/**
 * Effect program with resource management for testing static analysis
 */

import { Effect } from 'effect';

// Resource with acquireRelease
export const resourceProgram = Effect.acquireRelease(
  Effect.sync(() => {
    console.log('Acquiring resource');
    return { id: 1 };
  }),
  (resource) =>
    Effect.sync(() => {
      console.log(`Releasing resource ${resource.id}`);
    }),
).pipe(
  Effect.flatMap((resource) =>
    Effect.gen(function* () {
      yield* Effect.log(`Using resource ${resource.id}`);
      return resource;
    }),
  ),
);

// Ensuring (cleanup)
export const ensuringProgram = Effect.gen(function* () {
  yield* Effect.log('Starting work');
  return yield* Effect.succeed('done');
}).pipe(Effect.ensuring(Effect.sync(() => { console.log('Cleaning up'); })));

/** Effect.sync with an inner Effect call — for callbackBody analysis */
export const syncWithInnerEffect = Effect.sync(() => Effect.succeed(1));

export const main = resourceProgram;
