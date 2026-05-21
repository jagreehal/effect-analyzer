import { describe, it, expect } from 'vitest';
import { lintSourceCode } from './source-linter';
import { RULE_DOCS } from './source-linter-docs';

describe('source-linter: untagged-throw', () => {
  it('does NOT flag throw inside Effect.try({ try, catch }) — idiomatic', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       class MyError extends Error {}
       export const p = Effect.try({
         try: () => { throw new Error('boom'); },
         catch: (cause) => new MyError(),
       });`,
    );
    expect(issues.filter((i) => i.rule === 'untagged-throw')).toEqual([]);
  });

  it('does NOT flag throw inside Effect.tryPromise({ try, catch }) — idiomatic', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.tryPromise({
         try: async () => { throw new Error('boom'); },
         catch: (e) => e,
       });`,
    );
    expect(issues.filter((i) => i.rule === 'untagged-throw')).toEqual([]);
  });

  it('flags throw inside Effect.sync (becomes a defect)', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.sync(() => { throw new Error('boom'); });`,
    );
    expect(issues.filter((i) => i.rule === 'untagged-throw').length).toBe(1);
  });

  it('flags throw inside Effect.gen body', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         throw new Error('escape');
       });`,
    );
    expect(issues.filter((i) => i.rule === 'untagged-throw').length).toBe(1);
  });

  it('does not flag throw outside Effect context', () => {
    const { issues } = lintSourceCode(
      `export function noop() {
         throw new Error('outside effect');
       }`,
    );
    expect(issues.filter((i) => i.rule === 'untagged-throw').length).toBe(0);
  });
});

describe('source-linter: raw-side-effect-in-gen', () => {
  it('flags bare fetch in Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const r = fetch('/x');
         return yield* Effect.succeed(r);
       });`,
    );
    const raw = issues.filter((i) => i.rule === 'raw-side-effect-in-gen');
    expect(raw.length).toBe(1);
    expect(raw[0]?.message).toMatch(/fetch/);
  });

  it('flags Math.random inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const x = Math.random();
         return yield* Effect.succeed(x);
       });`,
    );
    expect(issues.some((i) => i.rule === 'raw-side-effect-in-gen' && /Math.random/.test(i.message))).toBe(true);
  });

  it('flags process.env access inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const k = process.env.SECRET;
         return yield* Effect.succeed(k);
       });`,
    );
    expect(issues.some((i) => i.rule === 'raw-side-effect-in-gen' && /process.env/.test(i.message))).toBe(true);
  });

  it('does not flag fetch wrapped in Effect.tryPromise', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const r = yield* Effect.tryPromise({ try: () => fetch('/x'), catch: (e) => e });
         return r;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'raw-side-effect-in-gen')).toEqual([]);
  });

  it('flags bare new Promise inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const x = new Promise((resolve) => resolve(1));
         return yield* Effect.succeed(x);
       });`,
    );
    expect(issues.some((i) => i.rule === 'raw-side-effect-in-gen' && i.message.includes('new Promise'))).toBe(true);
  });

  it('flags setTimeout inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         setTimeout(() => {}, 10);
         return yield* Effect.succeed(1);
       });`,
    );
    expect(issues.some((i) => i.rule === 'raw-side-effect-in-gen' && i.message.includes('setTimeout'))).toBe(true);
  });
});

describe('source-linter: mutable-in-concurrent', () => {
  it('flags let mutation inside Effect.all', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         let counter = 0;
         yield* Effect.all([
           Effect.sync(() => { counter = counter + 1; }),
           Effect.sync(() => { counter = counter + 1; }),
         ], { concurrency: 'unbounded' });
         return counter;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'mutable-in-concurrent').length).toBeGreaterThan(0);
  });
});

describe('source-linter: runPromise-then-chain', () => {
  it('flags .then on Effect.runPromise', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const main = () => Effect.runPromise(Effect.succeed(1)).then((n) => n + 1);`,
    );
    expect(issues.filter((i) => i.rule === 'runPromise-then-chain').length).toBe(1);
  });
});

