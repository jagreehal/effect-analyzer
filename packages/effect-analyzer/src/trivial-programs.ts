import type { StaticEffectIR } from "./types"

const COMPOSITE_CHILD_TYPES: ReadonlySet<string> = new Set([
  "pipe",
  "stream",
  "loop",
  "parallel",
  "race",
  "error-handler",
  "retry",
  "timeout"
])

/**
 * Programs the CLI hides by default. Class/schema declarations are not
 * workflows; `Effect.runPromise` and friends are how a test or entrypoint
 * *executes* a workflow, not a second workflow.
 */
export const isTrivialProgram = (ir: StaticEffectIR): boolean => {
  const { source, children } = ir.root
  if (source === "class" || source === "classProperty" || source === "classMethod") {
    return true
  }
  if (source === "run") {
    return true
  }
  if (source === "direct" && children.length === 1 && children[0]?.type === "effect") {
    const callee = (children[0] as { callee?: string }).callee ?? ""
    if (callee.startsWith("Schema.") || callee.startsWith("Data.") || callee === "Service") {
      return true
    }
  }
  // A direct program with one child is trivial unless that child is a whole
  // chain: a pipe, a stream pipeline, a loop, or a handler/resilience wrapper.
  if (source === "direct" && children.length <= 1) {
    return !COMPOSITE_CHILD_TYPES.has(children[0]?.type ?? "")
  }
  return false
}
