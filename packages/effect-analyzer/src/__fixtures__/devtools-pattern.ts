import { Effect } from "effect"

export const devProgram = Effect.gen(function* () {
  yield* DevTools.layer
  yield* Server.listen({ port: 3000 })
})
