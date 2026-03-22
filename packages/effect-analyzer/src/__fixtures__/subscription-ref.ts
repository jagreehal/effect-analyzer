import { Effect, SubscriptionRef, Stream } from "effect"

export const subRefProgram = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(0)
  yield* SubscriptionRef.set(ref, 42)
  const value = yield* SubscriptionRef.get(ref)
  yield* SubscriptionRef.update(ref, (n) => n + 1)
  const changes = SubscriptionRef.changes(ref)
})
