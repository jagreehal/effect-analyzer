import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { renderLayersMermaid, renderProgramsLayersMermaid } from "./output/mermaid-layers"
import { analyzeEffectSource } from "./static-analyzer"
import type { StaticEffectIR, StaticLayerNode } from "./types"

const makeMetadata = () => ({
  analyzedAt: Date.now(),
  filePath: "test.ts",
  stats: {
    totalEffects: 0,
    parallelCount: 0,
    raceCount: 0,
    errorHandlerCount: 0,
    retryCount: 0,
    timeoutCount: 0,
    resourceCount: 0,
    loopCount: 0,
    conditionalCount: 0,
    layerCount: 0,
    unknownCount: 0,
    interruptionCount: 0,
    decisionCount: 0,
    switchCount: 0
  }
})

const makeLayerNode = (overrides: Partial<StaticLayerNode> & { id: string }): StaticLayerNode => ({
  type: "layer",
  operations: [],
  isMerged: false,
  ...overrides
})

const makeIR = (layers: Array<StaticLayerNode>): StaticEffectIR => ({
  root: {
    id: "prog-1",
    type: "program",
    programName: "test",
    source: "generator",
    children: layers,
    dependencies: [],
    errorTypes: []
  },
  metadata: makeMetadata(),
  references: new Map()
})

describe("renderLayersMermaid", () => {
  it("renders provides edge for a layer that provides a service", () => {
    const ir = makeIR([
      makeLayerNode({
        id: "layer-db",
        name: "DbLayer",
        provides: ["DbService"],
        lifecycle: "memoized"
      })
    ])

    const result = renderLayersMermaid(ir)
    expect(result).toContain("flowchart TB")
    expect(result).toContain("DbLayer")
    expect(result).toContain("memoized")
    expect(result).toContain("DbService")
    expect(result).toContain("-->|provides|")
    expect(result).toContain("fill:#E8EAF6")
    expect(result).toContain("fill:#E3F2FD")
  })

  it("renders requires edges as dashed arrows", () => {
    const ir = makeIR([
      makeLayerNode({
        id: "layer-app",
        name: "AppLayer",
        provides: ["AppService"],
        requires: ["DbService", "LogService"]
      })
    ])

    const result = renderLayersMermaid(ir)
    expect(result).toContain("-.->|requires|")
    expect(result).toContain("DbService")
    expect(result).toContain("LogService")
  })

  it("renders merge edge for merged layers", () => {
    const childLayer = makeLayerNode({
      id: "layer-child",
      name: "ChildLayer",
      provides: ["ChildService"]
    })
    const parentLayer = makeLayerNode({
      id: "layer-parent",
      name: "ParentLayer",
      provides: ["ParentService"],
      isMerged: true,
      operations: [childLayer]
    })

    const ir = makeIR([parentLayer, childLayer])

    const result = renderLayersMermaid(ir)
    expect(result).toContain("-->|merge|")
    expect(result).toContain("fill:#F3E5F5")
  })

  it("renders graceful empty output when no layers", () => {
    const ir = makeIR([])
    const result = renderLayersMermaid(ir)
    expect(result).toContain("flowchart TB")
    expect(result).toContain("NoLayers")
    expect(result).toContain("No layers")
  })

  it("respects direction option", () => {
    const ir = makeIR([
      makeLayerNode({
        id: "layer-1",
        name: "MyLayer",
        provides: ["Svc"]
      })
    ])

    const result = renderLayersMermaid(ir, { direction: "LR" })
    expect(result).toContain("flowchart LR")
  })

  it("renders full graph with multiple layers and dependencies", () => {
    const ir = makeIR([
      makeLayerNode({
        id: "layer-db",
        name: "DbLayer",
        provides: ["DbService"],
        lifecycle: "memoized"
      }),
      makeLayerNode({
        id: "layer-log",
        name: "LogLayer",
        provides: ["LogService"],
        lifecycle: "default"
      }),
      makeLayerNode({
        id: "layer-app",
        name: "AppLayer",
        provides: ["AppService"],
        requires: ["DbService", "LogService"],
        lifecycle: "scoped"
      })
    ])

    const result = renderLayersMermaid(ir)

    // All layers present
    expect(result).toContain("DbLayer")
    expect(result).toContain("LogLayer")
    expect(result).toContain("AppLayer")

    // All services present
    expect(result).toContain("DbService")
    expect(result).toContain("LogService")
    expect(result).toContain("AppService")

    // Provides edges
    expect(result).toContain("-->|provides|")

    // Requires edges (dashed)
    expect(result).toContain("-.->|requires|")

    // Styling classes present
    expect(result).toContain("layerStyle")
    expect(result).toContain("serviceStyle")
  })
})

describe("renderProgramsLayersMermaid", () => {
  it("draws factory-built layers from every program in one diagram, named after the program", async () => {
    // A service whose layer comes from a factory function that takes its dependency.
    const irs = await Effect.runPromise(analyzeEffectSource(`
      import { Context, Effect, Layer } from 'effect';
      export type Mailer = { send(to: string): Promise<void> };
      export class OrderNotifier extends Context.Service<OrderNotifier, {
        readonly notify: (id: string) => Effect.Effect<void>
      }>()('OrderNotifier') {}
      export const OrderNotifierLive = (mailer: Mailer): Layer.Layer<OrderNotifier> =>
        Layer.succeed(OrderNotifier, { notify: (id: string) => Effect.promise(() => mailer.send(id)) });
      export const notify = Effect.gen(function* () {
        const notifier = yield* OrderNotifier;
        yield* notifier.notify('o-1');
      });
    `))
    const out = renderProgramsLayersMermaid(irs)
    expect(out.match(/flowchart/g)).toHaveLength(1)
    expect(out).toContain("[\"OrderNotifierLive\"]")
    expect(out).toMatch(/-->\|provides\| OrderNotifier/)
  })

  it("renders one empty diagram when no program builds a layer", () => {
    expect(renderProgramsLayersMermaid([])).toContain("NoLayers")
  })
})
