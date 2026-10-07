/**
 * Layer Dependency Graph (GAP 2)
 *
 * Collects StaticLayerNode from IR and builds a dependency graph
 * (provides, requires, merge/provide edges) for visualization.
 */

import { createGraph, genCycles, getPathNodes, getStronglyConnectedComponents } from "@statelyai/graph"
import type { Graph } from "@statelyai/graph"
import { Option } from "effect"
import type { StaticEffectIR, StaticFlowNode } from "./types"
import { getStaticChildren } from "./types"

// =============================================================================
// Types
// =============================================================================

export interface LayerNodeInfo {
  id: string
  name?: string
  provides: Array<string>
  requires: Array<string>
  lifecycle: string
  isMerged: boolean
  operationLayerIds: Array<string>
}

export interface LayerGraphEdge {
  from: string
  to: string
  kind: "provides" | "requires" | "merge"
}

export interface LayerDependencyGraph {
  layers: Array<LayerNodeInfo>
  edges: Array<LayerGraphEdge>
  serviceToLayers: Map<string, Array<string>>
}

// =============================================================================
// Collection
// =============================================================================

function collectLayerNodes(
  nodes: ReadonlyArray<StaticFlowNode>,
  result: Array<LayerNodeInfo>
): void {
  for (const node of nodes) {
    if (node.type === "layer") {
      const layer = node
      const info: LayerNodeInfo = {
        id: layer.id,
        provides: [...(layer.provides ?? [])],
        requires: [...(layer.requires ?? [])],
        lifecycle: layer.lifecycle ?? "default",
        isMerged: layer.isMerged,
        operationLayerIds: layer.operations
          .filter((op) => op.type === "layer")
          .map((op) => op.id)
      }
      if (layer.name !== undefined) info.name = layer.name
      result.push(info)
    }
    const children = Option.getOrElse(getStaticChildren(node), () => [])
    if (children.length > 0) collectLayerNodes(children, result)
  }
}

// =============================================================================
// Analysis
// =============================================================================

export function buildLayerDependencyGraph(ir: StaticEffectIR): LayerDependencyGraph {
  const layers: Array<LayerNodeInfo> = []
  collectLayerNodes(ir.root.children, layers)

  const edges: Array<LayerGraphEdge> = []
  const serviceToLayers = new Map<string, Array<string>>()

  for (const layer of layers) {
    for (const depLayerId of layer.operationLayerIds) {
      edges.push({ from: layer.id, to: depLayerId, kind: "merge" })
    }
    for (const svc of layer.provides) {
      const list = serviceToLayers.get(svc) ?? []
      list.push(layer.id)
      serviceToLayers.set(svc, list)
      edges.push({ from: layer.id, to: svc, kind: "provides" })
    }
    for (const req of layer.requires) {
      edges.push({ from: layer.id, to: req, kind: "requires" })
    }
  }

  return { layers, edges, serviceToLayers }
}

// =============================================================================
// Cycle Detection
// =============================================================================

export interface LayerCycle {
  /** Layer IDs forming the cycle (first == last to close the loop) */
  path: Array<string>
}

/**
 * The layer graph as layer → provider-layer edges, one per pair (a layer
 * depends on every layer that provides a service it requires).
 */
export function toLayerDependencyEdges(graph: LayerDependencyGraph): Graph {
  const providerByService = new Map<string, Array<string>>()
  for (const layer of graph.layers) {
    for (const svc of layer.provides) {
      const providers = providerByService.get(svc) ?? []
      providers.push(layer.id)
      providerByService.set(svc, providers)
    }
  }

  const pairs = new Set<string>()
  const edges: Array<{ id: string; sourceId: string; targetId: string }> = []
  for (const layer of graph.layers) {
    for (const req of layer.requires) {
      for (const provider of providerByService.get(req) ?? []) {
        const pair = JSON.stringify([layer.id, provider])
        if (provider !== layer.id && !pairs.has(pair)) {
          pairs.add(pair)
          edges.push({ id: `${edges.length}`, sourceId: layer.id, targetId: provider })
        }
      }
    }
  }

  return createGraph({ nodes: graph.layers.map((layer) => ({ id: layer.id })), edges })
}

/**
 * Detect cycles in the layer provides→requires graph.
 * Returns up to `limit` elementary cycles, each path closed by repeating its first layer.
 */
export function detectLayerCycles(
  graph: LayerDependencyGraph,
  limit = 100
): Array<LayerCycle> {
  const cycles: Array<LayerCycle> = []
  if (limit <= 0) return cycles
  for (const cycle of genCycles(toLayerDependencyEdges(graph))) {
    cycles.push({ path: getPathNodes(cycle).map((node) => node.id) })
    if (cycles.length >= limit) break
  }
  return cycles
}

/** Layers on at least one cycle: members of a strongly connected component larger than one. */
function getLayerCycleComponents(graph: LayerDependencyGraph): Map<string, number> {
  const componentOf = new Map<string, number>()
  getStronglyConnectedComponents(toLayerDependencyEdges(graph))
    .filter((scc) => scc.length > 1)
    .forEach((scc, i) => {
      for (const node of scc) componentOf.set(node.id, i)
    })
  return componentOf
}

// =============================================================================
// Diamond Dependency Detection
// =============================================================================

export interface DiamondDependency {
  serviceId: string
  providers: Array<string>
}

/**
 * Detect diamond dependencies: services reachable through multiple provide paths.
 */
