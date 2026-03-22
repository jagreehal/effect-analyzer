import { Effect, pipe, RcRef } from "effect";

// Reloadable from effect uses Context.Tag; use a local mock for analyzer pattern coverage
const Reloadable = {
  make: (e: unknown) => Effect.succeed(null),
  get: (_r: unknown) => Effect.succeed(1),
  reload: (_r: unknown) => Effect.void,
};

const prog = Effect.gen(function* () {
  const ref = yield* RcRef.make({ acquire: Effect.succeed(0) });
  const n = yield* pipe(ref, RcRef.get);
  const rel = yield* Reloadable.make(Effect.succeed(1));
  const v = yield* pipe(rel, Reloadable.get);
  yield* pipe(rel, Reloadable.reload);
  return { n, v };
});
