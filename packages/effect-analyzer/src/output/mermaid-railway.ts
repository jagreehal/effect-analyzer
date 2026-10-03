import { Option } from "effect"
import { ERROR_TAP_TRANSFORMS } from "../analysis-patterns"
import {
  DEFAULT_LABEL_MAX,
  escapeMermaidLabel as escapeLabel,
  extractFunctionName,
  truncateDisplayText
} from "../analysis-utils"
import { splitTopLevelUnion } from "../type-extractor"
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode } from "../types"

interface RailwayStep {
  readonly label: string
  /** A branch returns a plain value: the program can succeed early here. */
  readonly returnsEarly: boolean
  readonly errorTypes: ReadonlyArray<string>
  /** Error taps on this step: what runs on the error rail before it continues. */
  readonly errorTaps: ReadonlyArray<ErrorTap>
}

interface ErrorTap {
  /** The combinator, e.g. `tapError`. */
  readonly op: string
  /** What the tap's callback calls, e.g. `catalog.release`. */
  readonly label: string
}

interface RailwayOptions {
  readonly direction?: "TB" | "LR" | "BT" | "RL"
}

/** Generate a short node ID: A–Z, then A1–Z1, A2–Z2, etc. */
function stepId(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26))
  const cycle = Math.floor(index / 26)
  return cycle === 0 ? letter : `${letter}${cycle}`
}

/** Prefer a TaggedError `_tag` when the signature recorded it. */
function extractErrorTypes(node: StaticFlowNode): ReadonlyArray<string> {
  const signature = node.type === "effect"
    ? node.typeSignature
    : "typeSignature" in node
    ? (node.typeSignature as { errorType?: string; errorTags?: ReadonlyArray<string> } | undefined)
    : undefined

  if (signature?.errorTags && signature.errorTags.length > 0) {
    return signature.errorTags.filter((tag) => tag !== "never")
  }

  const raw = signature?.errorType ??
    (node.type === "effect" ? node.errorType : undefined)

  if (!raw || raw === "never" || raw.trim() === "") return []

  return splitTopLevelUnion(raw).filter((s) => s !== "never")
}

/** Recursively collect error types from a node and its descendants. */
function collectErrorTypes(node: StaticFlowNode): ReadonlyArray<string> {
  const seen = new Set<string>()
  const errors: Array<string> = []

  const visit = (current: StaticFlowNode): void => {
    for (const errorType of extractErrorTypes(current)) {
      if (!seen.has(errorType)) {
        seen.add(errorType)
        errors.push(errorType)
      }
    }

    const children = Option.getOrElse(getStaticChildren(current), () => [])
    for (const child of children) {
      visit(child)
    }
  }

  visit(node)
  return errors
}

/**
 * Railway step label: the callee. A `displayName` is kept unless it already
 * baked in a yield binding (`x <- foo`) or a pipe wrapper.
 */
function computeLabel(node: StaticFlowNode): string {
  const raw = ((): string => {
    if (node.type === "parallel") return node.name ?? "Effect.all"
    if (node.type === "race") return node.name ?? "Effect.race"
    if (node.type === "error-handler") return "Error Handler"
    if (node.type === "retry") return "Retry"
    if (node.type === "conditional") return "Conditional"
    if (node.type === "decision") return node.label || node.condition
    if (node.type === "effect" && node.wrappedCall) return node.wrappedCall
    if (
      node.displayName &&
      !node.displayName.includes(" <- ") &&
      !node.displayName.startsWith("Pipe (")
    ) {
      return node.displayName
    }
    if (node.type === "effect" && node.callee) {
      return extractFunctionName(node.callee)
    }
    if (node.name) return node.name
    return node.type
  })()
  return truncateDisplayText(raw, DEFAULT_LABEL_MAX)
}

/** Transparent: recurse into children, don't show this node itself. */
function isTransparentRailwayNode(node: StaticFlowNode): boolean {
  switch (node.type) {
    case "generator":
    case "pipe":
      return true
    default:
      return false
  }
}

/** Show as a single labeled step — don't recurse into children. */
function isOpaqueRailwayStep(node: StaticFlowNode): boolean {
  switch (node.type) {
    case "loop":
    case "conditional":
    case "decision":
    case "switch":
    case "parallel":
    case "race":
    case "retry":
    case "timeout":
    case "resource":
      return true
    default:
      return false
  }
}

/** Skip entirely — don't show, don't recurse. Shown in other views. */
function isSkippedRailwayNode(node: StaticFlowNode): boolean {
  switch (node.type) {
    case "error-handler":
    case "transform":
    case "stream":
    case "channel":
    case "sink":
    case "concurrency-primitive":
    case "fiber":
    case "interruption":
    case "try-catch":
    case "terminal":
      return true
    default:
      return false
  }
}

