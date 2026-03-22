import { Effect } from "effect"

export const program = Effect.gen(function* () {
  // Effect.fn call
  const result = yield* Effect.fn("myTracedFunction")(function* () {
    yield* Effect.succeed(42)
  })
  // Effect.fnUntraced call
  const result2 = yield* Effect.fnUntraced("myUntracedFn")(function* () {
    yield* Effect.fail("error")
  })
  // Constructor kinds used in calls
  const nullable = yield* Effect.fromNullable(null)
  yield* Effect.succeed("hello")
  yield* Effect.sync(() => 1)
  yield* Effect.promise(() => Promise.resolve(1))
})
