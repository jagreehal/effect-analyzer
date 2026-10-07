import { describe, expect, it } from "vitest"
import { findCycles, getDataFlowOrder, getTransitiveDependencies } from "./data-flow"
import type { DataFlowGraph } from "./data-flow"
import { detectLayerCycles, renderLayerGraphMermaid } from "./layer-graph"
import type { LayerDependencyGraph, LayerNodeInfo } from "./layer-graph"

const layer = (id: string, provides: Array<string>, requires: Array<string>): LayerNodeInfo => ({
  id,
  provides,
  requires,
  lifecycle: "default",
  isMerged: false,
  operationLayerIds: []
})

const flow = (edges: Array<[string, string]>, ids: Array<string>): DataFlowGraph => ({
  nodes: ids.map((id) => ({ id, reads: [] })),
  edges: edges.map(([from, to]) => ({ from, to, key: "k" })),
  producedKeys: new Set(),
  undefinedReads: [],
  duplicateWrites: []
})

const layerGraph = (layers: Array<LayerNodeInfo>): LayerDependencyGraph => {
  const serviceToLayers = new Map<string, Array<string>>()
  const edges: LayerDependencyGraph["edges"] = []
  for (const l of layers) {
    for (const svc of l.provides) {
      serviceToLayers.set(svc, [...(serviceToLayers.get(svc) ?? []), l.id])
      edges.push({ from: l.id, to: svc, kind: "provides" })
    }
    for (const svc of l.requires) edges.push({ from: l.id, to: svc, kind: "requires" })
  }
  return { layers, edges, serviceToLayers }
}

/** n layers that each require every other layer's service. */
const denseLayers = (n: number): LayerDependencyGraph => {
  const ids = Array.from({ length: n }, (_, i) => `L${i}`)
  return layerGraph(ids.map((id) => layer(id, [`S${id}`], ids.filter((o) => o !== id).map((o) => `S${o}`))))
}

describe("detectLayerCycles", () => {
  it("reports a cycle once when one provider supplies several required services", () => {
    const graph = layerGraph([layer("A", ["SA"], ["S1", "S2"]), layer("B", ["S1", "S2"], ["SA"])])
    expect(detectLayerCycles(graph).map((c) => c.path.join(">"))).toEqual(["A>B>A"])
  })

  it("caps enumeration on densely connected layers", () => {
    // 9 fully connected layers have 125,664 elementary cycles
    expect(detectLayerCycles(denseLayers(9))).toHaveLength(100)
    expect(detectLayerCycles(denseLayers(9), 5)).toHaveLength(5)
  })

  it("finds a cycle that re-enters an already-finished layer", () => {
    // A→B→C→A, plus A→D→B→C→A, which re-enters B after B is finished
    const graph: LayerDependencyGraph = {
      layers: [
        layer("A", ["SA"], ["SB", "SD"]),
        layer("B", ["SB"], ["SC"]),
        layer("C", ["SC"], ["SA"]),
        layer("D", ["SD"], ["SB"])
      ],
      edges: [],
      serviceToLayers: new Map()
    }
    const paths = detectLayerCycles(graph).map((c) => c.path.join(">")).sort()
    expect(paths).toEqual(["A>B>C>A", "A>D>B>C>A"])
  })
})

describe("renderLayerGraphMermaid", () => {
  it("marks cycle edges and layers without enumerating cycles", () => {
    const out = renderLayerGraphMermaid(
      layerGraph([layer("A", ["SA"], ["SB"]), layer("B", ["SB"], ["SA"]), layer("C", ["SC"], ["SA"])])
    )
    expect(out).toContain("A -->|⚠ CYCLE| SB")
    expect(out).toContain("B -->|⚠ CYCLE| SA")
    expect(out).toContain("C --> SA")
    expect(out).toContain("class A cycleNode")
    expect(out).not.toContain("class C cycleNode")
  })

  it("renders densely connected layers", () => {
    expect(renderLayerGraphMermaid(denseLayers(9))).toContain("class L8 cycleNode")
  })
})

describe("data-flow graph queries", () => {
  it("caps cycle enumeration and ignores parallel edges", () => {
    const ids = Array.from({ length: 9 }, (_, i) => `s${i}`)
    const dense = flow(ids.flatMap((a) => ids.filter((b) => b !== a).map((b): [string, string] => [a, b])), ids)
    expect(findCycles(dense)).toHaveLength(100)
    expect(findCycles(flow([["a", "b"], ["a", "b"], ["b", "a"]], ["a", "b"]))).toEqual([["a", "b"]])
  })

  it("lists each transitive dependency once", () => {
    // a feeds b and c, both feed d
    const graph = flow([["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]], ["a", "b", "c", "d"])
    expect(getTransitiveDependencies(graph, "d").sort()).toEqual(["a", "b", "c"])
  })

  it("orders steps topologically and ignores the __context__ source", () => {
    const graph = flow([["__context__", "a"], ["a", "b"]], ["a", "b"])
    expect(getDataFlowOrder(graph)).toEqual(["a", "b"])
  })

  it("returns undefined order and reports the cycle when steps loop", () => {
    const graph = flow([["a", "b"], ["b", "a"]], ["a", "b"])
    expect(getDataFlowOrder(graph)).toBeUndefined()
    expect(findCycles(graph)).toEqual([["a", "b"]])
  })
})
