import { escapeMermaidLabel as escapeLabel } from "../analysis-utils"
import type { StaticEffectIR } from "../types"
import { railwayStepsOf } from "./railway-steps"

interface RailwayOptions {
  readonly direction?: "TB" | "LR" | "BT" | "RL"
}

/** Generate a short node ID: A–Z, then A1–Z1, A2–Z2, etc. */
function stepId(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26))
  const cycle = Math.floor(index / 26)
  return cycle === 0 ? letter : `${letter}${cycle}`
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
  const steps = railwayStepsOf(ir.root.children)

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
