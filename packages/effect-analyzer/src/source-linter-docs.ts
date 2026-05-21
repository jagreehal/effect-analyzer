/**
 * Per-rule docs URL + Bad/Good example registry for the source-linter.
 *
 * Each entry maps a rule id to:
 *   - docsUrl  : the most relevant page on https://effect.website
 *   - example  : a small, copy-pasteable Bad → Good snippet illustrating the fix
 *
 * URLs verified against the Effect website MDX tree under
 * ___temp/repos/website/content/src/content/docs/docs/.
 */

export interface RuleDocs {
  readonly docsUrl?: string;
  readonly example?: { readonly bad: string; readonly good: string };
}

const D = 'https://effect.website/docs';

export const RULE_DOCS: Readonly<Record<string, RuleDocs>> = {
  // -------------------------------------------------------------------------
  // Errors
  // -------------------------------------------------------------------------
  'untagged-throw': {
    docsUrl: `${D}/error-management/expected-errors/`,
    example: {
      bad: `Effect.gen(function* () {
  if (!user) throw new Error("not found");
});`,
      good: `class UserNotFound extends Data.TaggedError("UserNotFound")<{}> {}

Effect.gen(function* () {
  if (!user) return yield* Effect.fail(new UserNotFound());
});`,
    },
  },
  'effect-fail-untagged': {
    docsUrl: `${D}/error-management/expected-errors/`,
    example: {
      bad: `Effect.fail(new Error("boom"));`,
      good: `class Boom extends Data.TaggedError("Boom")<{ readonly cause: string }> {}

Effect.fail(new Boom({ cause: "boom" }));`,
    },
  },
  'identity-catch': {
    docsUrl: `${D}/error-management/fallback/`,
    example: {
      bad: `Effect.catchAll(eff, (e) => Effect.fail(e));`,
      good: `// Either drop the catchAll entirely, or actually recover:
Effect.catchAll(eff, (e) => Effect.succeed(defaultValue));`,
    },
  },
  'tryPromise-without-catch': {
    docsUrl: `${D}/error-management/unexpected-errors/`,
    example: {
      bad: `Effect.tryPromise(() => fetch("/x"));`,
      good: `class FetchError extends Data.TaggedError("FetchError")<{ readonly cause: unknown }> {}

Effect.tryPromise({
  try: () => fetch("/x"),
  catch: (e) => new FetchError({ cause: e }),
});`,
    },
  },

  // -------------------------------------------------------------------------
  // Effect.gen / sync hygiene
  // -------------------------------------------------------------------------
  'raw-side-effect-in-gen': {
    docsUrl: `${D}/getting-started/creating-effects/`,
    example: {
      bad: `Effect.gen(function* () {
  const data = fetch("/x");
  return data;
});`,
      good: `Effect.gen(function* () {
  const data = yield* Effect.tryPromise({
    try: () => fetch("/x"),
    catch: (e) => new FetchError({ cause: e }),
  });
  return data;
});`,
    },
  },
  'console-log-in-effect': {
    docsUrl: `${D}/observability/logging/`,
    example: {
      bad: `Effect.gen(function* () {
  console.log("starting");
  return yield* work;
});`,
      good: `Effect.gen(function* () {
  yield* Effect.log("starting");
  return yield* work;
});`,
    },
  },
  'promise-api-in-gen': {
    docsUrl: `${D}/getting-started/creating-effects/`,
    example: {
      bad: `Effect.gen(function* () {
  const results = Promise.all([a(), b()]);
  return results;
});`,
      good: `Effect.gen(function* () {
  const results = yield* Effect.all([a, b], { concurrency: "unbounded" });
  return results;
});`,
    },
  },
  'run-effect-in-gen': {
    docsUrl: `${D}/getting-started/running-effects/`,
    example: {
      bad: `Effect.gen(function* () {
  const x = Effect.runPromise(inner); // creates nested runtime
  return x;
});`,
      good: `Effect.gen(function* () {
  const x = yield* inner; // compose, don't run
  return x;
});`,
    },
  },
  'return-effect-from-sync': {
    docsUrl: `${D}/getting-started/creating-effects/`,
    example: {
      bad: `Effect.sync(() => Effect.succeed(1)); // Effect<Effect<number>>`,
      good: `// drop the sync wrapper:
Effect.succeed(1);
// or use suspend for lazy construction:
Effect.suspend(() => Effect.succeed(1));`,
    },
  },
  'yield-promise': {
    docsUrl: `${D}/getting-started/creating-effects/`,
    example: {
      bad: `Effect.gen(function* () {
  const r = yield* fetch("/x"); // throws at runtime
});`,
      good: `Effect.gen(function* () {
  const r = yield* Effect.tryPromise({
    try: () => fetch("/x"),
    catch: (e) => new FetchError({ cause: e }),
  });
});`,
    },
  },

  // -------------------------------------------------------------------------
  // Runners
  // -------------------------------------------------------------------------
  'runPromise-then-chain': {
    docsUrl: `${D}/getting-started/running-effects/`,
    example: {
      bad: `Effect.runPromise(eff).then((x) => x + 1).catch(console.error);`,
      good: `// chain in Effect, run once at the boundary:
Effect.runPromise(
  eff.pipe(
    Effect.map((x) => x + 1),
    Effect.catchAll((e) => Effect.logError(e)),
  ),
);`,
    },
  },
  'runSync-on-async': {
    docsUrl: `${D}/getting-started/running-effects/`,
    example: {
      bad: `Effect.runSync(Effect.tryPromise(() => fetch("/x"))); // throws`,
      good: `await Effect.runPromise(
  Effect.tryPromise({ try: () => fetch("/x"), catch: (e) => e }),
);`,
    },
  },

  // -------------------------------------------------------------------------
  // Concurrency / state
  // -------------------------------------------------------------------------
  'mutable-in-concurrent': {
    docsUrl: `${D}/state-management/ref/`,
    example: {
      bad: `let count = 0;
Effect.all(
  [Effect.sync(() => { count = count + 1; }), /* ... */],
  { concurrency: "unbounded" },
);`,
      good: `const ref = yield* Ref.make(0);
yield* Effect.all(
  [Ref.update(ref, (n) => n + 1), /* ... */],
  { concurrency: "unbounded" },
);`,
    },
  },
  'forEach-without-concurrency': {
    docsUrl: `${D}/concurrency/basic-concurrency/`,
    example: {
      bad: `Effect.forEach(items, processItem); // sequential, silently`,
      good: `// parallel:
Effect.forEach(items, processItem, { concurrency: "unbounded" });
// or be explicit about sequential intent:
Effect.forEach(items, processItem, { concurrency: 1 });`,
    },
  },

  // -------------------------------------------------------------------------
  // Layers
  // -------------------------------------------------------------------------
  'layer-duplicate-merge': {
    docsUrl: `${D}/requirements-management/layers/`,
    example: {
      bad: `Layer.merge(AppLayer, AppLayer); // last wins — usually a typo`,
      good: `Layer.merge(AppLayer, LoggingLayer);`,
    },
  },

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------
  'schedule-unbounded': {
    docsUrl: `${D}/scheduling/schedule-combinators/`,
    example: {
      bad: `Effect.retry(eff, Schedule.spaced("1 second")); // forever`,
      good: `Effect.retry(
  eff,
  Schedule.spaced("1 second").pipe(Schedule.intersect(Schedule.recurs(5))),
);`,
    },
  },

  // -------------------------------------------------------------------------
  // Effect.all / pipes
  // -------------------------------------------------------------------------
  'empty-effect-all': {
    docsUrl: `${D}/getting-started/building-pipelines/`,
    example: {
      bad: `Effect.all([]); // always succeeds with []`,
      good: `// remove the dead branch, or be explicit:
Effect.succeed([] as const);`,
    },
  },
  'useless-pipe': {
    docsUrl: `${D}/getting-started/building-pipelines/`,
    example: {
      bad: `const x = pipe(value);`,
      good: `const x = value;`,
    },
  },

  // -------------------------------------------------------------------------
  // Configuration / security
  // -------------------------------------------------------------------------
  'config-secret-without-redacted': {
    docsUrl: `${D}/configuration/`,
    example: {
      bad: `const token = yield* Config.string("API_TOKEN"); // logs as plain text`,
      good: `const token = yield* Config.redacted("API_TOKEN");
// Use Redacted.value(token) only at the boundary where you must send it.`,
    },
  },

  // -------------------------------------------------------------------------
  // Test hygiene
  // -------------------------------------------------------------------------
  'live-layer-in-test': {
    docsUrl: `${D}/requirements-management/layers/`,
    example: {
      bad: `// inside foo.test.ts
const result = await Effect.runPromise(program.pipe(Effect.provide(UserRepoLive)));`,
      good: `const UserRepoTest = Layer.succeed(UserRepo, {
  findById: () => Effect.succeed({ id: "1", name: "Test" }),
});

const result = await Effect.runPromise(program.pipe(Effect.provide(UserRepoTest)));`,
    },
  },
  'nondeterministic-test-api': {
    docsUrl: `${D}/testing/testclock/`,
    example: {
      bad: `it("expires after 5m", () => {
  const start = Date.now();
  // ...
});`,
      good: `it("expires after 5m", () =>
  Effect.gen(function* () {
    yield* TestClock.adjust("5 minutes");
    // assertions
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise),
);`,
    },
  },
  'detached-fiber-in-test': {
    docsUrl: `${D}/concurrency/fibers/`,
    example: {
      bad: `it("forks", () => {
  Effect.runFork(longRunning); // outlives the test
});`,
      good: `it("forks", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(longRunning);
    yield* Fiber.interrupt(fiber);
  }).pipe(Effect.runPromise),
);`,
    },
  },
  'sleep-without-testclock': {
    docsUrl: `${D}/testing/testclock/`,
    example: {
      bad: `it("debounces", () =>
  Effect.runPromise(Effect.sleep("1 second"))); // real wall-clock wait`,
      good: `it("debounces", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(Effect.sleep("1 second"));
    yield* TestClock.adjust("1 second");
    yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise),
);`,
    },
  },

  // -------------------------------------------------------------------------
  // Effect-team standards (mirrored from @effect/eslint-plugin)
  // -------------------------------------------------------------------------
  'barrel-import-from-effect': {
    docsUrl: `${D}/getting-started/importing-effect/`,
    example: {
      bad: `import { Effect } from "effect";`,
      good: `import * as Effect from "effect/Effect";`,
    },
  },
  'array-push-spread': {
    // No specific Effect doc; link to the Effect-team's ESLint config rationale.
    docsUrl:
      'https://github.com/Effect-TS/effect/blob/main/eslint.config.mjs',
    example: {
      bad: `arr.push(...xs); // stack-overflow risk on large xs`,
      good: `for (const x of xs) arr.push(x);
// or, for unbounded inputs:
arr = arr.concat(xs);`,
    },
  },
};
