/** Deep operations over the Effect IR. */

import { Option } from "effect"
import type { StaticEffectIR, StaticFlowNode } from "./types"
import { getStaticChildren } from "./types"

export interface IRVisit {
  readonly node: StaticFlowNode
  readonly parent: StaticFlowNode | undefined
  readonly ancestors: ReadonlyArray<StaticFlowNode>
  readonly index: number
}

export interface IRIndex {
  readonly nodes: ReadonlyArray<StaticFlowNode>
  readonly byId: ReadonlyMap<string, StaticFlowNode>
  readonly parentById: ReadonlyMap<string, StaticFlowNode>
  readonly spanPathById: ReadonlyMap<string, ReadonlyArray<string>>
  readonly idsBySpanPath: ReadonlyMap<string, ReadonlyArray<string>>
}

/** Exhaustive child access with an empty-array identity for leaf nodes. */
export const childrenOf = (node: StaticFlowNode): ReadonlyArray<StaticFlowNode> =>
  Option.getOrElse(getStaticChildren(node), () => [] as const)

/** Depth-first pre-order traversal of an IR forest. */
export const visitIR = (
  roots: ReadonlyArray<StaticFlowNode>,
  visitor: (visit: IRVisit) => void
): void => {
  let index = 0
  const visit = (
    nodes: ReadonlyArray<StaticFlowNode>,
    parent: StaticFlowNode | undefined,
    ancestors: ReadonlyArray<StaticFlowNode>
  ): void => {
    for (const node of nodes) {
      visitor({ node, parent, ancestors, index: index++ })
      visit(childrenOf(node), node, [...ancestors, node])
    }
  }
  visit(roots, undefined, [])
}

export const flattenIR = (
  roots: ReadonlyArray<StaticFlowNode>
): ReadonlyArray<StaticFlowNode> => {
  const nodes: Array<StaticFlowNode> = []
  visitIR(roots, ({ node }) => nodes.push(node))
  return nodes
}

/** Name emitted by Effect's runtime tracer, when statically exact. */
export const runtimeSpanName = (
  node: StaticFlowNode
): string | undefined => {
  if (node.spanName) return node.spanName
  return node.type === "effect" ? node.tracedName : undefined
}

export const runtimeSpanNames = (
  node: StaticFlowNode
): ReadonlyArray<string> => {
  if (node.spanNames && node.spanNames.length > 0) return node.spanNames
  const name = runtimeSpanName(node)
  return name ? [name] : []
}

export const spanPathKey = (path: ReadonlyArray<string>): string => path.join("\u001f")

/** Build all common indexes once for diagnostics, renderers, and overlays. */
export const indexIR = (ir: StaticEffectIR): IRIndex => {
  const nodes: Array<StaticFlowNode> = []
  const byId = new Map<string, StaticFlowNode>()
  const parentById = new Map<string, StaticFlowNode>()
  const spanPathById = new Map<string, ReadonlyArray<string>>()
  const mutableIdsBySpanPath = new Map<string, Array<string>>()

  visitIR(ir.root.children, ({ node, parent, ancestors }) => {
    nodes.push(node)
    byId.set(node.id, node)
    if (parent) parentById.set(node.id, parent)

    const ownNames = runtimeSpanNames(node)
    if (ownNames.length === 0) return
    const ancestorPath = ancestors.flatMap((ancestor) => {
      return runtimeSpanNames(ancestor)
    })
    const path = [...ancestorPath, ...ownNames]
    spanPathById.set(node.id, path)
    for (let i = 1; i <= ownNames.length; i++) {
      const key = spanPathKey([...ancestorPath, ...ownNames.slice(0, i)])
      const ids = mutableIdsBySpanPath.get(key) ?? []
      if (!ids.includes(node.id)) ids.push(node.id)
      mutableIdsBySpanPath.set(key, ids)
    }
  })

  return {
    nodes,
    byId,
    parentById,
    spanPathById,
    idsBySpanPath: mutableIdsBySpanPath
  }
}