export function detectDiamondDependencies(graph: LayerDependencyGraph): Array<DiamondDependency> {
  const diamonds: Array<DiamondDependency> = []
  for (const [serviceId, providers] of graph.serviceToLayers) {
    if (providers.length > 1) {
      diamonds.push({ serviceId, providers: [...providers] })
    }
  }
  return diamonds
}

// =============================================================================
// Composition Completeness
// =============================================================================

export interface UnsatisfiedService {
  serviceId: string
  requiredBy: Array<string>
}

/**
 * Find services required by layers but not provided by any layer.
 */
export function findUnsatisfiedServices(graph: LayerDependencyGraph): Array<UnsatisfiedService> {
  const allProvided = new Set<string>()
  for (const layer of graph.layers) {
    for (const svc of layer.provides) {
      allProvided.add(svc)
    }
  }

  const unsatisfied = new Map<string, Array<string>>()
  for (const layer of graph.layers) {
    for (const req of layer.requires) {
      if (!allProvided.has(req)) {
        const requiredBy = unsatisfied.get(req) ?? []
        requiredBy.push(layer.id)
        unsatisfied.set(req, requiredBy)
      }
    }
  }

  return Array.from(unsatisfied.entries()).map(([serviceId, requiredBy]) => ({
    serviceId,
    requiredBy
  }))
}

// =============================================================================
// Layer Depth Calculation
// =============================================================================

function computeLayerDepths(graph: LayerDependencyGraph): Map<string, number> {
  const providerByService = new Map<string, Array<string>>()
  for (const layer of graph.layers) {
    for (const svc of layer.provides) {
      const providers = providerByService.get(svc) ?? []
      providers.push(layer.id)
      providerByService.set(svc, providers)
    }
  }

  const depths = new Map<string, number>()
  const visited = new Set<string>()

  function computeDepth(layerId: string): number {
    const cached = depths.get(layerId)
    if (cached !== undefined) return cached
    if (visited.has(layerId)) return 0 // cycle guard
    visited.add(layerId)

    const layer = graph.layers.find((l) => l.id === layerId)
    if (!layer) return 0

    let maxDep = 0
    for (const req of layer.requires) {
      for (const provider of providerByService.get(req) ?? []) {
        if (provider !== layerId) {
          maxDep = Math.max(maxDep, computeDepth(provider) + 1)
        }
      }
    }
    depths.set(layerId, maxDep)
    return maxDep
  }

  for (const layer of graph.layers) {
    computeDepth(layer.id)
  }
  return depths
}

// =============================================================================
// Mermaid output (GAP 2)
// =============================================================================

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_")
}

const DEPTH_COLORS = [
  "#C8E6C9",
  "#A5D6A7",
  "#81C784",
  "#66BB6A",
  "#4CAF50",
  "#43A047",
  "#388E3C",
  "#2E7D32",
  "#1B5E20"
]

export function renderLayerGraphMermaid(graph: LayerDependencyGraph): string {
  const lines: Array<string> = []
  lines.push("graph TD")
  lines.push("")

  // A requires edge is on a cycle when some provider of the service sits in
  // the same component as the requiring layer.
  const componentOf = getLayerCycleComponents(graph)
  const isCycleEdge = (e: LayerGraphEdge): boolean => {
    const component = componentOf.get(e.from)
    return component !== undefined
      && (graph.serviceToLayers.get(e.to) ?? []).some((p) => p !== e.from && componentOf.get(p) === component)
  }

  const depths = computeLayerDepths(graph)

  for (const layer of graph.layers) {
    const label = layer.name ?? layer.id
    lines.push(`  ${sanitizeId(layer.id)}["${label}"]`)
  }
  lines.push("")

  const provided = new Set<string>()
  for (const e of graph.edges) {
    if (e.kind === "provides") provided.add(e.to)
  }
  for (const svc of provided) {
    lines.push(`  ${sanitizeId(svc)}["${svc}"]`)
  }
  lines.push("")

  for (const e of graph.edges) {
    if (e.kind === "provides") {
      lines.push(`  ${sanitizeId(e.from)} -.->|provides| ${sanitizeId(e.to)}`)
    } else if (e.kind === "requires") {
      if (isCycleEdge(e)) {
        lines.push(`  ${sanitizeId(e.from)} -->|⚠ CYCLE| ${sanitizeId(e.to)}`)
      } else {
        lines.push(`  ${sanitizeId(e.from)} --> ${sanitizeId(e.to)}`)
      }
    } else {
      lines.push(`  ${sanitizeId(e.from)} -->|merge| ${sanitizeId(e.to)}`)
    }
  }

  // Color-code layers by depth
  lines.push("")
  lines.push("  %% Depth-based styling")
  const maxDepth = Math.max(...Array.from(depths.values()), 0)
  for (let d = 0; d <= maxDepth && d < DEPTH_COLORS.length; d++) {
    lines.push(`  classDef depth${d} fill:${DEPTH_COLORS[d]},stroke:#333`)
  }
  for (const layer of graph.layers) {
    const depth = Math.min(depths.get(layer.id) ?? 0, DEPTH_COLORS.length - 1)
    lines.push(`  class ${sanitizeId(layer.id)} depth${depth}`)
  }

  // Cycle warning styling
  if (componentOf.size > 0) {
    lines.push("  classDef cycleNode fill:#FFCDD2,stroke:#C62828,stroke-width:3px")
    for (const id of componentOf.keys()) {
      lines.push(`  class ${sanitizeId(id)} cycleNode`)
    }
  }

  return lines.join("\n")
}
