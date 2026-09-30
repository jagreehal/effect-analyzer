import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { analyze } from "./analyze"
import { getStaticChildren, isStaticUnknownNode } from "./types"
import type { StaticFlowNode } from "./types"

const collectUnknownReasons = (roots: ReadonlyArray<StaticFlowNode>): Array<string> => {
  const stack: Array<StaticFlowNode> = [...roots]
  const reasons: Array<string> = []
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (isStaticUnknownNode(node)) reasons.push(node.reason)
    stack.push(...Option.getOrElse(getStaticChildren(node), () => [] as ReadonlyArray<StaticFlowNode>))
  }
  return reasons
}

describe("unknown node reasons", () => {
  it("classifies a non-Effect object literal argument instead of the opaque default", async () => {
    const programs = await Effect.runPromise(
      analyze
        .source(`
          import { Context, Effect, Layer } from "effect";
          class Store extends Context.Tag("Store")<Store, { get: () => Effect.Effect<number> }>() {}
          export const StoreLive = Layer.succeed(Store, {
            get: () => Effect.succeed(1),
          });
        `)
        .all
    )

    const reasons = programs.flatMap((ir) => collectUnknownReasons([ir.root]))

    expect(reasons).toContain("Non-Effect object literal (e.g. service impl or options argument)")
    expect(reasons).not.toContain("Could not determine effect type")
  })
})
