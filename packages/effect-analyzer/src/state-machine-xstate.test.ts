import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { renderStatechartSVG } from "./output/svg-statechart"
import { analyzeStateMachines } from "./state-machine"

vi.setConfig({ testTimeout: 15_000 })

const example = (name: string) =>
  analyzeStateMachines(join(__dirname, "..", "..", "..", "examples", "xstate-effect-workflows", `${name}.ts`)).machines

const inline = (source: string) => analyzeStateMachines("/virtual/machine.ts", source).machines

const edges = (name: string) => example(name)[0]!.transitions.map((t) => `${t.from} -${t.event}-> ${t.to}`)

describe("@xstate/effect examples", () => {
  it("approval: setupEffect, after, invoke with a transition-function onDone, finals", () => {
    const [machine] = example("approval")
    expect(machine).toMatchObject({
      name: "approvalMachine",
      source: "xstate",
      initial: "awaitingApproval",
      finalStates: ["deployed", "expired", "cancelled"],
      invokes: { deploying: [{ src: "deploy" }] }
    })
    expect(edges("approval")).toEqual([
      "awaitingApproval -APPROVE-> deploying",
      "awaitingApproval -CANCEL-> cancelled",
      "awaitingApproval -after 30000ms-> expired",
      "deploying -onDone-> deployed",
      "deploying -onError-> failed",
      "deploying -CANCEL-> cancelled",
      "failed -RETRY-> deploying",
      "failed -CANCEL-> cancelled"
    ])
  })

  it("parallel: a parallel root is wrapped as one state with both regions", () => {
    const [machine] = example("parallel")
    expect(machine?.parallelStates).toEqual(["releaseMachine"])
    expect(machine?.states).toEqual([
      "releaseMachine",
      "releaseMachine.review",
      "releaseMachine.review.pending",
      "releaseMachine.review.approved",
      "releaseMachine.build",
      "releaseMachine.build.running",
      "releaseMachine.build.passed"
    ])
  })

  it("resources: setup().createMachine from xstate", () => {
    expect(edges("resources")).toEqual(["preparing -onDone-> ready"])
  })

  it("failure-cause: target read from a block-bodied onError function", () => {
    expect(edges("failure-cause")).toEqual(["pending -onError-> failed"])
  })

  it("Effect-only examples have no machines", () => {
    for (const name of ["retry", "supervision", "errors"]) expect(example(name)).toEqual([])
  })
})

describe("xstate extraction edge cases", () => {
  it("ignores createMachine not imported from xstate / @xstate/effect", () => {
    expect(inline(`
      import { createMachine } from "./local"
      export const m = createMachine({ initial: "a", states: { a: {} } })
    `)).toEqual([])
  })

  it("follows aliased imports", () => {
    const [m] = inline(`
      import { setup as configure } from "xstate"
      export const m = configure({}).createMachine({ initial: "a", states: { a: { on: { GO: "b" } }, b: {} } })
    `)
    expect(m?.transitions).toEqual([{ from: "a", event: "GO", to: "b" }])
  })

  it("reads ternary and if/else branches as guarded targets", () => {
    const [m] = inline(`
      import { createMachine } from "xstate"
      export const m = createMachine({
        initial: "a",
        states: {
          a: { on: {
            T: ({ event }) => event.ok ? { target: "b" } : { target: "c" },
            I: ({ event }) => { if (event.ok) { return { target: "b" } } else { return { target: "c" } } }
          } },
          b: {}, c: {}
        }
      })
    `)
    expect(m?.transitions).toEqual([
      { from: "a", event: "T", to: "b", guard: "event.ok" },
      { from: "a", event: "T", to: "c", guard: "!(event.ok)" },
      { from: "a", event: "I", to: "b", guard: "event.ok" },
      { from: "a", event: "I", to: "c", guard: "!(event.ok)" }
    ])
  })

  it("keeps string actions and guards as labels, and a target-less function as a self edge", () => {
    const [m] = inline(`
      import { createMachine } from "xstate"
      export const m = createMachine({
        initial: "a",
        states: {
          a: {
            entry: "log",
            on: {
              GO: { target: "b", guard: "isReady", actions: ["save"] },
              PING: (args, enq) => enq(args.actions.ping)
            }
          },
          b: {}
        }
      })
    `)
    expect(m?.entryActions).toEqual({ a: ["log"] })
    expect(m?.transitions).toEqual([
      { from: "a", event: "GO", to: "b", guard: "isReady", actions: ["save"] },
      { from: "a", event: "PING", to: "a" }
    ])
  })
})