describe('source-linter: runSync-on-async', () => {
  it('flags Effect.runSync directly on Effect.tryPromise', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.runSync(Effect.tryPromise({ try: () => fetch('/x'), catch: (e) => e }));`,
    );
    expect(issues.filter((i) => i.rule === 'runSync-on-async').length).toBe(1);
  });

  it('flags Effect.runSync on a tainted identifier', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       const asyncEff = Effect.tryPromise({ try: () => fetch('/x'), catch: (e) => e });
       export const x = Effect.runSync(asyncEff);`,
    );
    expect(issues.filter((i) => i.rule === 'runSync-on-async').length).toBe(1);
  });

  it('does not flag Effect.runSync on a pure effect', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.runSync(Effect.succeed(1));`,
    );
    expect(issues.filter((i) => i.rule === 'runSync-on-async')).toEqual([]);
  });

  it('flags Effect.runSyncExit directly on Effect.tryPromise', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.runSyncExit(Effect.tryPromise({ try: () => fetch('/x'), catch: (e) => e }));`,
    );
    expect(issues.filter((i) => i.rule === 'runSyncExit-on-async').length).toBe(1);
  });

  it('flags Effect.runSyncExit on a tainted identifier', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       const asyncEff = Effect.tryPromise({ try: () => fetch('/x'), catch: (e) => e });
       export const x = Effect.runSyncExit(asyncEff);`,
    );
    expect(issues.filter((i) => i.rule === 'runSyncExit-on-async').length).toBe(1);
  });
});

describe('source-linter: live-layer-in-test', () => {
  it('flags references to *Live in .test.ts files', () => {
    const { issues } = lintSourceCode(
      `import { UserRepoLive } from './user-repo';
       export const test = UserRepoLive;`,
      'foo.test.ts',
    );
    expect(issues.filter((i) => i.rule === 'live-layer-in-test').length).toBeGreaterThan(0);
  });

  it('does not flag in non-test files', () => {
    const { issues } = lintSourceCode(
      `import { UserRepoLive } from './user-repo';
       export const x = UserRepoLive;`,
      'foo.ts',
    );
    expect(issues.filter((i) => i.rule === 'live-layer-in-test')).toEqual([]);
  });

  it('does not flag camelCase helpers ending in Live (e.g. runLive)', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       declare const runLive: <A>(eff: Effect.Effect<A>) => Promise<A>;
       export const t = runLive(Effect.succeed(1));`,
      'foo.test.ts',
    );
    expect(issues.filter((i) => i.rule === 'live-layer-in-test')).toEqual([]);
  });

  it('does not flag AWS TimeToLive API methods', () => {
    const { issues } = lintSourceCode(
      `declare const dynamodb: { describeTimeToLive: () => Promise<unknown>; updateTimeToLive: () => Promise<unknown> };
       export const t = async () => {
         await dynamodb.describeTimeToLive();
         await dynamodb.updateTimeToLive();
       };`,
      'ttl.test.ts',
    );
    expect(issues.filter((i) => i.rule === 'live-layer-in-test')).toEqual([]);
  });

  it('flags in __tests__ directory files without .test suffix', () => {
    const { issues } = lintSourceCode(
      `import { UserRepoLive } from './user-repo';
       export const x = UserRepoLive;`,
      'src/__tests__/user-repo.ts',
    );
    expect(issues.filter((i) => i.rule === 'live-layer-in-test').length).toBeGreaterThan(0);
  });

  it('downgrades live-layer-in-test to info for integration tests', () => {
    const { issues } = lintSourceCode(
      `import { UserRepoLive } from './user-repo';
       export const layer = UserRepoLive;`,
      'integration/user-repo.integration.test.ts',
    );
    const found = issues.find((i) => i.rule === 'live-layer-in-test');
    expect(found?.severity).toBe('info');
  });
});

