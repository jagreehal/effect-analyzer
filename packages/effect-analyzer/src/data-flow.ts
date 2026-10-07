/**
 * Data Flow Analysis for Effect IR
 *
 * Builds a graph of value and service dependencies between effect nodes:
 * - Value flow: sequential edges from one effect to the next in execution order
 * - Service reads: effect nodes that require services from Context
 */

import { createGraph, genBFS, genCycles, getPathNodes, getTopologicalSort } from "@statelyai/graph"
import type { Graph } from "@statelyai/graph"
import { Option } from "effect"
import type { StaticEffectIR, StaticEffectNode, StaticFlowNode } from "./types"
import { getStaticChildren } from "./types"

// =============================================================================
// Types
// =============================================================================

export interface DataFlowNode {
  id: string
  name?: string | undefined
  /** Success type this effect produces (writes) */
  writes?: string | undefined
  /** Service IDs this effect reads from Context */
  reads: Array<string>
  location?: { line: number; column: number } | undefined
}

export interface DataFlowEdge {
  from: string
  to: string
  key: string
}

export interface DataFlowGraph {
  nodes: Array<DataFlowNode>
  edges: Array<DataFlowEdge>
  producedKeys: Set<string>
  undefinedReads: Array<UndefinedRead>
  duplicateWrites: Array<DuplicateWrite>
}

export interface UndefinedRead {
  key: string
  readerId: string
  readerName?: string | undefined
}

export interface DuplicateWrite {
  key: string
  writerIds: Array<string>
}

// =============================================================================
// Execution-order collection (effect nodes only, sequential flow)
// =============================================================================

function collectEffectNodesInOrder(
  nodes: ReadonlyArray<StaticFlowNode>,
  result: Array<StaticEffectNode>
): void {
  for (const node of nodes) {
    if (node.type === "effect") {
      result.push(node)
    }
    const children = Option.getOrElse(getStaticChildren(node), () => [])
    if (children.length > 0) {
      collectEffectNodesInOrder(children, result)
    }
  }
}

// =============================================================================
// Graph Building
// =============================================================================

export function buildDataFlowGraph(ir: StaticEffectIR): DataFlowGraph {
  const nodes: Array<DataFlowNode> = []
  const edges: Array<DataFlowEdge> = []
  const producedKeys = new Set<string>()
  const keyProducers = new Map<string, Array<string>>()
  const effectNodesOrdered: Array<StaticEffectNode> = []

  collectEffectNodesInOrder(ir.root.children, effectNodesOrdered)

  for (const eff of effectNodesOrdered) {
    const writes = eff.typeSignature?.successType
    const reads = (eff.requiredServices ?? []).map((s) => s.serviceId)

    if (writes) {
      producedKeys.add(writes)
      const producers = keyProducers.get(writes) ?? []
      producers.push(eff.id)
      keyProducers.set(writes, producers)
    }

    nodes.push({
      id: eff.id,
      name: eff.callee,
      writes,
      reads,
      location: eff.location
        ? { line: eff.location.line, column: eff.location.column }
        : undefined
    })
  }

  // Value-flow edges: consecutive effects in order
  for (let i = 0; i < effectNodesOrdered.length - 1; i++) {
    const from = effectNodesOrdered[i]
    const to = effectNodesOrdered[i + 1]
    if (from === undefined || to === undefined) continue
    const key = from.typeSignature?.successType ?? "value"
    edges.push({ from: from.id, to: to.id, key })
  }

  // Context -> effect for each required service (virtual "context" source)
  const contextId = "__context__"
  for (const node of nodes) {
    for (const key of node.reads) {
      edges.push({ from: contextId, to: node.id, key })
    }
  }

  const undefinedReads: Array<UndefinedRead> = []
  for (const node of nodes) {
    for (const key of node.reads) {
      if (!producedKeys.has(key) && key !== contextId) {
        undefinedReads.push({
          key,
          readerId: node.id,
          readerName: node.name
        })
      }
    }
  }

  const duplicateWrites: Array<DuplicateWrite> = []
  for (const [key, writers] of keyProducers) {
    if (writers.length > 1) {
      duplicateWrites.push({ key, writerIds: writers })
    }
  }

  return {
    nodes,
    edges,
    producedKeys,
    undefinedReads,
    duplicateWrites
  }
}

// =============================================================================
// Analysis Utilities
// =============================================================================

