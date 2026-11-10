import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { createActor, machineFromJSON } from "xstate"
import { toMachineJSON } from "./output/machine-json"
import { irToStateMachine } from "./output/railway-machine"
import { fromMachineJSON } from "./state-machine-json"
import { analyzeEffectSource } from "./static-analyzer"

const source = `
  import { Context, Data, Effect } from 'effect';

  class Declined extends Data.TaggedError('Declined')<{}> {}
  class Store extends Context.Service<Store, {
    readonly reserve: Effect.Effect<string>
    readonly release: (id: string) => Effect.Effect<void>
    readonly flush: Effect.Effect<void>
  }>()('Store') {}
  class Bank extends Context.Service<Bank, {
    readonly charge: Effect.Effect<void, Declined>
  }>()('Bank') {}

  export const order = Effect.gen(function* () {
    const store = yield* Store;
    const bank = yield* Bank;
    const id = yield* store.reserve;
    yield* bank.charge.pipe(
      Effect.tapError(() => Effect.ignore(store.release(id))),
    );
    return id;
  });

  export const linear = Effect.gen(function* () {
    const store = yield* Store;
    const id = yield* store.reserve;
    return id;
  });
`

const program = async (name: string) => {
  const irs = await Effect.runPromise(analyzeEffectSource(source))
  const ir = irs.find((p) => p.root.programName === name)
  if (!ir) throw new Error(`missing program ${name}`)
  return ir
}

describe("irToStateMachine", () => {
  it("builds a happy-path machine from a linear Effect program", async () => {
    const machine = irToStateMachine(await program("linear"))
    expect(machine).toBeDefined()
    if (!machine) return

    expect(machine.source).toBe("effect-ir")
    expect(machine.name).toBe("linear")
    expect(machine.initial).toBe("Store")
    expect(machine.states).toContain("Success")
    expect(machine.finalStates).toContain("Success")
    expect(machine.stateTags?.Success).toEqual(["success"])

    const oks = machine.transitions.filter((t) => t.event === "ok")
    expect(oks.map((t) => `${t.from}->${t.to}`)).toEqual([
      "Store->store_reserve",
      "store_reserve->Success"
    ])
  })

  it("maps tapError as a side branch off the tapped step", async () => {
    const machine = irToStateMachine(await program("order"))
    expect(machine).toBeDefined()
    if (!machine) return

    const tap = machine.transitions.find((t) => t.event === "tapError")
    expect(tap).toBeDefined()
    // Same as Mermaid: off the error node when typed errors resolved, else the step.
    const err = machine.transitions.find((t) => t.event === "err" && t.from === "bank_charge")
    expect(tap?.from).toBe(err?.to ?? "bank_charge")
    expect(tap?.to).toContain("store_release")
    expect(tap?.actions).toBeUndefined()
    expect(machine.finalStates).toContain(tap?.to)
    expect(machine.stateTags?.[tap?.to ?? ""]).toEqual(["error"])
  })

  it("adds per-step err finals when error tags are known", async () => {
    const irs = await Effect.runPromise(analyzeEffectSource(`
      import { Data, Effect } from 'effect';
      class Gone extends Data.TaggedError('Gone')<{}> {}
      const fail = (): Effect.Effect<void, Gone> => Effect.fail(new Gone());
      export const boom = Effect.gen(function* () {
        yield* fail();
      });
    `))
    const ir = irs.find((p) => p.root.programName === "boom")
    expect(ir).toBeDefined()
    const machine = irToStateMachine(ir!)
    expect(machine).toBeDefined()
    if (!machine) return

    const err = machine.transitions.find((t) => t.event === "err")
    expect(err?.to).toBe("Gone")
    expect(machine.finalStates).toContain("Gone")
    expect(machine.stateTags?.Gone).toEqual(["error"])
    expect(toMachineJSON(machine).states.Gone).toMatchObject({ type: "final", tags: ["error"] })
    expect(toMachineJSON(machine).states.Success).toMatchObject({ type: "final", tags: ["success"] })
  })

  it("keeps an error node with taps non-final so XState reaches the tap", async () => {
    const irs = await Effect.runPromise(analyzeEffectSource(`
      import { Data, Effect } from 'effect';
      class Gone extends Data.TaggedError('Gone')<{}> {}
      const fail = (): Effect.Effect<void, Gone> => Effect.fail(new Gone());
      export const boom = Effect.gen(function* () {
        yield* fail().pipe(Effect.tapError(() => Effect.log('cleanup')));
      });
    `))
    const machine = irToStateMachine(irs.find((p) => p.root.programName === "boom")!)
    expect(machine).toBeDefined()
    if (!machine) return
    const err = machine.transitions.find((t) => t.event === "err")
    const tap = machine.transitions.find((t) => t.event === "tapError")
    expect(tap?.from).toBe(err?.to)
    expect(machine.finalStates).not.toContain(err?.to)
    expect(machine.finalStates).toContain(tap?.to)

    const actor = createActor(machineFromJSON(toMachineJSON(machine))).start()
    actor.send({ type: "err" })
    expect(actor.getSnapshot().status).toBe("active")
    actor.send({ type: "tapError" })
    expect(actor.getSnapshot().value).toBe(tap?.to)
    expect(actor.getSnapshot().status).toBe("done")
  })

  it("chains repeated taps so XState reaches every callback in order", async () => {
    const irs = await Effect.runPromise(analyzeEffectSource(`
      import { Data, Effect } from 'effect';
      class Gone extends Data.TaggedError('Gone')<{}> {}
      const fail = (): Effect.Effect<void, Gone> => Effect.fail(new Gone());
      export const boom = Effect.gen(function* () {
        yield* fail().pipe(
          Effect.tapError(() => Effect.log('cleanupA')),
          Effect.tapError(() => Effect.log('cleanupB')),
        );
      });
    `))
    const machine = irToStateMachine(irs.find((p) => p.root.programName === "boom")!)
    expect(machine).toBeDefined()
    if (!machine) return
    const taps = machine.transitions.filter((t) => t.event === "tapError")
    expect(taps).toHaveLength(2)
    const [first, second] = taps
    expect(second?.from).toBe(first?.to)
    expect(machine.finalStates).not.toContain(first?.to)
    expect(machine.finalStates).toContain(second?.to)

    const actor = createActor(machineFromJSON(toMachineJSON(machine))).start()
    actor.send({ type: "err" })
    actor.send({ type: "tapError" })
    expect(actor.getSnapshot().value).toBe(first?.to)
    expect(actor.getSnapshot().status).toBe("active")
    actor.send({ type: "tapError" })
    expect(actor.getSnapshot().value).toBe(second?.to)
    expect(actor.getSnapshot().status).toBe("done")
  })

  it("round-trips through MachineJSON", async () => {
    const machine = irToStateMachine(await program("order"))
    expect(machine).toBeDefined()
    if (!machine) return

    const json = toMachineJSON(machine)
    const back = fromMachineJSON(json)
    expect(back.source).toBe("machine-json")
    expect(back.initial).toBe(machine.initial)
    expect(back.states).toEqual(expect.arrayContaining([...machine.states]))
    expect(back.stateTags).toEqual(machine.stateTags)
    expect(back.transitions.map((t) => `${t.from}/${t.event}/${t.to}`).sort()).toEqual(
      machine.transitions.map((t) => `${t.from}/${t.event}/${t.to}`).sort()
    )
  })
})