describe('source-linter: deterministic ordering', () => {
  it('sorts issues canonically by location then rule/message', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const b = Math.random();
         const a = fetch('/x');
         return yield* Effect.succeed([a, b]);
       });`,
      'order.test.ts',
    );
    const raw = issues.filter((i) => i.rule === 'raw-side-effect-in-gen');
    expect(raw.length).toBe(2);
    expect(raw[0]?.location?.line).toBeLessThan(raw[1]?.location?.line ?? Number.MAX_SAFE_INTEGER);
    expect(raw[0]?.message).toMatch(/Math\.random|fetch/);
    expect(raw[1]?.message).toMatch(/Math\.random|fetch/);
  });
});

describe('source-linter: nondeterministic-test-api', () => {
  it('flags Date.now, new Date() and Math.random in test files', () => {
    const { issues } = lintSourceCode(
      `export const t = () => {
        const now = Date.now();
        const r = Math.random();
        const d = new Date();
        return { now, r, d };
      };`,
      'time.spec.ts',
    );
    const flagged = issues.filter((i) => i.rule === 'nondeterministic-test-api');
    expect(flagged.length).toBe(3);
  });

  it('does not flag deterministic Date construction in tests', () => {
    const { issues } = lintSourceCode(
      `export const t = () => new Date('2020-01-01T00:00:00.000Z');`,
      'time.test.ts',
    );
    expect(issues.filter((i) => i.rule === 'nondeterministic-test-api')).toEqual([]);
  });

  it('does not flag these APIs in non-test files', () => {
    const { issues } = lintSourceCode(
      `export const t = Date.now() + Math.random();`,
      'runtime.ts',
    );
    expect(issues.filter((i) => i.rule === 'nondeterministic-test-api')).toEqual([]);
  });

  it('flags in test directory files without .test suffix', () => {
    const { issues } = lintSourceCode(
      `export const t = Date.now();`,
      'test/runtime.ts',
    );
    expect(issues.filter((i) => i.rule === 'nondeterministic-test-api').length).toBe(1);
  });

  it('flags in tests directory files without .test suffix', () => {
    const { issues } = lintSourceCode(
      `export const t = Date.now();`,
      'tests/runtime.ts',
    );
    expect(issues.filter((i) => i.rule === 'nondeterministic-test-api').length).toBe(1);
  });
});

describe('source-linter: detached-fiber-in-test', () => {
  it('flags Effect.runFork in test files', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const t = () => Effect.runFork(Effect.never);`,
      'fork.test.ts',
    );
    expect(issues.filter((i) => i.rule === 'detached-fiber-in-test').length).toBe(1);
  });

  it('flags Runtime.runFork in test files', () => {
    const { issues } = lintSourceCode(
      `import { Runtime, Effect } from 'effect';
       declare const rt: Runtime.Runtime<never>;
       export const t = () => Runtime.runFork(rt)(Effect.never);`,
      'fork.spec.ts',
    );
    expect(issues.filter((i) => i.rule === 'detached-fiber-in-test').length).toBe(1);
  });

  it('does not flag in non-test files', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const main = () => Effect.runFork(Effect.never);`,
      'main.ts',
    );
    expect(issues.filter((i) => i.rule === 'detached-fiber-in-test')).toEqual([]);
  });
});

describe('source-linter: unsafe-api-usage', () => {
  it('flags Effect.unsafe* calls', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const s = Effect.unsafeMakeSemaphore(1);`,
      'runtime.ts',
    );
    expect(issues.filter((i) => i.rule === 'unsafe-api-usage').length).toBe(1);
  });

  it('flags Runtime.unsafe* calls', () => {
    const { issues } = lintSourceCode(
      `import { Runtime, Effect } from 'effect';
       declare const rt: Runtime.Runtime<never>;
       export const x = Runtime.unsafeRunSync(rt)(Effect.succeed(1));`,
      'runtime.ts',
    );
    expect(issues.filter((i) => i.rule === 'unsafe-api-usage').length).toBe(2);
  });

  it('does not flag safe APIs', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.runPromise(Effect.succeed(1));`,
      'runtime.ts',
    );
    expect(issues.filter((i) => i.rule === 'unsafe-api-usage')).toEqual([]);
  });
});

describe('source-linter: console-log-in-effect', () => {
  it('flags console.log inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         console.log('hi');
         return yield* Effect.succeed(1);
       });`,
    );
    const flagged = issues.filter((i) => i.rule === 'console-log-in-effect');
    expect(flagged.length).toBe(1);
    expect(flagged[0]?.message).toMatch(/Effect\.log/);
  });

  it('suggests logWarning for console.warn', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         console.warn('careful');
         return yield* Effect.succeed(1);
       });`,
    );
    const flagged = issues.find((i) => i.rule === 'console-log-in-effect');
    expect(flagged?.message).toMatch(/Effect\.logWarning/);
  });

  it('does not flag console.log when wrapped in Effect.sync', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         yield* Effect.sync(() => console.log('ok'));
         return yield* Effect.succeed(1);
       });`,
    );
    expect(issues.filter((i) => i.rule === 'console-log-in-effect')).toEqual([]);
  });

  it('does not flag console.log outside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `export const noop = () => console.log('hi');`,
    );
    expect(issues.filter((i) => i.rule === 'console-log-in-effect')).toEqual([]);
  });
});

describe('source-linter: promise-api-in-gen', () => {
  it('flags Promise.all inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const xs = Promise.all([Promise.resolve(1), Promise.resolve(2)]);
         return yield* Effect.succeed(xs);
       });`,
    );
    const flagged = issues.filter((i) => i.rule === 'promise-api-in-gen');
    expect(flagged.some((i) => i.message.includes('Promise.all'))).toBe(true);
  });

  it('flags Promise.race inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const x = Promise.race([Promise.resolve(1)]);
         return yield* Effect.succeed(x);
       });`,
    );
    expect(
      issues.some(
        (i) => i.rule === 'promise-api-in-gen' && i.message.includes('Promise.race'),
      ),
    ).toBe(true);
  });

  it('does not flag Promise.all outside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `export const main = () => Promise.all([Promise.resolve(1)]);`,
    );
    expect(issues.filter((i) => i.rule === 'promise-api-in-gen')).toEqual([]);
  });

  it('does not flag Promise.all wrapped in Effect.tryPromise', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const xs = yield* Effect.tryPromise({
           try: () => Promise.all([Promise.resolve(1)]),
           catch: (e) => e,
         });
         return xs;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'promise-api-in-gen')).toEqual([]);
  });
});

