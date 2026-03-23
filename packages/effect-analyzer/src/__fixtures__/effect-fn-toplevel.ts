import { Effect } from "effect"

// Top-level Effect.fn with generator body containing multiple yields
export const processOrder = Effect.fn("processOrder")(function* (input: { orderId: string }) {
  const validated = yield* Effect.succeed({ orderId: input.orderId, valid: true })
  yield* Effect.log(`Processing order ${validated.orderId}`)
  const result = yield* Effect.tryPromise(() => Promise.resolve({ status: "completed" }))
  return result
})

// Top-level Effect.fn with service call inside
export const fetchUser = Effect.fn("fetchUser")(function* (userId: string) {
  yield* Effect.succeed(userId)
  yield* Effect.fail("not found")
})
