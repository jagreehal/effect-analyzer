import { createGraph, getStronglyConnectedComponents } from "@statelyai/graph"
import type { ProjectServiceMap } from "./types"

export interface ServiceCycle {
  readonly services: ReadonlyArray<string>
  readonly size: number
}

export const detectServiceCycles = (serviceMap: ProjectServiceMap): ReadonlyArray<ServiceCycle> => {
  const edges: Array<{ id: string; sourceId: string; targetId: string }> = []
  for (const [serviceId, artifact] of serviceMap.services) {
    for (const dep of artifact.dependencies) {
      if (serviceMap.services.has(dep)) edges.push({ id: `${edges.length}`, sourceId: serviceId, targetId: dep })
    }
  }
  const graph = createGraph({ nodes: [...serviceMap.services.keys()].map((id) => ({ id })), edges })
  const selfLoops = new Set(edges.filter((e) => e.sourceId === e.targetId).map((e) => e.sourceId))

  return getStronglyConnectedComponents(graph)
    .map((scc) => scc.map((node) => node.id))
    .filter((ids) => ids.length > 1 || selfLoops.has(ids[0]!))
    .map((ids) => ({ services: ids.sort((a, b) => a.localeCompare(b)), size: ids.length }))
    .sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size
      return a.services.join("|").localeCompare(b.services.join("|"))
    })
}