describe('source-linter: effect-fail-untagged', () => {
  it('flags Effect.fail(new Error(...))', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.fail(new Error('boom'));`,
    );
    expect(issues.filter((i) => i.rule === 'effect-fail-untagged').length).toBe(1);
  });

  it('flags Effect.fail(new TypeError(...))', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.fail(new TypeError('bad'));`,
    );
    expect(issues.filter((i) => i.rule === 'effect-fail-untagged').length).toBe(1);
  });

  it('flags Effect.failSync(() => new Error(...))', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.failSync(() => new Error('boom'));`,
    );
    expect(issues.filter((i) => i.rule === 'effect-fail-untagged').length).toBe(1);
  });

  it('does not flag Effect.fail with a tagged error class', () => {
    const { issues } = lintSourceCode(
      `import { Data, Effect } from 'effect';
       class MyError extends Data.TaggedError('MyError')<{ readonly cause: string }> {}
       export const p = Effect.fail(new MyError({ cause: 'x' }));`,
    );
    expect(issues.filter((i) => i.rule === 'effect-fail-untagged')).toEqual([]);
  });
});

describe('source-linter: run-effect-in-gen', () => {
  it('flags Effect.runPromise inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const x = Effect.runPromise(Effect.succeed(1));
         return yield* Effect.succeed(x);
       });`,
    );
    expect(issues.filter((i) => i.rule === 'run-effect-in-gen').length).toBe(1);
  });

  it('flags Effect.runSync inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const x = Effect.runSync(Effect.succeed(1));
         return x;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'run-effect-in-gen').length).toBe(1);
  });

  it('flags Effect.runFork inside Effect.gen', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         Effect.runFork(Effect.never);
         return yield* Effect.succeed(1);
       });`,
    );
    expect(issues.filter((i) => i.rule === 'run-effect-in-gen').length).toBe(1);
  });

  it('does not flag Effect.runPromise at the top level', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const main = () => Effect.runPromise(Effect.succeed(1));`,
    );
    expect(issues.filter((i) => i.rule === 'run-effect-in-gen')).toEqual([]);
  });
});

describe('source-linter: forEach-without-concurrency', () => {
  it('flags Effect.forEach with no options', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.forEach([1, 2, 3], (n) => Effect.succeed(n + 1));`,
    );
    expect(issues.filter((i) => i.rule === 'forEach-without-concurrency').length).toBe(1);
  });

  it('does not flag Effect.forEach with options object', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.forEach(
         [1, 2, 3],
         (n) => Effect.succeed(n + 1),
         { concurrency: 'unbounded' },
       );`,
    );
    expect(issues.filter((i) => i.rule === 'forEach-without-concurrency')).toEqual([]);
  });

  it('flags Stream.runForEach with no options', () => {
    const { issues } = lintSourceCode(
      `import { Stream, Effect } from 'effect';
       export const p = Stream.runForEach(Stream.make(1, 2, 3), (n) => Effect.succeed(n));`,
    );
    expect(issues.filter((i) => i.rule === 'forEach-without-concurrency').length).toBe(1);
  });
});

describe('source-linter: identity-catch', () => {
  it('flags Effect.catchAll(e => Effect.fail(e))', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.catchAll(Effect.succeed(1), (e) => Effect.fail(e));`,
    );
    expect(issues.filter((i) => i.rule === 'identity-catch').length).toBe(1);
  });

  it('flags Effect.catchAllCause(c => Effect.failCause(c))', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.catchAllCause(Effect.succeed(1), (c) => Effect.failCause(c));`,
    );
    expect(issues.filter((i) => i.rule === 'identity-catch').length).toBe(1);
  });

  it('flags Effect.catchTag("Foo", e => Effect.fail(e))', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.catchTag(Effect.succeed(1), 'Foo', (e) => Effect.fail(e));`,
    );
    expect(issues.filter((i) => i.rule === 'identity-catch').length).toBe(1);
  });

  it('does not flag a real recovery handler', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.catchAll(Effect.succeed(1), () => Effect.succeed(0));`,
    );
    expect(issues.filter((i) => i.rule === 'identity-catch')).toEqual([]);
  });

  it('does not flag when handler re-fails a different value', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.catchAll(Effect.succeed(1), (e) => Effect.fail(\`wrap:\${String(e)}\`));`,
    );
    expect(issues.filter((i) => i.rule === 'identity-catch')).toEqual([]);
  });
});

