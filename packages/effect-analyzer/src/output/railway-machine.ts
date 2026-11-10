/**
 * Railway Effect IR → StateMachine.
 *
 * Same step model as Mermaid railway (`railwayStepsOf`): happy-path `ok`
 * edges, per-step `err` finals, early-return to Success, and error taps as
 * side transitions off the error (or step) node. `toMachineJSON` turns the
 * result into XState v6 MachineJSON.
 */

import type { StateMachine, StateTransition } from "../state-machine"
import type { StaticEffectIR } from "../types"
import { type RailwayStep, railwayStepsOf } from "./railway-steps"

const SUCCESS = "Success"
const PROGRAM_ERRORS = "Errors"

/** Flat state key: no dots (nestStates would treat them as hierarchy). */
function stateKey(label: string, index: number, used: Set<string>): string {
  let base = label.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || `step_${index}`
  if (/^\d/.test(base)) base = `s_${base}`
  let key = base
  let n = 2
  while (used.has(key)) {
    key = `${base}_${n++}`
  }
  used.add(key)
  return key
}

function tapKey(stepKey: string, tapLabel: string, tapIndex: number, used: Set<string>): string {
  const fromLabel = tapLabel.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || `tap_${tapIndex}`
  return stateKey(`${stepKey}_${fromLabel}`, tapIndex, used)
}

/**
 * Build a StateMachine from a railway-shaped Effect IR program.
 * Returns `undefined` when the program has no railway steps.
 */
export function irToStateMachine(ir: StaticEffectIR): StateMachine | undefined {
  const steps = railwayStepsOf(ir.root.children)
  if (steps.length === 0) return undefined

  const used = new Set<string>([SUCCESS, PROGRAM_ERRORS])
  const stepKeys = steps.map((step, i) => stateKey(step.label, i, used))

  const states: Array<string> = [...stepKeys, SUCCESS]
  const transitions: Array<StateTransition> = []
  const finalStates: Array<string> = [SUCCESS]
  const stateTags: Record<string, ReadonlyArray<string>> = {}
  stateTags[SUCCESS] = ["success"]

  const hasPerStepErrors = steps.some((s) => s.errorTypes.length > 0)

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const from = stepKeys[i]
    if (!step || !from) continue

    const next = i < steps.length - 1 ? stepKeys[i + 1] : SUCCESS
    if (next) {
      transitions.push({ from, event: "ok", to: next })
    }

    if (step.returnsEarly) {
      transitions.push({ from, event: "early return", to: SUCCESS })
    }
  }

  // Per-step error finals when any step has typed errors; else one program-level
  // Errors node off the last step (same as Mermaid railway).
  const errorOf = new Map<string, string>()
  if (hasPerStepErrors) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const from = stepKeys[i]
      if (!step || !from || step.errorTypes.length === 0) continue

      const errLabel = step.errorTypes.length === 1
        ? (step.errorTypes[0] ?? "error")
        : `${from}_error`
      const err = stateKey(errLabel, i, used)
      states.push(err)
      finalStates.push(err)
      stateTags[err] = ["error"]
      transitions.push({ from, event: "err", to: err })
      errorOf.set(from, err)
    }
  } else if (ir.root.errorTypes.length > 0) {
    const last = stepKeys[steps.length - 1]
    if (last) {
      states.push(PROGRAM_ERRORS)
      finalStates.push(PROGRAM_ERRORS)
      stateTags[PROGRAM_ERRORS] = ["error"]
      transitions.push({ from: last, event: "err", to: PROGRAM_ERRORS })
    }
  }

  // Taps hang off the error node when the step has one, else off the step.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const from = stepKeys[i]
    if (!step || !from) continue
    const tapFrom = errorOf.get(from) ?? from
    attachTaps(step, tapFrom, from, used, states, finalStates, stateTags, transitions)
  }

  // XState final states ignore events, so a state with outgoing transitions
  // stays non-final.
  const sources = new Set(transitions.map((t) => t.from))

  const name = ir.root.programName || "railway"
  const events = [...new Set(transitions.map((t) => t.event))]

  return {
    name,
    source: "effect-ir",
    initial: stepKeys[0],
    states,
    transitions,
    location: ir.root.location,
    declaredStates: states,
    declaredEvents: events,
    alphabetSource: undefined,
    finalStates: finalStates.filter((s) => !sources.has(s)),
    stateTags
  }
}

function attachTaps(
  step: RailwayStep,
  from: string,
  stepKey: string,
  used: Set<string>,
  states: Array<string>,
  finalStates: Array<string>,
  stateTags: Record<string, ReadonlyArray<string>>,
  transitions: Array<StateTransition>
): void {
  // Taps chain in callback order; only the last one stays final.
  step.errorTaps.forEach((tap, t) => {
    const to = tapKey(stepKey, tap.label, t, used)
    states.push(to)
    finalStates.push(to)
    stateTags[to] = ["error"]
    // The tap is a state, not an action: machineFromJSON would need an
    // implementation for every named action.
    transitions.push({ from, event: tap.op, to })
    from = to
  })
}

/** Convert every program in a file's IR list that has railway steps. */
export function irsToStateMachines(irs: ReadonlyArray<StaticEffectIR>): ReadonlyArray<StateMachine> {
  return irs.flatMap((ir) => {
    const machine = irToStateMachine(ir)
    return machine ? [machine] : []
  })
}
