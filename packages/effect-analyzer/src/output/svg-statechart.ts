/**
 * Self-contained SVG statechart renderer, styled after the XState/Stately
 * visualizer: dark canvas, a machine-container box, initial-state dots,
 * blue event "pills" on the edges, and a final-state marker.
 *
 * No external tooling: emits a standalone <svg> (optionally wrapped in HTML).
 * Compound states are drawn as containers around their children, each with
 * its own initial dot; parallel states stack their regions in dashed boxes.
 * Inside every container, siblings are laid out left to right by BFS layer
 * from the container's initial child. Edges connect the real (possibly
 * nested) source and target boxes; edges leaving one state fan out to
 * separate lanes so their pills do not overlap.
 */

import { finalStatesOf } from "../state-machine"
import type { StateMachine } from "../state-machine"
import type { StateMachineCoverage } from "../state-machine-coverage"

interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const C = {
  bg: "#16191f",
  container: "#3a414d",
  compound: "#1b2028",
  title: "#e2e8f0",
  node: "#222831",
  nodeStroke: "#4a5568",
  initStroke: "#4299e1",
  text: "#e2e8f0",
  muted: "#a0aec0",
  edge: "#8a93a2",
  pill: "#2b6cb0",
  pillText: "#ffffff",
  dot: "#cbd5e0",
  unreachable: "#e53e3e",
  undeclared: "#dd6b20",
  warnText: "#feb2b2"
} as const

const NODE_H = 44
const V_GAP = 30
const PAD = 16
const HEADER = 26
const DOT_ROOM = 34
const ORIGIN_X = 84
const ORIGIN_Y = 58

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

const nodeWidth = (label: string): number => Math.max(76, Math.round(label.length * 7.6) + 30)

const pillWidth = (label: string): number => label.length * 6.6 + 18

/** Event label, with a (truncated) guard condition appended when present. */
const eventLabel = (event: string, guard?: string): string => {
  if (!guard) return event
  const g = guard.length > 18 ? `${guard.slice(0, 17)}…` : guard
  return `${event} [${g}]`
}

const leafName = (path: string): string => path.slice(path.lastIndexOf(".") + 1)

/** Vertical centre of a box's first row (its header row when compound). */
const rowY = (box: Box): number => box.y + Math.min(box.h, NODE_H) / 2

function pill(cx: number, cy: number, label: string): string {
  const w = pillWidth(label)
  const h = 19
  return (
    `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${
      w.toFixed(1)
    }" height="${h}" rx="9.5" fill="${C.pill}"/>` +
    `<text x="${cx.toFixed(1)}" y="${
      (cy + 4).toFixed(1)
    }" text-anchor="middle" font-size="11" font-weight="600" fill="${C.pillText}">${esc(label)}</text>`
  )
}

const arrowPath = (d: string, dashed = false): string =>
  `<path d="${d}" fill="none" stroke="${C.edge}" stroke-width="1.5"${
    dashed ? " stroke-dasharray=\"4 3\"" : ""
  } marker-end="url(#arrow)"/>`

const initialDot = (x: number, cy: number, target: number): string =>
  `<circle cx="${x}" cy="${cy}" r="6.5" fill="${C.dot}"/>` +
  `<path d="M ${x + 7} ${cy} L ${target} ${cy}" stroke="${C.edge}" stroke-width="1.5" marker-end="url(#arrow)"/>`