describe('source-linter: empty-effect-all', () => {
  it('flags Effect.all([])', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.all([]);`,
    );
    expect(issues.filter((i) => i.rule === 'empty-effect-all').length).toBe(1);
  });

  it('flags Effect.all({})', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.all({});`,
    );
    expect(issues.filter((i) => i.rule === 'empty-effect-all').length).toBe(1);
  });

  it('does not flag a non-empty array', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.all([Effect.succeed(1)]);`,
    );
    expect(issues.filter((i) => i.rule === 'empty-effect-all')).toEqual([]);
  });
});

describe('source-linter: layer-duplicate-merge', () => {
  it('flags Layer.merge(A, A)', () => {
    const { issues } = lintSourceCode(
      `import { Layer } from 'effect';
       declare const A: Layer.Layer<never>;
       export const L = Layer.merge(A, A);`,
    );
    expect(issues.filter((i) => i.rule === 'layer-duplicate-merge').length).toBe(1);
  });

  it('flags Layer.mergeAll(A, B, A)', () => {
    const { issues } = lintSourceCode(
      `import { Layer } from 'effect';
       declare const A: Layer.Layer<never>;
       declare const B: Layer.Layer<never>;
       export const L = Layer.mergeAll(A, B, A);`,
    );
    expect(issues.filter((i) => i.rule === 'layer-duplicate-merge').length).toBe(1);
  });

  it('does not flag distinct layers', () => {
    const { issues } = lintSourceCode(
      `import { Layer } from 'effect';
       declare const A: Layer.Layer<never>;
       declare const B: Layer.Layer<never>;
       export const L = Layer.merge(A, B);`,
    );
    expect(issues.filter((i) => i.rule === 'layer-duplicate-merge')).toEqual([]);
  });

  it('does not flag inline expressions even if identical', () => {
    // Inline Layer.succeed calls produce non-identifier text — we intentionally
    // skip those to avoid false positives.
    const { issues } = lintSourceCode(
      `import { Layer, Context } from 'effect';
       class S extends Context.Tag('S')<S, { readonly x: number }>() {}
       export const L = Layer.merge(Layer.succeed(S, { x: 1 }), Layer.succeed(S, { x: 1 }));`,
    );
    expect(issues.filter((i) => i.rule === 'layer-duplicate-merge')).toEqual([]);
  });
});

describe('source-linter: schedule-unbounded', () => {
  it('flags bare Schedule.forever passed to retry', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Schedule } from 'effect';
       export const p = Effect.retry(Effect.succeed(1), Schedule.forever);`,
    );
    expect(issues.filter((i) => i.rule === 'schedule-unbounded').length).toBe(1);
  });

  it('flags bare Schedule.spaced(...) passed to retry', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Schedule, Duration } from 'effect';
       export const p = Effect.retry(Effect.succeed(1), Schedule.spaced(Duration.seconds(1)));`,
    );
    expect(issues.filter((i) => i.rule === 'schedule-unbounded').length).toBe(1);
  });

  it('does not flag Schedule.forever composed with upTo via pipe', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Schedule, Duration, pipe } from 'effect';
       export const s = pipe(Schedule.forever, Schedule.upTo(Duration.seconds(30)));`,
    );
    expect(issues.filter((i) => i.rule === 'schedule-unbounded')).toEqual([]);
  });

  it('does not flag Schedule.spaced composed with recurs', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Schedule, Duration, pipe } from 'effect';
       export const s = pipe(Schedule.spaced(Duration.seconds(1)), Schedule.intersect(Schedule.recurs(3)));`,
    );
    expect(issues.filter((i) => i.rule === 'schedule-unbounded')).toEqual([]);
  });
});

describe('source-linter: config-secret-without-redacted', () => {
  it('flags Config.string("DATABASE_PASSWORD")', () => {
    const { issues } = lintSourceCode(
      `import { Config } from 'effect';
       export const c = Config.string('DATABASE_PASSWORD');`,
    );
    const flagged = issues.filter((i) => i.rule === 'config-secret-without-redacted');
    expect(flagged.length).toBe(1);
    expect(flagged[0]?.suggestion).toMatch(/Config\.redacted/);
  });

  it('flags Config.string("API_TOKEN")', () => {
    const { issues } = lintSourceCode(
      `import { Config } from 'effect';
       export const c = Config.string('API_TOKEN');`,
    );
    expect(issues.filter((i) => i.rule === 'config-secret-without-redacted').length).toBe(1);
  });

  it('flags Config.nonEmptyString("CLIENT_SECRET")', () => {
    const { issues } = lintSourceCode(
      `import { Config } from 'effect';
       export const c = Config.nonEmptyString('CLIENT_SECRET');`,
    );
    expect(issues.filter((i) => i.rule === 'config-secret-without-redacted').length).toBe(1);
  });

  it('does not flag Config.redacted("PASSWORD")', () => {
    const { issues } = lintSourceCode(
      `import { Config } from 'effect';
       export const c = Config.redacted('PASSWORD');`,
    );
    expect(issues.filter((i) => i.rule === 'config-secret-without-redacted')).toEqual([]);
  });

  it('does not flag Config.string for non-secret names', () => {
    const { issues } = lintSourceCode(
      `import { Config } from 'effect';
       export const c = Config.string('PORT');`,
    );
    expect(issues.filter((i) => i.rule === 'config-secret-without-redacted')).toEqual([]);
  });
});

describe('source-linter: return-effect-from-sync', () => {
  it('flags Effect.sync(() => Effect.succeed(...))', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.sync(() => Effect.succeed(1));`,
    );
    const flagged = issues.filter((i) => i.rule === 'return-effect-from-sync');
    expect(flagged.length).toBe(1);
    expect(flagged[0]?.message).toMatch(/Effect\.succeed/);
  });

  it('flags Effect.sync(() => { return Effect.fail(...); })', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.sync(() => { return Effect.fail('boom'); });`,
    );
    expect(issues.filter((i) => i.rule === 'return-effect-from-sync').length).toBe(1);
  });

  it('flags Effect.try({ try: () => Effect.flatMap(...) })', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.try({
         try: () => Effect.flatMap(Effect.succeed(1), () => Effect.succeed(2)),
         catch: (e) => e,
       });`,
    );
    expect(issues.filter((i) => i.rule === 'return-effect-from-sync').length).toBe(1);
  });

  it('does not flag Effect.sync(() => plainValue)', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.sync(() => 42);`,
    );
    expect(issues.filter((i) => i.rule === 'return-effect-from-sync')).toEqual([]);
  });

  it('does not flag Effect.sync returning a non-Effect call', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       declare function compute(): number;
       export const p = Effect.sync(() => compute());`,
    );
    expect(issues.filter((i) => i.rule === 'return-effect-from-sync')).toEqual([]);
  });
});

