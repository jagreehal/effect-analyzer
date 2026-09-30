import { describe, expect, it } from "vitest"
import { isTrivialProgram } from "./trivial-programs"
import type { StaticEffectIR } from "./types"

const stats = {
  totalEffects: 0,
  parallelCount: 0,
  raceCount: 0,
  errorHandlerCount: 0,
  retryCount: 0,
  timeoutCount: 0,
  resourceCount: 0,
  loopCount: 0,
  conditionalCount: 0,
  layerCount: 0,
  unknownCount: 0,
  interruptionCount: 0,
  decisionCount: 0,
  switchCount: 0
}

const ir = (
  source: StaticEffectIR["root"]["source"],
  children: StaticEffectIR["root"]["children"] = []
): StaticEffectIR => ({
  root: {
    id: "p",
    type: "program",
    programName: "p",
    source,
    children,
    dependencies: [],
    errorTypes: []
  },
  metadata: { analyzedAt: 0, filePath: "t.ts", stats },
  references: new Map()
})

describe("isTrivialProgram", () => {
  it("treats Effect.runPromise entrypoints as trivial", () => {
    expect(isTrivialProgram(ir("run", [{
      id: "n1",
      type: "effect",
      callee: "Effect.runPromise"
    }]))).toBe(true)
  })

  it("keeps a generator workflow", () => {
    expect(isTrivialProgram(ir("generator", [{
      id: "g",
      type: "generator",
      yields: []
    }]))).toBe(false)
  })

  it("treats a single leaf call as trivial", () => {
    expect(isTrivialProgram(ir("direct", [{ id: "e", type: "effect", callee: "Effect.succeed" }]))).toBe(true)
  })

  it("treats a single layer as trivial", () => {
    expect(isTrivialProgram(ir("direct", [{ id: "l", type: "layer" } as StaticEffectIR["root"]["children"][number]])))
      .toBe(true)
  })

  it("keeps a direct program whose one child is a pipe or stream", () => {
    for (const type of ["pipe", "stream"] as const) {
      expect(isTrivialProgram(ir("direct", [{ id: "c", type } as StaticEffectIR["root"]["children"][number]]))).toBe(
        false
      )
    }
  })
})
