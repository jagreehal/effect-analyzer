/**
 * Dense fixture to stretch discovery + labeling + Mermaid readability.
 * Keep this file intentionally varied, not production-polished.
 */

import { Effect, Fiber, Layer, Schedule, STM, Stream, TRef } from 'effect';
import { Effect as E } from 'effect';
import { otherModuleProgram } from './effect-kitchen-sink-other';
import { internalAliasProgram } from './internal/alias';
import {
  AppConfig,
  AppLayer,
  CustomService,
  Db,
  DbLive,
  UserRepo,
} from './services';

const Fx = Effect;
const { gen } = Effect;

// ---------------------------------------------------------------------------
// 1) Entry point shapes
// ---------------------------------------------------------------------------
export const genProgram = Effect.gen(function* () {
  const repo = yield* UserRepo;
  return yield* repo.getUser('u-1');
});

export const pipeProgram = Effect.succeed(1).pipe(
  Effect.map((n) => n + 1),
  Effect.tap((n) => Effect.log(`tap:${n}`)),
  Effect.flatMap((n) => Effect.succeed(n * 2)),
);

export const promiseProgram = Effect.promise(() => Promise.resolve('promised'));

export const syncProgram = Effect.sync(() => 42);

export const runSite = Effect.runPromise(genProgram);

// False friends: not direct entrypoints
export const notAProgram = () => Effect.succeed(1);
export const effectFactory = (n: number) => Effect.succeed(n);

// ---------------------------------------------------------------------------
// 2) Alias + re-export traps
// ---------------------------------------------------------------------------
export const aliasGenProgram = E.gen(function* () {
  return yield* E.succeed('alias-gen');
});

export const destructuredGenProgram = gen(function* () {
  return yield* Effect.succeed('destructured-gen');
});

export const fxGenProgram = Fx.gen(function* () {
  return yield* Fx.succeed('fx-gen');
});

export { genProgram as renamedProgram };
export { otherModuleProgram };
export * from './effect-kitchen-sink-other';

// ---------------------------------------------------------------------------
// 3) Services + provide/provideService + service-call classification
// ---------------------------------------------------------------------------
export const servicePlumbingProgram = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const repo = yield* UserRepo;
  const custom = yield* CustomService;

  const user = yield* repo.getUser(cfg.defaultUserId);
  const profile = yield* custom.buildProfile(user.id);
  yield* repo.saveAudit(`loaded:${profile}`);
  return profile;
});

export const provideServiceProgram = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const repo = yield* UserRepo;
  return yield* repo.getUser(cfg.defaultUserId);
}).pipe(
  Effect.provideService(AppConfig, {
    defaultUserId: 'provided-id',
    retryCount: 1,
  }),
  Effect.provideService(UserRepo, {
    getUser: (id: string) => Effect.succeed({ id, name: `provided:${id}` }),
    saveAudit: () => Effect.void,
  }),
);

// ---------------------------------------------------------------------------
// 4) Error topology
// ---------------------------------------------------------------------------
const unstableLookup = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const repo = yield* UserRepo;
  return yield* repo.getUser(cfg.defaultUserId);
});

export const errorTopologyProgram = unstableLookup.pipe(
  Effect.tapError(() => Effect.log('tapError')),
  Effect.tapErrorCause(() => Effect.log('tapErrorCause')),
  Effect.catchTag('NotFound', () => Effect.succeed({ id: 'fallback', name: 'fallback' })),
  Effect.catchAll(() => Effect.succeed({ id: 'recover', name: 'recover' })),
  Effect.retry(Schedule.recurs(2)),
  Effect.timeout('2 seconds'),
);