describe('source-linter: yield-promise', () => {
  it('flags yield* new Promise(...)', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const x = yield* new Promise((r) => r(1));
         return x;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'yield-promise').length).toBe(1);
  });

  it('flags yield* Promise.resolve(...)', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const x = yield* Promise.resolve(1);
         return x;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'yield-promise').length).toBe(1);
  });

  it('flags yield* fetch(...)', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const r = yield* fetch('/x');
         return r;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'yield-promise').length).toBe(1);
  });

  it('does not flag yield* fetch where fetch is a local destructure', () => {
    // Real alchemy-effect pattern: a container helper returns { fetch }
    // where the local `fetch` is an Effect-returning HTTP client method.
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       declare const container: { getTcpPort: (n: number) => Effect.Effect<{ fetch: (url: string) => Effect.Effect<Response> }> };
       export const p = Effect.gen(function* () {
         const { fetch } = yield* container.getTcpPort(3000);
         const r = yield* fetch('/x');
         return r;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'yield-promise')).toEqual([]);
  });

  it('does not flag yield* fetch where fetch is a local parameter', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const paginate = <T>(fetch: (t?: string) => Effect.Effect<T>) =>
         Effect.gen(function* () {
           const page = yield* fetch(undefined);
           return page;
         });`,
    );
    expect(issues.filter((i) => i.rule === 'yield-promise')).toEqual([]);
  });

  it('does not flag yield* Effect.tryPromise(...)', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         const x = yield* Effect.tryPromise({ try: () => fetch('/x'), catch: (e) => e });
         return x;
       });`,
    );
    expect(issues.filter((i) => i.rule === 'yield-promise')).toEqual([]);
  });
});

describe('source-linter: useless-pipe', () => {
  it('flags pipe(x) with a single argument', () => {
    const { issues } = lintSourceCode(
      `import { pipe } from 'effect';
       export const x = pipe(1);`,
    );
    expect(issues.filter((i) => i.rule === 'useless-pipe').length).toBe(1);
  });

  it('does not flag pipe(x, f)', () => {
    const { issues } = lintSourceCode(
      `import { pipe } from 'effect';
       export const x = pipe(1, (n) => n + 1);`,
    );
    expect(issues.filter((i) => i.rule === 'useless-pipe')).toEqual([]);
  });
});

describe('source-linter: barrel-import-from-effect', () => {
  it('flags import { Effect } from "effect"', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.succeed(1);`,
    );
    const flagged = issues.filter((i) => i.rule === 'barrel-import-from-effect');
    expect(flagged.length).toBe(1);
    expect(flagged[0]?.suggestion).toMatch(/import \* as Effect from "effect\/Effect"/);
  });

  it('flags each named specifier separately', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Layer, Context } from 'effect';
       export const x = Effect.succeed(1);`,
    );
    expect(issues.filter((i) => i.rule === 'barrel-import-from-effect').length).toBe(3);
  });

  it('flags @effect/platform barrel imports', () => {
    const { issues } = lintSourceCode(
      `import { HttpClient } from '@effect/platform';
       declare const x: typeof HttpClient;`,
    );
    expect(issues.filter((i) => i.rule === 'barrel-import-from-effect').length).toBe(1);
  });

  it('respects aliased imports in the suggestion', () => {
    const { issues } = lintSourceCode(
      `import { Effect as E } from 'effect';
       export const x = E.succeed(1);`,
    );
    const flagged = issues.find((i) => i.rule === 'barrel-import-from-effect');
    expect(flagged?.suggestion).toMatch(/import \* as E from "effect\/Effect"/);
  });

  it('does not flag namespace imports', () => {
    const { issues } = lintSourceCode(
      `import * as Effect from 'effect/Effect';
       export const x = Effect.succeed(1);`,
    );
    expect(issues.filter((i) => i.rule === 'barrel-import-from-effect')).toEqual([]);
  });

  it('does not flag type-only imports', () => {
    const { issues } = lintSourceCode(
      `import type { Effect } from 'effect';
       declare const x: Effect.Effect<number>;`,
    );
    expect(issues.filter((i) => i.rule === 'barrel-import-from-effect')).toEqual([]);
  });

  it('does not flag type-only named specifiers', () => {
    const { issues } = lintSourceCode(
      `import { type Effect, Layer } from 'effect';
       declare const x: Effect.Effect<number>;
       export const y = Layer.empty;`,
    );
    const flagged = issues.filter((i) => i.rule === 'barrel-import-from-effect');
    expect(flagged.length).toBe(1);
    expect(flagged[0]?.message).toMatch(/Layer/);
  });

  it('does not flag non-Effect packages', () => {
    const { issues } = lintSourceCode(
      `import { describe } from 'vitest';
       describe('x', () => {});`,
    );
    expect(issues.filter((i) => i.rule === 'barrel-import-from-effect')).toEqual([]);
  });
});

