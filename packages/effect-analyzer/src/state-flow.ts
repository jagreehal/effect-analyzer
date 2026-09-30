/**
 * Ref / State Management Analysis (GAP 7)
 *
 * Detects Ref, FiberRef, SynchronizedRef usage and potential race conditions.
 */

import { Option } from "effect"
import type { StaticEffectIR, StaticFlowNode } from "./types"
import { getStaticChildren } from "./types"

// =============================================================================
// Types
// =============================================================================

export interface RefInfo {
  refId: string
  operation: "make" | "get" | "set" | "update" | "modify" | "getAndSet" | "getAndUpdate"
  nodeId: string
  location?: { line: number; column: number }
}

export interface RefMutation {
  refId: string
  nodeId: string
  operation: "set" | "update" | "modify" | "getAndSet" | "getAndUpdate"
}

export interface RaceCondition {
  refId: string
  readerIds: Array<string>
  writerIds: Array<string>
  message: string
}

export interface StateFlowAnalysis {
  refs: Array<RefInfo>
  mutations: Array<RefMutation>
  potentialRaces: Array<RaceCondition>
  stateGraph: Array<{
    refId: string
    readers: Array<string>
    writers: Array<string>
  }>
}

// =============================================================================
// Detection
// =============================================================================

function isRefCallee(callee: string): boolean {
  return (
    callee.startsWith("Ref.") ||
    callee.startsWith("FiberRef.") ||
    callee.startsWith("SynchronizedRef.")
  )
}

function getRefOperation(callee: string): RefInfo["operation"] {
  if (callee.includes("getAndUpdate")) return "getAndUpdate"
  if (callee.includes("getAndSet")) return "getAndSet"
  if (callee.includes("modify")) return "modify"
  if (callee.includes("update")) return "update"
  if (callee.includes(".set")) return "set"
  if (callee.includes(".get")) return "get"
  if (callee.includes("make") || callee.includes("unsafeMake")) return "make"
  return "get"
}

function getRefId(callee: string): string {
  if (callee.startsWith("Ref.")) return "Ref"
  if (callee.startsWith("FiberRef.")) return "FiberRef"
  if (callee.startsWith("SynchronizedRef.")) return "SynchronizedRef"
  return "Ref"
}

const WRITE_OPS = new Set<RefInfo["operation"]>(["set", "update", "modify", "getAndSet", "getAndUpdate"])

// =============================================================================
// Analysis
// =============================================================================

export function analyzeStateFlow(ir: StaticEffectIR): StateFlowAnalysis {
  const refs: Array<RefInfo> = []
  const mutations: Array<RefMutation> = []
  const readersByRef = new Map<string, Array<string>>()
  const writersByRef = new Map<string, Array<string>>()

  function visit(nodes: ReadonlyArray<StaticFlowNode>) {
    for (const node of nodes) {
      if (node.type === "effect") {
        const eff = node
        const callee = eff.callee
        if (isRefCallee(callee)) {
          const refId = getRefId(callee)
          const operation = getRefOperation(callee)
          const info: RefInfo = {
            refId,
            operation,
            nodeId: eff.id
          }
          if (eff.location) info.location = { line: eff.location.line, column: eff.location.column }
          refs.push(info)
          if (WRITE_OPS.has(operation)) {
            mutations.push({
              refId,
              nodeId: eff.id,
              operation: operation as RefMutation["operation"]
            })
            const w = writersByRef.get(refId) ?? []
            w.push(eff.id)
            writersByRef.set(refId, w)
          } else if (operation === "get") {
            const r = readersByRef.get(refId) ?? []
            r.push(eff.id)
            readersByRef.set(refId, r)
          }
        }
      }
      const children = Option.getOrElse(getStaticChildren(node), () => [])
      if (children.length > 0) visit(children)
    }
  }
  visit(ir.root.children)

  const stateGraph = Array.from(
    new Set([...readersByRef.keys(), ...writersByRef.keys()])
  ).map((refId) => ({
    refId,
    readers: readersByRef.get(refId) ?? [],
    writers: writersByRef.get(refId) ?? []
  }))

  const potentialRaces: Array<RaceCondition> = []
  for (const { refId, readers, writers } of stateGraph) {
    if (readers.length > 0 && writers.length > 0) {
      potentialRaces.push({
        refId,
        readerIds: readers,
        writerIds: writers,
        message: `Ref "${refId}" has concurrent readers and writers - consider Ref.modify for atomic updates`
      })
    }
  }

  return {
    refs,
    mutations,
    potentialRaces,
    stateGraph
  }
}