/**
 * A declaration rather than a step: a service method definition or a type
 * declaration. Never appears in the railway however it was reached.
 */
function isDefinitionNode(node: StaticFlowNode): boolean {
  if (node.type !== "effect") return false
  const callee = (node as { callee?: string }).callee ?? ""
  return (
    callee === "Effect.fn" ||
    callee.startsWith("Effect.fn(") ||
    callee.startsWith("Schema.") ||
    callee.startsWith("Data.")
  )
}

/**
 * An effect node the source never named — no display name and no variable. On
 * its own that is setup plumbing, not a step the reader cares about.
 */
function isAnonymousEffect(node: StaticFlowNode): boolean {
  if (node.type !== "effect") return false
  const name = node.displayName ?? node.name ?? ""
  return !name || name === node.type
}

/**
 * How the walk reached a node. A generator `yield*` is the program awaiting a
 * step, so it counts whether or not its result was bound to a name; anything
 * else is only a step if the source named it.
 */
type Arrival = { readonly kind: "yielded" } | { readonly kind: "nested" }

const YIELDED: Arrival = { kind: "yielded" }
const NESTED: Arrival = { kind: "nested" }

/**
 * The calls a tap's callback makes, for its label: named effects that aren't
 * Effect's own combinators (`catalog.release`, not `Effect.ignore`).
 */
function describeCallback(callback: StaticFlowNode): string | undefined {
  const calls: Array<string> = []
  const visit = (node: StaticFlowNode): void => {
    if (node.type === "effect" && node.callee && !node.callee.startsWith("Effect.")) {
      const name = extractFunctionName(node.callee)
      if (!calls.includes(name)) calls.push(name)
    }
    for (const child of Option.getOrElse(getStaticChildren(node), () => [])) visit(child)
  }
  visit(callback)
  return calls.length > 0 ? calls.join(", ") : undefined
}

/** `tapError` and friends, and `onError`: what runs on the error rail. */
function asErrorTap(node: StaticFlowNode): ErrorTap | undefined {
  if (node.type === "transform" && ERROR_TAP_TRANSFORMS.has(node.transformType)) {
    return {
      op: node.transformType,
      label: (node.callback && describeCallback(node.callback)) ?? node.transformType
    }
  }
  if (node.type === "resource" && node.resourceOperation === "onError") {
    return { op: "onError", label: describeCallback(node.release) ?? "onError" }
  }
  return undefined
}

interface FlattenedSteps {
  readonly steps: ReadonlyArray<StaticFlowNode>
  readonly errorTaps: ReadonlyMap<StaticFlowNode, ReadonlyArray<ErrorTap>>
}

/** Flatten IR children to a linear list of concrete steps for the railway diagram. */
function flattenNodesToSteps(nodes: ReadonlyArray<StaticFlowNode>): FlattenedSteps {
  const steps: Array<StaticFlowNode> = []
  const errorTaps = new Map<StaticFlowNode, Array<ErrorTap>>()

  const attach = (subject: StaticFlowNode, tap: ErrorTap) =>
    errorTaps.set(subject, [...(errorTaps.get(subject) ?? []), tap])

  const visit = (node: StaticFlowNode, arrival: Arrival): void => {
    if (node.type === "generator") {
      for (const yielded of node.yields) {
        visit(yielded.effect, YIELDED)
      }
      return
    }

    // Transparent: recurse into children (pipe wrappers). The arrival belongs to
    // the pipe's subject — its first child — not to its transformations.
    // An error tap in a pipe hangs off the step the pipe produced: `a.pipe(
    // Effect.tapError(f))` runs f on a's error rail. It is not a step itself.
    if (isTransparentRailwayNode(node)) {
      const children = Option.getOrElse(getStaticChildren(node), () => [])
      const before = steps.length
      children.forEach((child, index) => {
        const tap = index > 0 ? asErrorTap(child) : undefined
        const subject = steps.at(-1)
        if (tap && subject && steps.length > before) {
          attach(subject, tap)
          return
        }
        visit(child, index === 0 ? arrival : NESTED)
      })
      return
    }

    // Data-first error tap: `Effect.tapError(a, f)` / `Effect.onError(a, f)`
    // is a's step with f hanging off it, same as the piped form.
    const tap = asErrorTap(node)
    const tapped = node.type === "transform" ? node.source : node.type === "resource" ? node.acquire : undefined
    if (tap && tapped && tapped.type !== "unknown") {
      const before = steps.length
      visit(tapped, arrival)
      const subject = steps.at(-1)
      if (subject && steps.length > before) attach(subject, tap)
      return
    }

    // acquireUseRelease runs acquire -> use -> release in turn. A scoped
    // acquireRelease releases when its scope closes, after every later step,
    // so only the acquire belongs in the sequence.
    if (node.type === "resource" && node.use !== undefined) {
      for (const phase of [node.acquire, node.use, node.release]) {
        if (phase.type !== "unknown") visit(phase, YIELDED)
      }
      return
    }
    if (node.type === "resource" && node.resourceOperation?.startsWith("acquireRelease")) {
      if (node.acquire.type !== "unknown") visit(node.acquire, YIELDED)
      return
    }

    // Skip entirely: error handlers, transforms, streams, etc.
    if (isSkippedRailwayNode(node)) return

    // Opaque: shown as a single box, never recursed into (loops, conditionals,
    // parallel, race, retry, timeout, other resources).
    if (isOpaqueRailwayStep(node)) {
      steps.push(node)
      return
    }

    // Declarations are never steps; unnamed effects are steps only when a
    // generator awaited them.
    if (isDefinitionNode(node)) return
    if (arrival.kind === "nested" && isAnonymousEffect(node)) return

    steps.push(node)
  }

  for (const node of nodes) {
    visit(node, NESTED)
  }

  return { steps, errorTaps }
}

