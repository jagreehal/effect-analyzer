import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { renderExplanation } from "./output/explain"
import { renderStaticMermaid } from "./output/mermaid"
import { renderRailwayMermaid } from "./output/mermaid-railway"
import { analyzeEffectSource } from "./static-analyzer"
import { getStaticChildren, type StaticFlowNode } from "./types"

const source = `
  import { Context, Data, Effect } from 'effect';

  class Declined extends Data.TaggedError('Declined')<{}> {}
  class Store extends Context.Service<Store, {
    readonly reserve: Effect.Effect<string>
    readonly release: (id: string) => Effect.Effect<void>
    readonly audit: (id: string) => Effect.Effect<void>
    readonly flush: Effect.Effect<void>
  }>()('Store') {}
  class Bank extends Context.Service<Bank, {
    readonly charge: Effect.Effect<void, Declined>
  }>()('Bank') {}

  const skipRelease = false;

  export const order = Effect.gen(function* () {
    const store = yield* Store;
    const bank = yield* Bank;
    const id = yield* store.reserve;
    yield* bank.charge.pipe(
      Effect.tapError(() => (skipRelease ? Effect.void : Effect.ignore(store.release(id)))),
    );
    return id;
  });

  export const onErrorPiped = Effect.gen(function* () {
    const store = yield* Store;
    const bank = yield* Bank;
    const id = yield* store.reserve;
    yield* bank.charge.pipe(Effect.onError(() => store.release(id)));
    return id;
  });

  export const onErrorDataFirst = Effect.gen(function* () {
    const store = yield* Store;
    const bank = yield* Bank;
    const id = yield* store.reserve;
    yield* Effect.onError(bank.charge, () => store.release(id));
    return id;
  });

  export const tapErrorDataFirst = Effect.gen(function* () {
    const store = yield* Store;
    const bank = yield* Bank;
    yield* Effect.tapError(bank.charge, () => store.flush);
  });

  const logFailure = (e: Declined) => Effect.logError(e);

  export const tapsAReference = Effect.gen(function* () {
    const store = yield* Store;
    const bank = yield* Bank;
    yield* bank.charge.pipe(Effect.tapError(store.release), Effect.tapError(logFailure));
  });

  export const tapsAProperty = Effect.gen(function* () {
    const store = yield* Store;
    const bank = yield* Bank;
    yield* bank.charge.pipe(Effect.tapError(() => store.flush));
  });

  export const audited = Effect.gen(function* () {
    const store = yield* Store;
    const id = yield* store.reserve.pipe(Effect.tap((id) => store.audit(id)));
    return id;
  });
`

const analyze = async (name: string) => {
  const irs = await Effect.runPromise(analyzeEffectSource(source))
  const ir = irs.find((program) => program.root.programName === name)
  expect(ir, `expected ${name}`).toBeDefined()
  return ir!
}

const descendants = (node: StaticFlowNode): Array<StaticFlowNode> =>
  Option.getOrElse(getStaticChildren(node), () => []).flatMap((child) => [child, ...descendants(child)])

const transform = (nodes: ReadonlyArray<StaticFlowNode>, op: string) =>
  nodes.flatMap((n) => [n, ...descendants(n)]).find(
    (n): n is StaticFlowNode & { type: "transform" } => n.type === "transform" && n.transformType === op
  )

const resource = (nodes: ReadonlyArray<StaticFlowNode>) =>
  nodes.flatMap((n) => [n, ...descendants(n)]).find(
    (n): n is StaticFlowNode & { type: "resource" } => n.type === "resource"
  )

const tapEdgeTo = (diagram: string, target: string) =>
  expect(diagram).toMatch(new RegExp(`-\\.->\\|tapError\\| \\w+\\["${target}"\\]`))

const callees = (node: StaticFlowNode) =>
  [node, ...descendants(node)].flatMap((n) => (n.type === "effect" && n.callee ? [n.callee] : []))

