import { Effect } from "effect"

class NotFoundError {
  readonly _tag = "NotFoundError"
}

// Exported function that returns Effect.succeed/Effect.fail
export function requireItem(
  items: readonly string[],
  itemId: string,
): Effect.Effect<string, NotFoundError> {
  const item = items.find((i) => i === itemId)
  if (item) {
    return Effect.succeed(item)
  }
  return Effect.fail(new NotFoundError())
}

// Another exported function returning Effect
export function validateInput(input: string): Effect.Effect<string> {
  if (input.length === 0) {
    return Effect.fail("empty input")
  }
  return Effect.succeed(input.trim())
}
