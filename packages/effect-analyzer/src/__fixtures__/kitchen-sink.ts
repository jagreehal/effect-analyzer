/**
 * Kitchen-sink Effect fixture: one file that exercises many analyzer code paths.
 * Use for coverage and sanity checks (analyze this file → rich Mermaid/output).
 */

import {
  Context,
  Effect,
  Layer,
  Stream,
  Schema,
  Schedule,
  Fiber,
  Scope,
} from 'effect';

// -----------------------------------------------------------------------------
// Services
// -----------------------------------------------------------------------------
export class Logger extends Context.Tag('Logger')<
  Logger,
  { readonly info: (msg: string) => Effect.Effect<void> }
>() {}

export class Config extends Context.Tag('Config')<
  Config,
  { readonly get: (key: string) => Effect.Effect<string> }
>() {}

// -----------------------------------------------------------------------------
// Layers
// -----------------------------------------------------------------------------
const LoggerLive = Layer.sync(Logger, () => ({
  info: (msg: string) => Effect.log(msg),
}));
const ConfigLive = Layer.sync(Config, () => ({
  get: (key: string) => Effect.succeed(`value:${key}`),
}));
export const AppLayer = LoggerLive.pipe(
  Layer.merge(ConfigLive),
  Layer.merge(Layer.sync(Logger, () => ({ info: (m: string) => Effect.log(m) }))),
);

// -----------------------------------------------------------------------------
// Programs: gen, services, parallel, race, stream, schema, errors, resource
// -----------------------------------------------------------------------------

export const genWithServices = Effect.gen(function* () {
  const logger = yield* Logger;
  const config = yield* Config;
  yield* logger.info('start');
  const v = yield* config.get('key');
  yield* Effect.log(v);
  return v;
});

export const parallelProgram = Effect.gen(function* () {
  const a = yield* Effect.succeed(1);
  const [x, y, z] = yield* Effect.all([
    Effect.succeed(10),
    Effect.succeed(20),
    Effect.succeed(30),
  ]);
  return a + x + y + z;
});

export const raceProgram = Effect.gen(function* () {
  return yield* Effect.race(
    Effect.succeed('left'),
    Effect.succeed('right'),
  );
});

export const streamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3]).pipe(Stream.map((n) => n * 2));
  return yield* Stream.runCollect(stream);
});

const UserSchema = Schema.Struct({ name: Schema.String, age: Schema.Number });
export const schemaProgram = Effect.gen(function* () {
  return yield* Schema.decode(UserSchema)({ name: 'alice', age: 30 });
});

export const errorHandlingProgram = Effect.gen(function* () {
  return yield* Effect.fail({ _tag: 'Bad' as const });
}).pipe(
  Effect.catchTag('Bad', () => Effect.succeed('recovered')),
  Effect.retry(Schedule.recurs(2)),
  Effect.timeout('10 seconds'),
);

export const resourceProgram = Effect.acquireRelease(
  Effect.sync(() => ({ id: 1 })),
  (r) => Effect.sync(() => {}),
).pipe(
  Effect.flatMap((r) => Effect.succeed(r.id)),
);

export const conditionalProgram = (flag: boolean) =>
  Effect.if(flag, {
    onTrue: () => Effect.succeed('yes'),
    onFalse: () => Effect.succeed('no'),
  });

export const loopProgram = Effect.forEach(
  [1, 2, 3],
  (i) => Effect.log(`item ${i}`),
  { concurrency: 'unbounded' },
);

export const fiberProgram = Effect.gen(function* () {
  const fiber = yield* Effect.fork(Effect.succeed(42));
  return yield* Fiber.join(fiber);
});

export const scopedProgram = Effect.gen(function* () {
  return yield* Effect.acquireRelease(
    Effect.succeed('resource'),
    () => Effect.void,
  ).pipe(Effect.scoped);
});

export const pipeChainProgram = Effect.succeed(1).pipe(
  Effect.map((n) => n + 1),
  Effect.flatMap((n) => Effect.succeed(n * 2)),
  Effect.tap((n) => Effect.log(String(n))),
);

// Single entrypoint for “analyze this file”
export const kitchenSinkMain = genWithServices;