/** A `return value` (no effect) somewhere inside a decision's branches. */
function hasPlainEarlyReturn(node: StaticFlowNode): boolean {
  if (node.type === "terminal") return node.terminalKind === "return" && !node.value?.length
  return Option.getOrElse(getStaticChildren(node), () => []).some(hasPlainEarlyReturn)
}

/** Build railway step descriptors from flow nodes. */
function buildSteps({ steps, errorTaps }: FlattenedSteps): ReadonlyArray<RailwayStep> {
  return steps.map((node) => ({
    label: computeLabel(node),
    returnsEarly: node.type === "decision" && hasPlainEarlyReturn(node),
    errorTypes: collectErrorTypes(node),
    errorTaps: errorTaps.get(node) ?? []
  }))
}

/**
 * Render a railway-oriented Mermaid flowchart from an Effect IR.
 *
 * Happy path flows left-to-right with `-->|ok|` edges.
 * Steps with typed errors get `-->|err|` branches to error nodes.
 * Error taps (`tapError` and friends) hang off a step's error node as dotted
 * `-.->|tapError|` side branches: they run on the error rail, then it continues.
 */
export function renderRailwayMermaid(
  ir: StaticEffectIR,
  options: RailwayOptions = {}
): string {
  const direction = options.direction ?? "LR"
  const steps = buildSteps(flattenNodesToSteps(ir.root.children))

  if (steps.length === 0) {
    return `flowchart ${direction}\n  Empty((No steps))`
  }

  const lines: Array<string> = [`flowchart ${direction}`]
  const errorLines: Array<string> = []

  const hasPerStepErrors = steps.some((s) => s.errorTypes.length > 0)

  for (let i = 0; i < steps.length; i++) {
    const currentStep = steps[i]
    if (!currentStep) continue
    const id = stepId(i)
    const label = escapeLabel(currentStep.label)

    if (i < steps.length - 1) {
      const nextStep = steps[i + 1]
      if (!nextStep) continue
      const nextId = stepId(i + 1)
      const nextLabel = escapeLabel(nextStep.label)
      if (i === 0) {
        lines.push(`  ${id}["${label}"] -->|ok| ${nextId}["${nextLabel}"]`)
      } else {
        lines.push(`  ${id} -->|ok| ${nextId}["${nextLabel}"]`)
      }
    } else {
      if (i === 0) {
        lines.push(`  ${id}["${label}"] -->|ok| Done((Success))`)
      } else {
        lines.push(`  ${id} -->|ok| Done((Success))`)
      }
    }
  }

  if (hasPerStepErrors) {
    for (let i = 0; i < steps.length; i++) {
      const currentStep = steps[i]
      if (!currentStep) continue
      const { errorTypes } = currentStep
      if (errorTypes.length === 0) continue

      const id = stepId(i)
      const errId = `${id}E`
      const errLabel = escapeLabel(errorTypes.join(" / "))
      errorLines.push(`  ${id} -->|err| ${errId}["${errLabel}"]`)
    }
  } else if (ir.root.errorTypes.length > 0) {
    const lastId = stepId(steps.length - 1)
    const errLabel = escapeLabel(ir.root.errorTypes.join(" / "))
    errorLines.push(`  ${lastId} -->|err| Errors["${errLabel}"]`)
  }

  steps.forEach((step, i) => {
    if (step.returnsEarly) errorLines.push(`  ${stepId(i)} -.->|early return| Done`)
  })

  // Error taps branch from the step's error node, or from the step when it has
  // no typed errors to draw.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (!step) continue
    const id = stepId(i)
    const from = hasPerStepErrors && step.errorTypes.length > 0 ? `${id}E` : id
    step.errorTaps.forEach((tap, t) => {
      errorLines.push(`  ${from} -.->|${tap.op}| ${id}T${t}["${escapeLabel(tap.label)}"]`)
    })
  }

  return [...lines, ...errorLines].join("\n")
}