describe('source-linter: array-push-spread', () => {
  it('flags arr.push(...xs)', () => {
    const { issues } = lintSourceCode(
      `export function append(arr: number[], xs: number[]) {
         arr.push(...xs);
       }`,
    );
    expect(issues.filter((i) => i.rule === 'array-push-spread').length).toBe(1);
  });

  it('flags arr.push(a, ...xs) (mixed args)', () => {
    const { issues } = lintSourceCode(
      `export function append(arr: number[], xs: number[]) {
         arr.push(1, ...xs);
       }`,
    );
    expect(issues.filter((i) => i.rule === 'array-push-spread').length).toBe(1);
  });

  it('does not flag arr.push(x) without spread', () => {
    const { issues } = lintSourceCode(
      `export function append(arr: number[], x: number) {
         arr.push(x);
       }`,
    );
    expect(issues.filter((i) => i.rule === 'array-push-spread')).toEqual([]);
  });

  it('does not flag other methods with spread', () => {
    const { issues } = lintSourceCode(
      `export function combine(xs: number[], ys: number[]) {
         return xs.concat(...ys);
       }`,
    );
    expect(issues.filter((i) => i.rule === 'array-push-spread')).toEqual([]);
  });
});

describe('source-linter: tryPromise-without-catch', () => {
  it('flags Effect.tryPromise(fn) short form', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       declare const load: () => Promise<string>;
       export const p = Effect.tryPromise(load);`,
    );
    const flagged = issues.filter((i) => i.rule === 'tryPromise-without-catch');
    expect(flagged.length).toBe(1);
    expect(flagged[0]?.message).toMatch(/UnknownException/);
  });

  it('flags Effect.tryPromise(() => fn()) short form', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.tryPromise(() => fetch('/x'));`,
    );
    expect(issues.filter((i) => i.rule === 'tryPromise-without-catch').length).toBe(1);
  });

  it('flags Effect.try(fn) short form', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       declare const compute: () => number;
       export const p = Effect.try(compute);`,
    );
    expect(issues.filter((i) => i.rule === 'tryPromise-without-catch').length).toBe(1);
  });

  it('does not flag Effect.tryPromise({ try, catch })', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.tryPromise({
         try: () => fetch('/x'),
         catch: (e) => e,
       });`,
    );
    expect(issues.filter((i) => i.rule === 'tryPromise-without-catch')).toEqual([]);
  });
});

describe('source-linter: schedule-unbounded (Stream context suppression)', () => {
  it('does not flag Schedule.spaced inside Stream.repeat', () => {
    const { issues } = lintSourceCode(
      `import { Schedule, Stream, Duration } from 'effect';
       export const heartbeat = Stream.repeat(
         Stream.succeed(1),
         Schedule.spaced(Duration.seconds(30)),
       );`,
    );
    expect(issues.filter((i) => i.rule === 'schedule-unbounded')).toEqual([]);
  });

  it('does not flag Schedule.forever inside Stream.fromSchedule', () => {
    const { issues } = lintSourceCode(
      `import { Schedule, Stream } from 'effect';
       export const s = Stream.fromSchedule(Schedule.forever);`,
    );
    expect(issues.filter((i) => i.rule === 'schedule-unbounded')).toEqual([]);
  });

  it('still flags Schedule.spaced in Effect.retry context', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Schedule, Duration } from 'effect';
       export const p = Effect.retry(Effect.succeed(1), Schedule.spaced(Duration.seconds(1)));`,
    );
    expect(issues.filter((i) => i.rule === 'schedule-unbounded').length).toBe(1);
  });
});

describe('source-linter: sleep-without-testclock', () => {
  it('flags Effect.sleep in test files when TestClock is not used', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Duration } from 'effect';
       export const t = Effect.sleep(Duration.seconds(1));`,
      'sleep.test.ts',
    );
    expect(issues.filter((i) => i.rule === 'sleep-without-testclock').length).toBe(1);
  });

  it('does not flag when TestClock is present', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Duration, TestClock } from 'effect';
       export const t = Effect.gen(function* () {
         yield* TestClock.adjust(Duration.seconds(1));
         return yield* Effect.sleep(Duration.seconds(1));
       });`,
      'sleep.spec.ts',
    );
    expect(issues.filter((i) => i.rule === 'sleep-without-testclock')).toEqual([]);
  });
});

describe('source-linter: docs + example enrichment', () => {
  it('attaches docsUrl + example to untagged-throw', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.sync(() => { throw new Error('boom'); });`,
    );
    const flagged = issues.find((i) => i.rule === 'untagged-throw');
    expect(flagged?.docsUrl).toBe('https://effect.website/docs/error-management/expected-errors/');
    expect(flagged?.example?.bad).toMatch(/throw new Error/);
    expect(flagged?.example?.good).toMatch(/Data\.TaggedError/);
  });

  it('attaches docsUrl + example to console-log-in-effect', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         console.log('hi');
         return yield* Effect.succeed(1);
       });`,
    );
    const flagged = issues.find((i) => i.rule === 'console-log-in-effect');
    expect(flagged?.docsUrl).toBe('https://effect.website/docs/observability/logging/');
    expect(flagged?.example?.good).toMatch(/Effect\.log/);
  });

  it('attaches docsUrl + example to config-secret-without-redacted', () => {
    const { issues } = lintSourceCode(
      `import { Config } from 'effect';
       export const c = Config.string('API_TOKEN');`,
    );
    const flagged = issues.find((i) => i.rule === 'config-secret-without-redacted');
    expect(flagged?.docsUrl).toBe('https://effect.website/docs/configuration/');
    expect(flagged?.example?.good).toMatch(/Config\.redacted/);
  });

  it('attaches docsUrl + example to schedule-unbounded', () => {
    const { issues } = lintSourceCode(
      `import { Effect, Schedule, Duration } from 'effect';
       export const p = Effect.retry(Effect.succeed(1), Schedule.spaced(Duration.seconds(1)));`,
    );
    const flagged = issues.find((i) => i.rule === 'schedule-unbounded');
    expect(flagged?.docsUrl).toMatch(/scheduling/);
    expect(flagged?.example?.good).toMatch(/Schedule\.recurs|Schedule\.intersect/);
  });

  it('attaches docsUrl + example to barrel-import-from-effect', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.succeed(1);`,
    );
    const flagged = issues.find((i) => i.rule === 'barrel-import-from-effect');
    expect(flagged?.docsUrl).toMatch(/importing-effect/);
    expect(flagged?.example?.good).toMatch(/import \* as Effect/);
  });

  it('every emitted rule id has a docs entry', () => {
    const seenRules = new Set<string>();
    const fixtures = [
      `import { Effect } from 'effect';
       export const a = Effect.fail(new Error('x'));`,
      `import { Effect, Config } from 'effect';
       export const b = Config.string('SECRET');
       export const c = Effect.try(() => 1);
       export const d = pipe(1);`,
      `import { Layer } from 'effect';
       declare const A: Layer.Layer<never>;
       export const L = Layer.merge(A, A);`,
    ];
    for (const code of fixtures) {
      for (const i of lintSourceCode(code).issues) seenRules.add(i.rule);
    }
    for (const rule of seenRules) {
      expect(RULE_DOCS, `missing docs for ${rule}`).toHaveProperty(rule);
    }
  });
});