export function renderStatechartSVG(
  machine: StateMachine,
  coverage?: StateMachineCoverage
): string {
  const unreachableSet = new Set(coverage?.unreachableStates ?? [])
  const undeclaredSet = new Set(coverage?.undeclaredStates ?? [])
  // Include declared-but-orphaned states so coverage gaps are visible.
  const states = [
    ...machine.states,
    ...(coverage?.unreachableStates ?? []).filter((s) => !machine.states.includes(s))
  ]
  const stateSet = new Set(states)
  const parallel = new Set(machine.parallelStates ?? [])

  // --- Hierarchy: a state's parent is its longest dotted prefix that is a state.
  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, Array<string>>([["", []]])
  for (const s of states) {
    let parent = ""
    for (let i = s.lastIndexOf("."); i > 0; i = s.lastIndexOf(".", i - 1)) {
      if (stateSet.has(s.slice(0, i))) {
        parent = s.slice(0, i)
        break
      }
    }
    parentOf.set(s, parent)
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), s])
  }
  const children = (s: string): ReadonlyArray<string> => childrenOf.get(s) ?? []

  /** `s` itself, or its ancestor that is a direct child of `container`. */
  const childOfContainerFor = (container: string, s: string): string | undefined => {
    for (let cur: string | undefined = s; cur !== undefined && cur !== ""; cur = parentOf.get(cur)) {
      if (parentOf.get(cur) === container) return cur
    }
    return undefined
  }

  // Initial edges render as dots inside their container.
  const events = machine.transitions.filter((t) => t.trigger !== "initial")
  const initialChild = new Map<string, string>()
  for (const t of machine.transitions) {
    if (t.trigger === "initial" && !parallel.has(t.from)) initialChild.set(t.from, t.to)
  }
  const rootInitial = machine.initial === undefined ? undefined : childOfContainerFor("", machine.initial)
  if (rootInitial !== undefined) initialChild.set("", rootInitial)

  const widestPill = Math.max(40, ...events.map((t) => pillWidth(eventLabel(t.event, t.guard))))
  const hGap = Math.round(widestPill + 56)

  // --- Layout: sizes bottom-up, child offsets relative to their container.
  const size = new Map<string, { readonly w: number; readonly h: number }>()
  const offset = new Map<string, { readonly x: number; readonly y: number }>()

  const layoutChildren = (container: string): { readonly w: number; readonly h: number } => {
    const kids = children(container)
    for (const k of kids) measure(k)
    if (parallel.has(container)) {
      // Regions stack vertically at a shared width.
      const w = Math.max(...kids.map((k) => size.get(k)!.w))
      let y = 0
      for (const k of kids) {
        const h = size.get(k)!.h
        offset.set(k, { x: 0, y })
        size.set(k, { w, h })
        y += h + V_GAP / 2
      }
      return { w, h: y - V_GAP / 2 }
    }
    // Lift event edges to this container's children, then layer by BFS.
    const adj = new Map<string, Array<string>>(kids.map((k) => [k, []]))
    for (const t of events) {
      const a = childOfContainerFor(container, t.from)
      const b = childOfContainerFor(container, t.to)
      if (a !== undefined && b !== undefined && a !== b) adj.get(a)?.push(b)
    }
    const layer = new Map<string, number>()
    const start = initialChild.get(container) ?? kids[0]
    const queue: Array<string> = start !== undefined && adj.has(start) ? [start] : []
    if (start !== undefined) layer.set(start, 0)
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head]!
      for (const v of adj.get(u) ?? []) {
        if (!layer.has(v)) {
          layer.set(v, layer.get(u)! + 1)
          queue.push(v)
        }
      }
    }
    let maxLayer = Math.max(-1, ...layer.values())
    for (const k of kids) if (!layer.has(k)) layer.set(k, ++maxLayer)
    const columns: Array<Array<string>> = Array.from({ length: maxLayer + 1 }, () => [])
    for (const k of kids) columns[layer.get(k)!]?.push(k)

    let x = 0
    let h = 0
    for (const column of columns) {
      const colW = Math.max(0, ...column.map((k) => size.get(k)!.w))
      let y = 0
      for (const k of column) {
        const sz = size.get(k)!
        offset.set(k, { x: x + (colW - sz.w) / 2, y })
        y += sz.h + V_GAP
      }
      h = Math.max(h, y - V_GAP)
      x += colW + hGap
    }
    return { w: Math.max(0, x - hGap), h }
  }

  const measure = (s: string): void => {
    if (children(s).length === 0) {
      size.set(s, { w: nodeWidth(leafName(s)), h: NODE_H })
      return
    }
    const inner = layoutChildren(s)
    const dotRoom = parallel.has(s) ? 0 : DOT_ROOM
    size.set(s, {
      w: Math.max(nodeWidth(leafName(s)), inner.w + 2 * PAD + dotRoom),
      h: inner.h + HEADER + PAD
    })
  }

  const root = layoutChildren("")

  let boxes = new Map<string, Box>()
  const place = (container: string, ox: number, oy: number): void => {
    for (const k of children(container)) {
      const { x, y } = offset.get(k)!
      const box = { x: ox + x, y: oy + y, ...size.get(k)! }
      boxes.set(k, box)
      if (children(k).length > 0) {
        place(k, box.x + PAD + (parallel.has(k) ? 0 : DOT_ROOM), box.y + HEADER)
      }
    }
  }
  place("", ORIGIN_X, ORIGIN_Y)

  // --- Classify edges (positions are relative, so this survives a shift).
  type Edge = { readonly from: string; readonly to: string; readonly label: string }
  const forwardBySource = new Map<string, Array<Edge>>()
  const downward: Array<Edge> = []
  const backBelow: Array<Edge> = []
  const backAbove: Array<Edge> = []
  const selfLoops: Array<Edge> = []

  const lineage = (s: string): Set<string> => {
    const out = new Set<string>()
    for (let cur: string | undefined = s; cur !== undefined && cur !== ""; cur = parentOf.get(cur)) out.add(cur)
    return out
  }
  /** No box other than the edge's own states (and their ancestors) crosses x between y1 and y2. */
  const clear = (x: number, y1: number, y2: number, own: Set<string>): boolean =>
    [...boxes].every(([s, b]) => own.has(s) || x <= b.x || x >= b.x + b.w || b.y >= y2 || b.y + b.h <= y1)

  for (const t of events) {
    const from = boxes.get(t.from)
    const to = boxes.get(t.to)
    if (!from || !to) continue
    const edge = { from: t.from, to: t.to, label: eventLabel(t.event, t.guard) }
    if (t.from === t.to) selfLoops.push(edge)
    else if (to.x >= from.x + from.w + 24) {
      forwardBySource.set(t.from, [...(forwardBySource.get(t.from) ?? []), edge])
    } else if (to.y > from.y) downward.push(edge)
    else {
      // Back-edges go over the top when both vertical runs are unobstructed
      // there, else under the diagram.
      const own = new Set([...lineage(t.from), ...lineage(t.to)])
      const fx = from.x + from.w / 2
      const tx = to.x + to.w / 2
      const above = clear(fx, 0, from.y, own) && clear(tx, 0, to.y, own)
      ;(above ? backAbove : backBelow).push(edge)
    }
  }

  // Make room above the diagram for the over-the-top lanes.
  const topShift = backAbove.length * 22
  if (topShift > 0) {
    boxes = new Map()
    place("", ORIGIN_X, ORIGIN_Y + topShift)
  }
  const box = (s: string): Box => boxes.get(s)!

  // Everything drawn extends the canvas bounds, so nothing is clipped.
  let maxX = ORIGIN_X + root.w
  let maxY = ORIGIN_Y + topShift + root.h
  const grow = (x: number, y: number): void => {
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  const edges: Array<string> = []
  const pills: Array<string> = []
  const addPill = (cx: number, cy: number, label: string): void => {
    pills.push(pill(cx, cy, label))
    grow(cx + pillWidth(label) / 2, cy + 10)
  }

  // Forward edges fan out from the source's right side, one lane each.
  for (const outs of forwardBySource.values()) {
    outs.sort((a, b) => box(a.to).y - box(b.to).y)
    outs.forEach((edge, i) => {
      const from = box(edge.from)
      const to = box(edge.to)
      const label = edge.label
      const sx = from.x + from.w
      const exitY = rowY(from) + (i - (outs.length - 1) / 2) * 19
      const ty = rowY(to)
      const bendX = Math.min(sx + widestPill + 30 + i * 8, to.x - 12)
      edges.push(arrowPath(
        `M ${sx} ${rowY(from)} L ${(sx + 10).toFixed(1)} ${exitY.toFixed(1)} ` +
          `L ${bendX.toFixed(1)} ${exitY.toFixed(1)} L ${bendX.toFixed(1)} ${ty} L ${to.x} ${ty}`
      ))
      addPill(sx + pillWidth(label) / 2 + 16, exitY, label)
    })
  }

  // Downward edges hug the right side, one lane each.
  downward.forEach((edge, lane) => {
    const from = box(edge.from)
    const to = box(edge.to)
    const sx = from.x + from.w
    const tx = to.x + to.w
    const laneX = Math.max(sx, tx) + 22 + lane * 20
    edges.push(arrowPath(
      `M ${sx} ${rowY(from)} L ${laneX.toFixed(1)} ${rowY(from)} L ${laneX.toFixed(1)} ${rowY(to)} L ${tx} ${rowY(to)}`
    ))
    // Pin the pill just under the source box so it reads as that state's
    // edge and clears the forward pills fanning out beside it.
    addPill(laneX, Math.min(from.y + from.h + 14, (rowY(from) + rowY(to)) / 2 + 8), edge.label)
  })

  // Self-transitions loop over the top-right corner of their state.
  selfLoops.forEach(({ from: state, label }, i) => {
    const from = box(state)
    const x1 = from.x + from.w - 30 - i * 6
    const x2 = from.x + from.w - 10
    const top = from.y - 14 - i * 8
    edges.push(arrowPath(`M ${x1} ${from.y} L ${x1} ${top} L ${x2} ${top} L ${x2} ${from.y}`))
    addPill(x2 + pillWidth(label) / 2 + 6, top, label)
  })

  // Back-edges run under the whole diagram, one dashed lane each.
  const backTop = maxY + 26
  backBelow.forEach((edge, lane) => {
    const from = box(edge.from)
    const to = box(edge.to)
    const label = edge.label
    const sx = from.x + from.w / 2
    const tx = to.x + to.w / 2
    const y = backTop + lane * 22
    edges.push(arrowPath(`M ${sx} ${from.y + from.h} L ${sx} ${y} L ${tx} ${y} L ${tx} ${to.y + to.h}`, true))
    addPill((sx + tx) / 2, y, label)
  })

  // ...or over the top, nearest lane first.
  backAbove.forEach((edge, lane) => {
    const from = box(edge.from)
    const to = box(edge.to)
    const sx = from.x + from.w / 2
    const tx = to.x + to.w / 2
    const y = ORIGIN_Y + topShift - 20 - lane * 22
    edges.push(arrowPath(`M ${sx} ${from.y} L ${sx} ${y} L ${tx} ${y} L ${tx} ${to.y}`, true))
    addPill((sx + tx) / 2, y, edge.label)
  })

  // --- Nodes: a container paints before its children.
  const finals = finalStatesOf(machine)
  // Containers paint under the edges; leaves, dots and labels on top.
  const containers: Array<string> = []
  const nodes: Array<string> = []
  const drawNode = (s: string): void => {
    const box = boxes.get(s)!
    const compound = children(s).length > 0
    const isUnreachable = unreachableSet.has(s)
    const isUndeclared = undeclaredSet.has(s)
    const isInitial = s === machine.initial
    const stroke = isUnreachable
      ? C.unreachable
      : isUndeclared
      ? C.undeclared
      : isInitial
      ? C.initStroke
      : C.nodeStroke
    const sw = isInitial || isUnreachable || isUndeclared ? 2 : 1.4
    const dashed = isUnreachable || parallel.has(parentOf.get(s) ?? "")
    ;(compound ? containers : nodes).push(
      `<rect x="${box.x.toFixed(1)}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="${
        compound ? C.compound : C.node
      }" stroke="${stroke}" stroke-width="${sw}"${dashed ? " stroke-dasharray=\"5 3\"" : ""}/>`
    )
    if (finals.has(s)) {
      nodes.push(
        `<rect x="${(box.x + 4).toFixed(1)}" y="${box.y + 4}" width="${box.w - 8}" height="${
          box.h - 8
        }" rx="6" fill="none" stroke="${C.nodeStroke}" stroke-width="1.2"/>`
      )
    }
    grow(box.x + box.w, box.y + box.h)
    if (!compound) {
      nodes.push(
        `<text x="${(box.x + box.w / 2).toFixed(1)}" y="${
          (box.y + box.h / 2 + 4).toFixed(1)
        }" text-anchor="middle" font-size="13" font-weight="600" fill="${C.text}">${esc(leafName(s))}</text>`
      )
      return
    }
    containers.push(
      `<text x="${(box.x + 12).toFixed(1)}" y="${box.y + 18}" font-size="12" font-weight="700" fill="${C.muted}">${
        esc(leafName(s))
      }${parallel.has(s) ? " (parallel)" : ""}</text>`
    )
    const first = initialChild.get(s)
    const firstBox = first === undefined ? undefined : boxes.get(first)
    if (firstBox) nodes.push(initialDot(firstBox.x - 26, rowY(firstBox), firstBox.x))
    for (const k of children(s)) drawNode(k)
  }
  for (const s of children("")) drawNode(s)

  const rootBox = rootInitial === undefined ? undefined : boxes.get(rootInitial)
  const initialMarker = rootBox ? initialDot(rootBox.x - 30, rowY(rootBox), rootBox.x) : ""

  const unhandled = coverage?.unhandledEvents ?? []
  const W = Math.round(maxX + 36)
  const boxH = Math.round(maxY + 40)
  const footerH = unhandled.length > 0 ? 26 : 0
  const H = boxH + footerH
  const footer = footerH > 0
    ? `<text x="26" y="${boxH + 16}" font-size="12" font-weight="600" fill="${C.warnText}">⚠ Unhandled events: ${
      esc(unhandled.join(", "))
    }</text>`
    : ""
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">`,
    `  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${C.edge}"/></marker></defs>`,
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/>`,
    `  <rect x="12" y="26" width="${W - 24}" height="${
      boxH - 38
    }" rx="10" fill="none" stroke="${C.container}" stroke-width="1.5"/>`,
    `  <text x="26" y="20" font-size="13" font-weight="700" fill="${C.title}">${esc(machine.name)}</text>`,
    ...containers.map((n) => "  " + n),
    ...edges.map((e) => "  " + e),
    ...nodes.map((n) => "  " + n),
    initialMarker ? "  " + initialMarker : "",
    ...pills.map((p) => "  " + p),
    footer ? "  " + footer : "",
    "</svg>"
  ]
    .filter(Boolean)
    .join("\n")
}

/** Wrap one or more SVG diagrams in a minimal dark HTML page (for viewing). */
export function renderStatechartHTML(svgs: ReadonlyArray<string>): string {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    `<style>body{margin:0;background:${C.bg};display:flex;flex-direction:column;align-items:flex-start;gap:24px;padding:24px;}</style>`,
    "</head><body>",
    ...svgs,
    "</body></html>"
  ].join("\n")
}