/** Step dependencies as a graph, without the implicit `__context__` source; one edge per step pair. */
function toStepGraph(graph: DataFlowGraph): Graph {
  const ids = new Set(graph.nodes.map((node) => node.id))
  const pairs = new Set<string>()
  const edges: Array<{ id: string; sourceId: string; targetId: string }> = []
  for (const edge of graph.edges) {
    const pair = JSON.stringify([edge.from, edge.to])
    if (ids.has(edge.from) && ids.has(edge.to) && !pairs.has(pair)) {
      pairs.add(pair)
      edges.push({ id: `${edges.length}`, sourceId: edge.from, targetId: edge.to })
    }
  }
  return createGraph({ nodes: graph.nodes.map((node) => ({ id: node.id })), edges })
}

export function getDataFlowOrder(
  graph: DataFlowGraph
): Array<string> | undefined {
  return getTopologicalSort(toStepGraph(graph))?.map((node) => node.id)
}

export function getProducers(
  graph: DataFlowGraph,
  stepId: string
): Array<DataFlowNode> {
  const producerIds = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.to === stepId && edge.from !== "__context__") {
      producerIds.add(edge.from)
    }
  }
  return graph.nodes.filter((n) => producerIds.has(n.id))
}

export function getConsumers(
  graph: DataFlowGraph,
  stepId: string
): Array<DataFlowNode> {
  const consumerIds = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.from === stepId) {
      consumerIds.add(edge.to)
    }
  }
  return graph.nodes.filter((n) => consumerIds.has(n.id))
}

export function getTransitiveDependencies(
  graph: DataFlowGraph,
  stepId: string
): Array<string> {
  return [...genBFS(toStepGraph(graph), { from: stepId, direction: "incoming" })]
    .map((node) => node.id)
    .filter((id) => id !== stepId)
}

/** Returns up to `limit` circular dependencies. */
export function findCycles(graph: DataFlowGraph, limit = 100): Array<Array<string>> {
  const cycles: Array<Array<string>> = []
  if (limit <= 0) return cycles
  for (const cycle of genCycles(toStepGraph(graph))) {
    cycles.push(getPathNodes(cycle).slice(0, -1).map((node) => node.id))
    if (cycles.length >= limit) break
  }
  return cycles
}

// =============================================================================
// Validation
// =============================================================================

export interface DataFlowValidation {
  valid: boolean
  issues: Array<DataFlowIssue>
}

export interface DataFlowIssue {
  severity: "error" | "warning"
  type: "undefined-read" | "duplicate-write" | "cycle"
  message: string
  stepIds: Array<string>
  key?: string
}

export function validateDataFlow(graph: DataFlowGraph): DataFlowValidation {
  const issues: Array<DataFlowIssue> = []

  for (const read of graph.undefinedReads) {
    issues.push({
      severity: "warning",
      type: "undefined-read",
      message: `Effect "${read.readerName ?? read.readerId}" reads "${read.key}" which is never produced`,
      stepIds: [read.readerId],
      key: read.key
    })
  }

  for (const write of graph.duplicateWrites) {
    issues.push({
      severity: "warning",
      type: "duplicate-write",
      message: `Key "${write.key}" is written by multiple effects: ${write.writerIds.join(", ")}`,
      stepIds: write.writerIds,
      key: write.key
    })
  }

  const cycles = findCycles(graph)
  for (const cycle of cycles) {
    issues.push({
      severity: "error",
      type: "cycle",
      message: `Circular data dependency: ${cycle.join(" -> ")}`,
      stepIds: cycle
    })
  }

  return {
    valid: issues.length === 0,
    issues
  }
}

// =============================================================================
// Rendering
// =============================================================================

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_")
}

export function renderDataFlowMermaid(graph: DataFlowGraph): string {
  const lines: Array<string> = []

  lines.push("flowchart LR")
  lines.push("")
  lines.push("  %% Data Flow Graph")
  lines.push("")

  for (const node of graph.nodes) {
    const label = node.name ?? node.id
    const writes = node.writes ? ` [out: ${node.writes}]` : ""
    lines.push(`  ${sanitizeId(node.id)}["${label}${writes}"]`)
  }

  lines.push("")

  for (const edge of graph.edges) {
    if (edge.from === "__context__") continue
    lines.push(
      `  ${sanitizeId(edge.from)} -->|${edge.key}| ${sanitizeId(edge.to)}`
    )
  }

  if (graph.undefinedReads.length > 0) {
    lines.push("")
    lines.push("  %% Undefined Reads (warnings)")
    for (const read of graph.undefinedReads) {
      const warningId = `undefined_${sanitizeId(read.key)}`
      lines.push(`  ${warningId}[/"${read.key} (undefined)"/]`)
      lines.push(`  ${warningId} -.-> ${sanitizeId(read.readerId)}`)
    }
    lines.push("")
    lines.push("  classDef warning fill:#fff3cd,stroke:#856404")
    for (const read of graph.undefinedReads) {
      lines.push(`  class undefined_${sanitizeId(read.key)} warning`)
    }
  }

  return lines.join("\n")
}
