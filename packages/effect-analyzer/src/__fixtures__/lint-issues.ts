/**
 * Test fixture with intentional lint issues for testing the Effect linter
 */

import { Effect } from 'effect';

// Issue: Untagged yield - yield result not assigned to variable
export const untaggedYieldProgram = Effect.gen(function* () {
  yield* Effect.log('This is fine'); // OK - side effect
  yield* Effect.succeed(42); // LINT: Untagged yield, result unused
  return 'done';
});

// Issue: Missing error handler - Effect.tryPromise can fail
export const missingHandlerProgram = Effect.gen(function* () {
  // LINT: This can fail but has no error handler
  const result = yield* Effect.tryPromise({
    try: () => fetch('/api/data').then(r => r.json()),
    catch: (error) => new Error(String(error)),
  });
  return result as unknown;
}); // No catchAll or catchTag after the gen

// Issue: Unused variable (dead code)
export const deadCodeProgram = Effect.gen(function* () {
  const _unused = yield* Effect.succeed(42); // LINT: Variable starts with _, may be unused
  const used = yield* Effect.succeed(100);
  return used;
});

// Complex Layer composition (simulated)
export const complexLayerProgram = Effect.gen(function* () {
  yield* Effect.log('Program with many layers');
  return 'done';
}).pipe(
  // Simulating complex layer composition
  Effect.provideService('Service1' as never, {} as never),
  Effect.provideService('Service2' as never, {} as never),
  Effect.provideService('Service3' as never, {} as never),
  Effect.provideService('Service4' as never, {} as never),
  Effect.provideService('Service5' as never, {} as never),
  Effect.provideService('Service6' as never, {} as never),
  Effect.provideService('Service7' as never, {} as never),
  Effect.provideService('Service8' as never, {} as never),
  Effect.provideService('Service9' as never, {} as never),
  Effect.provideService('Service10' as never, {} as never),
  Effect.provideService('Service11' as never, {} as never),
);

// Using catchAll when catchTag might be better
export const catchAllProgram = Effect.gen(function* () {
  return yield* Effect.fail({ _tag: 'NotFound' as const, message: 'Not found' });
}).pipe(
  // LINT: Using catchAll when error has _tag discriminator
  Effect.catchAll((error) => Effect.succeed({ recovered: true, error })),
);

// Good example - proper error handling
export const goodProgram = Effect.gen(function* () {
  yield* Effect.log('Starting');
  const result = yield* Effect.succeed(42);
  return result;
}).pipe(
  Effect.catchAll(() => Effect.succeed(0)),
);

export const main = goodProgram;