describe("error taps", () => {
  it("analyzes a tapError callback into steps", { timeout: 20_000 }, async () => {
    const ir = await analyze("order")
    const tap = transform(ir.root.children, "tapError")
    expect(tap?.callback, "tapError callback should be analyzed").toBeDefined()
    expect(callees(tap!.callback!)).toContain("store.release")
  })

  it("reads a ternary over two Effects as a decision, not unknown", { timeout: 20_000 }, async () => {
    const ir = await analyze("order")
    const callback = transform(ir.root.children, "tapError")?.callback
    expect(callback?.type).toBe("decision")
    if (callback?.type !== "decision") return
    expect(callback.source).toBe("raw-ternary")
    expect(callback.onFalse?.flatMap(callees)).toContain("store.release")
  })

  it("draws the tap as a side branch off the tapped step", { timeout: 20_000 }, async () => {
    const diagram = renderRailwayMermaid(await analyze("order"))
    const charge = /(\w+)\["bank\.charge"\]/.exec(diagram)?.[1]
    expect(charge, diagram).toBeDefined()
    // From the step's error node when its errors resolved, else from the step.
    expect(diagram).toMatch(new RegExp(`\\n  ${charge}E? -\\.->\\|tapError\\| \\w+\\["store\\.release"\\]`))
  })

  it("follows a success tap's callback but keeps it off the error rail", { timeout: 20_000 }, async () => {
    const ir = await analyze("audited")
    expect(callees(transform(ir.root.children, "tap")!.callback!)).toContain("store.audit")
    expect(renderRailwayMermaid(ir)).not.toContain("-.->")
  })

  it("keeps a callback passed by reference", { timeout: 20_000 }, async () => {
    const ir = await analyze("tapsAReference")
    const taps = ir.root.children.flatMap((n) => [n, ...descendants(n)]).filter(
      (n): n is StaticFlowNode & { type: "transform" } => n.type === "transform" && n.transformType === "tapError"
    )
    expect(taps.flatMap((t) => (t.callback ? callees(t.callback) : []))).toEqual(
      expect.arrayContaining(["store.release", "logFailure"])
    )
    tapEdgeTo(renderRailwayMermaid(ir), "store\\.release")
  })

  it("resolves a service property inside a tap callback", { timeout: 20_000 }, async () => {
    const ir = await analyze("tapsAProperty")
    expect(callees(transform(ir.root.children, "tapError")!.callback!)).toContain("store.flush")
  })
})

describe("onError", () => {
  it("parses a pipe whose only Effect op is onError, with the cleanup as release", { timeout: 20_000 }, async () => {
    const node = resource((await analyze("onErrorPiped")).root.children)
    expect(node?.resourceOperation).toBe("onError")
    expect(callees(node!.release)).toContain("store.release")
    // Data-last: `Effect` is the module, not the effect being guarded.
    expect(node!.acquire.type).toBe("unknown")
  })

  it("reads data-first onError as (effect, cleanup)", { timeout: 20_000 }, async () => {
    const node = resource((await analyze("onErrorDataFirst")).root.children)
    expect(node?.resourceOperation).toBe("onError")
    expect(callees(node!.acquire)).toContain("bank.charge")
    expect(callees(node!.release)).toContain("store.release")
  })

  it("draws onError as a side branch off the guarded step", { timeout: 20_000 }, async () => {
    const diagram = renderRailwayMermaid(await analyze("onErrorPiped"))
    const charge = /(\w+)\["bank\.charge"\]/.exec(diagram)?.[1]
    expect(charge, diagram).toBeDefined()
    expect(diagram).toMatch(new RegExp(`\\n  ${charge}E? -\\.->\\|onError\\| \\w+\\["store\\.release"\\]`))
  })
})

describe("data-first error taps", () => {
  const tapEdge = (diagram: string, op: string, target: string) => {
    const charge = /(\w+)\["bank\.charge"\]/.exec(diagram)?.[1]
    expect(charge, diagram).toBeDefined()
    expect(diagram).toMatch(new RegExp(`\\n  ${charge}E? -\\.->\\|${op}\\| \\w+\\["${target}"\\]`))
  }

  it("draws data-first tapError like the piped form", { timeout: 20_000 }, async () => {
    tapEdge(renderRailwayMermaid(await analyze("tapErrorDataFirst")), "tapError", "store\\.flush")
  })

  it("draws data-first onError like the piped form", { timeout: 20_000 }, async () => {
    tapEdge(renderRailwayMermaid(await analyze("onErrorDataFirst")), "onError", "store\\.release")
  })
})

describe("standard views show tap callbacks", () => {
  it("mermaid renders the tapError callback", { timeout: 20_000 }, async () => {
    expect(renderStaticMermaid(await analyze("order"))).toContain("store.release")
  })

  it("explain mentions the tapError callback", { timeout: 20_000 }, async () => {
    expect(renderExplanation(await analyze("order"))).toContain("store.release")
  })
})