// ---------------------------------------------------------------------------
// 5) Concurrency + fibers
// ---------------------------------------------------------------------------
export const concurrencyProgram = Effect.gen(function* () {
  const [a, b] = yield* Effect.all(
    [
      Effect.sleep('1 millis').pipe(Effect.as(1)),
      Effect.sleep('1 millis').pipe(Effect.as(2)),
    ],
    { concurrency: 2 },
  );

  const winner = yield* Effect.race(
    Effect.succeed('fast'),
    Effect.sleep('10 millis').pipe(Effect.as('slow')),
  );

  const fiber = yield* Effect.fork(Effect.succeed(a + b));
  const joined = yield* Fiber.join(fiber);

  return { winner, joined };
});

// ---------------------------------------------------------------------------
// 6) Scoped resources + finalizers
// ---------------------------------------------------------------------------
export const scopedResourceProgram = Effect.scoped(
  Effect.acquireRelease(
    Effect.sync(() => ({ open: true })),
    () => Effect.log('release resource'),
  ).pipe(
    Effect.tap(() => Effect.log('using resource')),
    Effect.ensuring(Effect.log('ensuring finalizer')),
  ),
);

// ---------------------------------------------------------------------------
// 7) Layer graph coverage
// ---------------------------------------------------------------------------
export const LayerGraph = Layer.mergeAll(AppLayer, DbLive);
export const providedProgram = servicePlumbingProgram.pipe(Effect.provide(AppLayer));

// ---------------------------------------------------------------------------
// 8) Stream + Schedule + STM
// ---------------------------------------------------------------------------
export const streamProgram = Stream.fromIterable([1, 2, 3]).pipe(
  Stream.mapEffect((n) => Effect.succeed(n * 2)),
  Stream.runCollect,
);

export const scheduledProgram = pipeProgram.pipe(
  Effect.repeat(Schedule.recurs(3)),
);

export const stmProgram = STM.gen(function* () {
  const ref = yield* TRef.make(0);
  yield* TRef.update(ref, (n) => n + 1);
  return yield* TRef.get(ref);
}).pipe(STM.commit);

// ---------------------------------------------------------------------------
// 9) Control flow in Effect.gen
// ---------------------------------------------------------------------------
export const controlFlowProgram = Effect.gen(function* () {
  const { a, b } = yield* Effect.succeed({ a: 1, b: 2 });

  if (a > 10) {
    return a;
  }

  let total = 0;
  for (const n of [a, b]) {
    total += yield* Effect.succeed(n);
  }

  try {
    yield* Effect.sync(() => {
      throw new Error('boom');
    });
  } catch {
    total += 10;
  }

  const fs = yield* Effect.succeed('fs');
  const fs2 = `${fs}-2`;
  return total + fs2.length;
});

// ---------------------------------------------------------------------------
// 10) Flagship "everything" export
// ---------------------------------------------------------------------------
export const main = Effect.gen(function* () {
  const repo = yield* UserRepo;
  const cfg = yield* AppConfig;
  const custom = yield* CustomService;
  const db = yield* Db;
  const internal = yield* internalAliasProgram;

  const resource = yield* Effect.acquireRelease(
    Effect.sync(() => `resource:${cfg.defaultUserId}`),
    () => repo.saveAudit('release main resource'),
  );

  const user = yield* Effect.race(
    repo.getUser(cfg.defaultUserId),
    Effect.succeed({ id: 'guest', name: 'Guest' }),
  ).pipe(
    Effect.catchTag('NotFound', () => repo.getUser('fallback')),
  );

  const [profile, queryResult] = yield* Effect.all(
    [
      custom.buildProfile(user.id),
      db.query('select 1'),
    ],
    { concurrency: 2 },
  );

  const worker = yield* Effect.fork(custom.doWork(user.id));
  const joined = yield* Fiber.join(worker);

  yield* repo.saveAudit(`done:${resource}:${internal}`);
  yield* Effect.log(`profile=${profile}; query=${queryResult}; joined=${joined}`);

  return { user, profile, queryResult, joined };
}).pipe(
  Effect.retry(Schedule.recurs(1)),
  Effect.timeout('2 seconds'),
  Effect.tapErrorCause(() => Effect.log('main failed')),
  Effect.ensuring(Effect.log('main finalizer')),
  Effect.provide(AppLayer),
);
