/**
 * XState v6 MachineJSON emitter.
 *
 * MachineJSON is v6's machine-as-data format: `machineToJSON` writes it and
 * `machineFromJSON(json, { guards, actions, actors })` loads it. Guards, actions
 * and invoked actors stay named (`{ type: 'hasItems' }`), so the caller supplies
 * the implementations. `fromMachineJSON` reads the same shape back.
 *
 * For stately.ai/viz, which runs XState v5, use `renderXStateConfig`.
 */

import { finalStatesOf, nestStates } from "../state-machine"
import type { StateMachine, StateTransition } from "../state-machine"
import { DONE_STATE_EVENT } from "../state-machine-json"
import type {
  MachineJSON,
  MachineJSONInvoke,
  MachineJSONStateNode,
  MachineJSONTransition,
  MachineJSONValue
} from "../state-machine-json"
import { dedupe } from "./xstate-config"

const parentOf = (path: string): string => path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : ""
const keyOf = (path: string): string => path.split(".").pop() ?? path

/** `after 5000ms` → `5000`; `after PT1M` → `PT1M`. */
const delayKey = (event: string): string => {
  const raw = event.replace(/^after\s+/, "")
  return /^(\d+)ms$/.exec(raw)?.[1] ?? raw
}

export function toMachineJSON(machine: StateMachine): MachineJSON {
  const finals = finalStatesOf(machine)
  const { childrenOf, transitionsFrom, initialChild, parallel } = nestStates(machine)

  // Siblings by key, as v6 writes them; anything else by the root id path.
  const target = (from: string, to: string): string =>
    parentOf(from) === parentOf(to) ? keyOf(to) : `#${machine.name}.${to}`

  const value = (
    from: string,
    ts: ReadonlyArray<StateTransition>,
    matches?: MachineJSONTransition["matches"]
  ): MachineJSONValue => {
    const branches = dedupe(ts).map((t): MachineJSONTransition => ({
      ...(t.targetless ? {} : { target: target(from, t.to) }),
      ...(t.guard !== undefined ? { guard: { type: t.guard } } : {}),
      ...(t.actions !== undefined ? { actions: t.actions.map((type) => ({ type })) } : {}),
      ...(matches !== undefined ? { matches } : {})
    }))
    return branches.length === 1 && branches[0] !== undefined ? branches[0] : branches
  }

  const grouped = (
    ts: ReadonlyArray<StateTransition>,
    keyFor: (t: StateTransition) => string
  ): Map<string, Array<StateTransition>> => {
    const out = new Map<string, Array<StateTransition>>()
    for (const t of ts) out.set(keyFor(t), [...(out.get(keyFor(t)) ?? []), t])
    return out
  }

  const node = (path: string): MachineJSONStateNode => {
    const kids = childrenOf.get(path) ?? []
    const outs = transitionsFrom.get(path) ?? []
    const by = (trigger: StateTransition["trigger"]) => outs.filter((t) => t.trigger === trigger)
    const events = by(undefined)
    const always = by("always")
    const afters = by("after")

    const invokes = machine.invokes?.[path] ?? []
    const invoke = invokes.map((inv, invokeIndex): MachineJSONInvoke => {
      const done = by("done").filter((t) => t.invokeIndex === invokeIndex)
      const error = by("error").filter((t) => t.invokeIndex === invokeIndex)
      return {
        src: inv.src,
        ...(inv.id !== undefined ? { id: inv.id } : {}),
        ...(done.length > 0 ? { onDone: value(path, done) } : {}),
        ...(error.length > 0 ? { onError: value(path, error) } : {})
      }
    })
    // A done transition no invoke owns is the compound state's own completion.
    // MachineJSON has no state-level onDone, so it is keyed in `on`.
    const completion = by("done").filter((t) => t.invokeIndex === undefined)
    const on = [...grouped(events, (t) => t.event)].map(([e, ts]) => [e, value(path, ts)] as const)
    if (completion.length > 0) {
      on.push([DONE_STATE_EVENT, value(path, completion, { stateId: `${machine.name}.${path}` })])
    }
    const entry = machine.entryActions?.[path]
    const exit = machine.exitActions?.[path]
    const type = parallel.has(path) ? "parallel" : kids.length === 0 && finals.has(path) ? "final" : undefined

    return {
      ...(type !== undefined ? { type } : {}),
      ...(kids.length > 0 && type !== "parallel" ? { initial: initialChild(path) } : {}),
      ...(entry !== undefined ? { entry: entry.map((t) => ({ type: t })) } : {}),
      ...(exit !== undefined ? { exit: exit.map((t) => ({ type: t })) } : {}),
      ...(invoke.length > 0 ? { invoke: invoke.length === 1 && invoke[0] ? invoke[0] : invoke } : {}),
      ...(on.length > 0 ? { on: Object.fromEntries(on) } : {}),
      ...(always.length > 0 ? { always: value(path, always) } : {}),
      ...(afters.length > 0
        ? {
          after: Object.fromEntries(
            [...grouped(afters, (t) => delayKey(t.event))].map(([d, ts]) => [d, value(path, ts)])
          )
        }
        : {}),
      ...(kids.length > 0 ? { states: Object.fromEntries(kids.map((kid) => [keyOf(kid), node(kid)])) } : {})
    }
  }

  const top = childrenOf.get("") ?? []
  return {
    id: machine.name,
    initial: machine.initial?.split(".")[0] ?? keyOf(top[0] ?? ""),
    states: Object.fromEntries(top.map((path) => [path, node(path)]))
  }
}

/** One machine as a MachineJSON document; several as a JSON array of them. */
export function renderMachineJSON(machines: ReadonlyArray<StateMachine>): string {
  const docs = machines.map(toMachineJSON)
  return JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2)
}
