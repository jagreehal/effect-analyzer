/**
 * Effect.gen Yield Analysis Enhancement (GAP 28)
 *
 * Tracks variable bindings from yields and data flow through generator.
 */

import { Option } from "effect"
import type { StaticEffectIR, StaticFlowNode } from "./types"
import { getStaticChildren } from "./types"

// =============================================================================
// Types
// =============================================================================

export interface YieldBinding {
  readonly yieldIndex: number
  readonly variableName?: string
  readonly effectCallee?: string
  readonly nodeId: string
}

export interface GenYieldAnalysis {
  readonly bindings: Array<YieldBinding>
  readonly unusedYieldIndices: Array<number>
  readonly serviceYields: Array<string>
}

function collectBindings(
  nodes: ReadonlyArray<StaticFlowNode>,
  bindings: Array<YieldBinding>,
  serviceYields: Array<string>,
  index: { current: number }
): void {
  for (const node of nodes) {
    if (node.type === "generator") {
      const gen = node
      for (const y of gen.yields) {
        const callee = y.effect.type === "effect" ? y.effect.callee : undefined
        const binding: YieldBinding = {
          yieldIndex: index.current++,
          nodeId: y.effect.id,
          ...(y.variableName !== undefined && { variableName: y.variableName }),
          ...(callee !== undefined && { effectCallee: callee })
        }
        bindings.push(binding)
        if (callee?.includes("service") || callee?.includes("Context")) {
          serviceYields.push(callee)
        }
      }
      const children = Option.getOrElse(getStaticChildren(node), () => [])
      collectBindings(children, bindings, serviceYields, index)
    } else {
      const children = Option.getOrElse(getStaticChildren(node), () => [])
      collectBindings(children, bindings, serviceYields, index)
    }
  }
}

/**
 * Analyze yield bindings and service usage in a generator program.
 */
export function analyzeGenYields(ir: StaticEffectIR): GenYieldAnalysis {
  const bindings: Array<YieldBinding> = []
  const serviceYields: Array<string> = []
  collectBindings(ir.root.children, bindings, serviceYields, { current: 0 })
  const usedIndices = new Set<number>()
  for (const b of bindings) {
    if (b.variableName && !b.variableName.startsWith("_")) usedIndices.add(b.yieldIndex)
  }
  const unusedYieldIndices = bindings.map((b) => b.yieldIndex).filter((i) => !usedIndices.has(i))
  return {
    bindings,
    unusedYieldIndices,
    serviceYields: [...new Set(serviceYields)]
  }
}
