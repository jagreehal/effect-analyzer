import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createAsyncLogic, initialTransition, machineFromJSON, machineToJSON, transition } from "xstate"
import { analyzeStateMachines, type StateMachine } from "../state-machine"
import { fromMachineJSON, type MachineJSON } from "../state-machine-json"
import { toMachineJSON } from "./machine-json"
import { renderXStateConfig } from "./xstate-config"

vi.setConfig({ testTimeout: 15_000 })

const fromSource = analyzeStateMachines(join(__dirname, "..", "__fixtures__", "effect-machine.ts")).machines

const order: MachineJSON = {
  id: "order",
  initial: "Checkout",
  states: {
    Checkout: {
      initial: "Cart",
      entry: [{ type: "focusForm" }],
      states: {
        Cart: {
          on: {
            Submit: [
              { target: "Paying", guard: { type: "hasItems" }, actions: [{ type: "persistDraft" }] },
              { target: "Cart" }
            ]
          }
        },
        Paying: {
          invoke: { src: "charge", id: "charge", onDone: { target: "#order.Done" }, onError: { target: "Cart" } },
          after: { "5000": { target: "Cart" } },
          on: { Cancel: { target: "#order.Abandoned" } }
        }
      }
    },
    Sync: { type: "parallel", states: { A: { always: { target: "B" } }, B: {} } },
    Done: { type: "final" },
    Abandoned: {}
  }
}

/** Load MachineJSON into XState v6 with a stand-in for every named implementation. */
function loadInXState(json: MachineJSON, machine: StateMachine) {
  const names = (xs: ReadonlyArray<string | undefined>) => [...new Set(xs.filter((x) => x !== undefined))]
  const actions = names([
    ...machine.transitions.flatMap((t) => t.actions ?? []),
    ...Object.values(machine.entryActions ?? {}).flat(),
    ...Object.values(machine.exitActions ?? {}).flat()
  ])
  const guards = names(machine.transitions.map((t) => t.guard))
  const actors = names(Object.values(machine.invokes ?? {}).flat().map((i) => i.src))
  return machineFromJSON(json, {
    actions: Object.fromEntries(actions.map((n) => [n, () => {}])),
    guards: Object.fromEntries(guards.map((n) => [n, () => true])),
    actors: Object.fromEntries(
      actors.map((n) => [n, createAsyncLogic({ run: () => Promise.race<never>([]) /* never settles */ })])
    )
  })
}

describe("toMachineJSON", () => {
  it("writes what XState v6 machineToJSON writes for the same machine", () => {
    const machine = fromMachineJSON(order)
    const json = toMachineJSON(machine)
    expect(json).toEqual(order)
    expect(machineToJSON(loadInXState(json, machine))).toEqual(json)
  })

  it("round-trips through fromMachineJSON", () => {
    const machine = fromMachineJSON(order)
    const again = fromMachineJSON(toMachineJSON(machine))
    expect(again.transitions).toEqual(machine.transitions)
    expect(again.states).toEqual(machine.states)
    expect(again.finalStates).toEqual(machine.finalStates)
    expect(again.invokes).toEqual(machine.invokes)
  })

  it("keeps a targetless transition targetless, so it does not reset a compound state", () => {
    const original: MachineJSON = {
      id: "m",
      initial: "A",
      states: {
        A: {
          initial: "one",
          on: { PING: { actions: [{ type: "log" }] } },
          states: { one: { on: { NEXT: { target: "two" } } }, two: {} }
        }
      }
    }
    const machine = fromMachineJSON(original)
    const exported = toMachineJSON(machine)
    expect(exported.states.A?.on?.PING).toEqual({ actions: [{ type: "log" }] })
    expect(renderXStateConfig(machine)).toContain("PING: [{ actions: ['log'] }]")

    const valueAfterPing = (json: MachineJSON) => {
      const m = loadInXState(json, machine)
      const [start] = initialTransition(m)
      const [two] = transition(m, start, { type: "NEXT" })
      return transition(m, two, { type: "PING" })[0].value
    }
    expect(valueAfterPing(original)).toEqual({ A: "two" })
    expect(valueAfterPing(exported)).toEqual({ A: "two" })
  })

  it("exports a compound state's onDone, so finishing its children leaves it", () => {
    const [machine] = analyzeStateMachines(
      "/virtual/compound-done.ts",
      `
      import { Machine } from '@typeonce/effect-machine';
      const States = Machine.defineStates({
        A: { schema: A, initial: 'one', states: { one: One, end: { schema: End, type: 'final' } } },
        Done: { schema: Done, type: 'final' },
      });
      export const Flow = Machine.make({
        states: States.states,
        events: [Finish],
        initial: () => States.initial.A(new A(), (a) => a.one(new One())),
      }).handle({
        A: {
          onDone: ({ target }) => target.full.Done(new Done()),
          states: { one: { on: { Finish: ({ target }) => target.local.end(new End()) } } },
        },
      });
    `
    ).machines
    expect(machine?.transitions).toContainEqual({ from: "A", event: "onDone", to: "Done", trigger: "done" })

    const json = toMachineJSON(machine!)
    expect(json.states.A?.on?.["xstate.done.state"]).toEqual({ target: "Done", matches: { stateId: "Flow.A" } })
    expect(renderXStateConfig(machine!)).toContain("onDone: '#Flow.Done'")
    expect(fromMachineJSON(json).transitions).toContainEqual(
      { from: "A", event: "onDone", to: "Done", trigger: "done" }
    )

    const m = loadInXState(json, machine!)
    const [start] = initialTransition(m)
    expect(start.value).toEqual({ A: "one" })
    expect(transition(m, start, { type: "Finish" })[0].value).toBe("Done")
  })

  it("reads the state-level onDone that v6 machineToJSON writes", () => {
    const machine = fromMachineJSON({
      id: "m",
      initial: "A",
      states: { A: { initial: "one", onDone: { target: "B" }, states: { one: { type: "final" } } }, B: {} }
    })
    expect(machine.transitions).toContainEqual({ from: "A", event: "onDone", to: "B", trigger: "done" })
  })

  it.each(fromSource.map((m) => [m.name, m] as const))(
    "loads the %s machine read from Effect source into XState v6",
    (_, machine) => {
      const json = toMachineJSON(machine)
      expect(() => loadInXState(json, machine)).not.toThrow()
      expect(fromMachineJSON(json).transitions).toEqual(
        expect.arrayContaining(machine.transitions.filter((t) => t.trigger !== "initial"))
      )
    }
  )
})
