/**
 * Test fixtures for the additional Effect lint rules added in the
 * EffectPatterns / effect-ts-examples / t3code survey pass.
 *
 * Each named export targets a single rule so the matching test can scope
 * itself precisely.
 */

import { Effect, Layer } from 'effect';

// ---------------------------------------------------------------------------
// swallowed-error: catchAll handler returns Effect.void with no logging
// ---------------------------------------------------------------------------
export const swallowedErrorProgram = Effect.gen(function* () {
  const v = yield* Effect.tryPromise({
    try: () => fetch('/api').then((r) => r.json()),
    catch: (e) => new Error(String(e)),
  });
  return v;
}).pipe(
  // LINT: catchAll swallows the error without logging or rethrowing
  Effect.catchAll(() => Effect.void),
);

export const swallowedErrorWithLog = Effect.gen(function* () {
  const v = yield* Effect.tryPromise({
    try: () => fetch('/api').then((r) => r.json()),
    catch: (e) => new Error(String(e)),
  });
  return v;
}).pipe(
  // OK: logs the error before recovering
  Effect.catchAll((err) =>
    Effect.gen(function* () {
      yield* Effect.logError('request failed', err);
      return null;
    }),
  ),
);

// ---------------------------------------------------------------------------
// large-gen-block: Effect.gen with > 25 yields
// ---------------------------------------------------------------------------
export const largeGenBlock = Effect.gen(function* () {
  const a1 = yield* Effect.succeed(1);
  const a2 = yield* Effect.succeed(2);
  const a3 = yield* Effect.succeed(3);
  const a4 = yield* Effect.succeed(4);
  const a5 = yield* Effect.succeed(5);
  const a6 = yield* Effect.succeed(6);
  const a7 = yield* Effect.succeed(7);
  const a8 = yield* Effect.succeed(8);
  const a9 = yield* Effect.succeed(9);
  const a10 = yield* Effect.succeed(10);
  const a11 = yield* Effect.succeed(11);
  const a12 = yield* Effect.succeed(12);
  const a13 = yield* Effect.succeed(13);
  const a14 = yield* Effect.succeed(14);
  const a15 = yield* Effect.succeed(15);
  const a16 = yield* Effect.succeed(16);
  const a17 = yield* Effect.succeed(17);
  const a18 = yield* Effect.succeed(18);
  const a19 = yield* Effect.succeed(19);
  const a20 = yield* Effect.succeed(20);
  const a21 = yield* Effect.succeed(21);
  const a22 = yield* Effect.succeed(22);
  const a23 = yield* Effect.succeed(23);
  const a24 = yield* Effect.succeed(24);
  const a25 = yield* Effect.succeed(25);
  const a26 = yield* Effect.succeed(26);
  const a27 = yield* Effect.succeed(27);
  return (
    a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11 + a12 + a13 +
    a14 + a15 + a16 + a17 + a18 + a19 + a20 + a21 + a22 + a23 + a24 + a25 +
    a26 + a27
  );
});

export const smallGenBlock = Effect.gen(function* () {
  const a = yield* Effect.succeed(1);
  const b = yield* Effect.succeed(2);
  return a + b;
});

// ---------------------------------------------------------------------------
// flatMap-chain-depth: 3+ consecutive flatMap/andThen in a pipe
// ---------------------------------------------------------------------------
export const flatMapChain = Effect.succeed(1).pipe(
  Effect.flatMap((n) => Effect.succeed(n + 1)),
  Effect.flatMap((n) => Effect.succeed(n + 1)),
  Effect.flatMap((n) => Effect.succeed(n + 1)),
  Effect.flatMap((n) => Effect.succeed(n + 1)),
);

export const flatMapShort = Effect.succeed(1).pipe(
  Effect.flatMap((n) => Effect.succeed(n + 1)),
  Effect.flatMap((n) => Effect.succeed(n + 1)),
);

// ---------------------------------------------------------------------------
// provide-merge-chain: 3+ consecutive Layer.provideMerge calls
// ---------------------------------------------------------------------------
declare const L1: Layer.Layer<{ readonly _tag: 'A' }>;
declare const L2: Layer.Layer<{ readonly _tag: 'B' }>;
declare const L3: Layer.Layer<{ readonly _tag: 'C' }>;
declare const L4: Layer.Layer<{ readonly _tag: 'D' }>;

export const provideMergeChainProgram = Effect.gen(function* () {
  yield* Effect.log('starting');
}).pipe(
  Effect.provide(L1),
  Effect.provide(
    L2.pipe(
      Layer.provideMerge(L3),
      Layer.provideMerge(L4),
      Layer.provideMerge(L1),
    ),
  ),
);

// ---------------------------------------------------------------------------
// sequential-fail-in-validation: multiple Effect.fail in same gen branch
// ---------------------------------------------------------------------------
declare const input: { readonly name?: string; readonly age?: number; readonly email?: string };

export const sequentialFailValidation = Effect.gen(function* () {
  if (!input.name) {
    yield* Effect.fail(new Error('name is required'));
  }
  if (!input.age) {
    yield* Effect.fail(new Error('age is required'));
  }
  if (!input.email) {
    yield* Effect.fail(new Error('email is required'));
  }
  return input;
});

// ---------------------------------------------------------------------------
// deferred-no-resolve: Deferred.make with no succeed/fail/complete in scope
// ---------------------------------------------------------------------------
import { Deferred } from 'effect';

export const deferredNoResolve = Effect.gen(function* () {
  const d = yield* Deferred.make<number>();
  // LINT: never resolved
  return yield* Deferred.await(d);
});

export const deferredResolved = Effect.gen(function* () {
  const d = yield* Deferred.make<number>();
  yield* Deferred.succeed(d, 42);
  return yield* Deferred.await(d);
});

// ---------------------------------------------------------------------------
// runPromise-then-chain: AST-level (kept here so the source-linter test can use it)
// ---------------------------------------------------------------------------
export const runPromiseThenChain = () => {
  return Effect.runPromise(Effect.succeed(1)).then((n) => n + 1);
};

// ---------------------------------------------------------------------------
// untagged-throw: throw new Error inside Effect callback bodies
// ---------------------------------------------------------------------------
export const untaggedThrowProgram = Effect.try({
  try: () => {
    if (Math.random() > 0.5) {
      // LINT: throw new Error without tag
      throw new Error('boom');
    }
    return 42;
  },
  catch: (e) => e,
});

// ---------------------------------------------------------------------------
// raw-side-effect-in-gen: bare fetch/Math.random/process.env inside gen body
// ---------------------------------------------------------------------------
export const rawSideEffectInGen = Effect.gen(function* () {
  // LINT: raw fetch — should be wrapped in Effect.tryPromise / service
  const r = yield* Effect.succeed(fetch('/api'));
  // LINT: Math.random() — should be wrapped in Effect.sync or a Random service
  const x = Math.random();
  // LINT: process.env access — should be Config.string
  const k = process.env['SECRET_KEY'];
  return { r, x, k };
});

// ---------------------------------------------------------------------------
// mutable-in-concurrent: let mutated inside Effect.all/fork scope
// ---------------------------------------------------------------------------
export const mutableInConcurrent = Effect.gen(function* () {
  let counter = 0;
  yield* Effect.all(
    [
      Effect.sync(() => {
        counter = counter + 1; // LINT: shared mutable across parallel branches
      }),
      Effect.sync(() => {
        counter = counter + 1;
      }),
    ],
    { concurrency: 'unbounded' },
  );
  return counter;
});