describe("review fixes", () => {
  it("keeps root-level handlers by wrapping the root as a state", () => {
    const [m] = inline(`
      import { createMachine } from "xstate"
      export const m = createMachine({
        initial: "a",
        on: { RESET: ".a" },
        states: { a: { on: { GO: "b" } }, b: {} }
      })
    `)
    expect(m?.initial).toBe("m")
    expect(m?.declaredEvents).toEqual(["RESET", "GO"])
    expect(m?.transitions).toEqual([
      { from: "m", event: "initial", to: "m.a", trigger: "initial" },
      { from: "m", event: "RESET", to: "m.a" },
      { from: "m.a", event: "GO", to: "m.b" }
    ])
  })

  it("stops expanding configs whose shared consts would grow exponentially", () => {
    // Each const references the next twice: 2^40 nodes if expanded naively.
    const consts = Array.from({ length: 40 }, (_, i) => `const c${i} = { x: c${i + 1}, y: c${i + 1} }`).join("\n")
    const started = performance.now()
    const machines = inline(`
      import { createMachine } from "xstate"
      ${consts}
      const c40 = {}
      export const m = createMachine({ initial: "a", states: { a: { meta: c0 } } })
    `)
    expect(machines).toEqual([])
    expect(performance.now() - started).toBeLessThan(5_000)
  })

  it("reads an array target returned by a transition function as one edge per target", () => {
    const [m] = inline(`
      import { createMachine } from "xstate"
      export const m = createMachine({
        initial: "a",
        states: { a: { on: { GO: () => ({ target: ["b", "c"] }) } }, b: {}, c: {} }
      })
    `)
    expect(m?.transitions).toEqual([
      { from: "a", event: "GO", to: "b" },
      { from: "a", event: "GO", to: "c" }
    ])
  })
})

describe("transition-function guards", () => {
  const edgesOf = (on: string) =>
    inline(`
      import { createMachine } from "xstate"
      export const m = createMachine({ initial: "a", states: { a: { on: { GO: ${on} } }, b: {}, c: {} } })
    `)[0]?.transitions

  it("keeps a targetless branch as a guarded self-transition", () => {
    expect(edgesOf(`({ event }) => event.ok ? { target: "b" } : {}`)).toEqual([
      { from: "a", event: "GO", to: "b", guard: "event.ok" },
      { from: "a", event: "GO", to: "a", guard: "!(event.ok)" }
    ])
  })

  it("combines nested ternary conditions", () => {
    expect(edgesOf(`({ event }) => event.ok ? (event.fast ? { target: "b" } : { target: "c" }) : {}`)).toEqual([
      { from: "a", event: "GO", to: "b", guard: "event.ok && event.fast" },
      { from: "a", event: "GO", to: "c", guard: "event.ok && !(event.fast)" },
      { from: "a", event: "GO", to: "a", guard: "!(event.ok)" }
    ])
  })

  it("parenthesizes compound conditions so combining keeps precedence", () => {
    // Unparenthesized, a = true and c = false would wrongly take the b branch.
    expect(edgesOf(`({ event }) => event.a || event.b ? (event.c ? { target: "b" } : {}) : {}`)).toEqual([
      { from: "a", event: "GO", to: "b", guard: "(event.a || event.b) && event.c" },
      { from: "a", event: "GO", to: "a", guard: "(event.a || event.b) && !(event.c)" },
      { from: "a", event: "GO", to: "a", guard: "!(event.a || event.b)" }
    ])
  })

  it("negates earlier early returns for the code that falls through them", () => {
    expect(edgesOf(`({ event }) => {
      if (event.done) return { target: "c" }
      if (event.ok) { return { target: "b" } }
      return {}
    }`)).toEqual([
      { from: "a", event: "GO", to: "c", guard: "event.done" },
      { from: "a", event: "GO", to: "b", guard: "!(event.done) && event.ok" },
      { from: "a", event: "GO", to: "a", guard: "!(event.done) && !(event.ok)" }
    ])
  })

  it("combines nested if conditions, and a ternary inside an if", () => {
    expect(edgesOf(`({ event }) => {
      if (event.ok) {
        if (event.fast) { return { target: "b" } } else { return event.x ? { target: "c" } : {} }
      }
    }`)).toEqual([
      { from: "a", event: "GO", to: "b", guard: "event.ok && event.fast" },
      { from: "a", event: "GO", to: "c", guard: "event.ok && !(event.fast) && event.x" },
      { from: "a", event: "GO", to: "a", guard: "event.ok && !(event.fast) && !(event.x)" }
    ])
  })
})

describe("SVG statechart of a parallel machine", () => {
  it("nests regions and leaves instead of drawing flat dotted paths and 'initial' pills", () => {
    const svg = renderStatechartSVG(example("parallel")[0]!)
    expect(svg).toContain(">releaseMachine (parallel)</text>")
    expect(svg).toContain(">pending</text>")
    expect(svg).not.toContain(">releaseMachine.review.pending</text>")
    expect(svg).not.toContain(">initial</text>")
    // Two regions drawn dashed, each with its own initial dot.
    expect(svg.match(/<circle /g)).toHaveLength(3)
  })
})
