import { Effect, FiberHandle } from "effect"

export const handleProgram = Effect.gen(function* () {
  const handle = yield* FiberHandle.make()
  yield* FiberHandle.run(handle, Effect.never, { onlyIfMissing: true })
  yield* FiberHandle.run(handle, Effect.succeed(1))
})
