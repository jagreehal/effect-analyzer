import { describe, it, expect } from 'vitest';
import { lintSourceCode } from './source-linter';

describe('source-linter: untagged-throw', () => {
  it('flags throw new Error inside Effect.try', () => {
    const { issues } = lintSourceCode(
      `import { Effect } from 'effect';
       export const p = Effect.try({
         try: () => { throw new Error('boom'); },
         catch: (e) => e,
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