describe('source-linter: noise-reduction scoping', () => {
  it('does not flag barrel-import-from-effect in test files', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.succeed(1);`,
      '/repo/packages/foo/test/Bar.test.ts',
    );
    expect(issues.filter((i) => i.rule === 'barrel-import-from-effect')).toEqual([]);
  });

  it('does not flag barrel-import-from-effect inside __tests__ dirs', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.succeed(1);`,
      '/repo/src/__tests__/User.ts',
    );
    expect(issues.filter((i) => i.rule === 'barrel-import-from-effect')).toEqual([]);
  });

  it('still flags barrel-import-from-effect in src files', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.succeed(1);`,
      '/repo/packages/foo/src/Bar.ts',
    );
    expect(issues.filter((i) => i.rule === 'barrel-import-from-effect').length).toBe(1);
  });

  it('emits zero issues for .tst.ts dtslint files', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const x = Effect.all({});
       export const y = Effect.fail(new Error('boom'));`,
      '/repo/effect/dtslint/Effect.tst.ts',
    );
    expect(issues).toEqual([]);
  });
});

describe('source-linter: disable pragmas', () => {
  it('honours // eslint-disable-next-line array-push-spread', () => {
    const { issues } = lintSourceCode(
      `export function append(arr: number[], xs: number[]) {
         // eslint-disable-next-line array-push-spread
         arr.push(...xs);
       }`,
    );
    expect(issues.filter((i) => i.rule === 'array-push-spread')).toEqual([]);
  });

  it('honours // eslint-disable-next-line no-restricted-syntax as alias for array-push-spread', () => {
    // The Effect team uses ESLint's `no-restricted-syntax` rule name to
    // suppress the same V8 footgun; we accept it as an alias.
    const { issues } = lintSourceCode(
      `export function append(arr: number[], xs: number[]) {
         // eslint-disable-next-line no-restricted-syntax
         arr.push(...xs);
       }`,
    );
    expect(issues.filter((i) => i.rule === 'array-push-spread')).toEqual([]);
  });

  it('honours // effect-analyzer-disable-next-line for any rule', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         // effect-analyzer-disable-next-line console-log-in-effect
         console.log('intentional');
         return yield* Effect.succeed(1);
       });`,
    );
    expect(issues.filter((i) => i.rule === 'console-log-in-effect')).toEqual([]);
  });

  it('honours // effect-analyzer-disable-next-line with no rule (disables all)', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         // effect-analyzer-disable-next-line
         console.log('intentional');
         return yield* Effect.succeed(1);
       });`,
    );
    expect(issues.filter((i) => i.rule === 'console-log-in-effect')).toEqual([]);
  });

  it('honours trailing // eslint-disable-line', () => {
    const { issues } = lintSourceCode(
      `export function append(arr: number[], xs: number[]) {
         arr.push(...xs); // eslint-disable-line array-push-spread
       }`,
    );
    expect(issues.filter((i) => i.rule === 'array-push-spread')).toEqual([]);
  });

  it('does not suppress other rules when a different rule is disabled', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.gen(function* () {
         // eslint-disable-next-line array-push-spread
         console.log('still flagged');
         return yield* Effect.succeed(1);
       });`,
    );
    expect(issues.filter((i) => i.rule === 'console-log-in-effect').length).toBe(1);
  });
});
