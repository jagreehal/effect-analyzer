import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { analyzeServiceHealth, buildServiceRegistry } from "./service-health"
import { analyzeEffectSource } from "./static-analyzer"
import type { StaticEffectIR } from "./types"

describe("service health", () => {
  it("counts services provided by factory-built layers and required by programs", async () => {
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
    const registry = buildServiceRegistry(irs)
    expect([...registry.provided.keys()]).toContain("OrderNotifier")
    expect([...registry.required.keys()]).toContain("OrderNotifier")
    const { summary } = analyzeServiceHealth(registry, irs)
    expect(summary).toMatchObject({ totalServices: 1, satisfiedServices: 1, unsatisfiedServices: 0 })
  })

  it("counts a service required by type and by dependency once", () => {
    const ir = {
      metadata: { filePath: "/p/program.ts" },
      root: {
        requiredServices: [{ serviceId: "FileSystem", serviceType: "FileSystem" }],
        dependencies: [{ name: "FileSystem.FileSystem", isLayer: false }],
        children: []
      }
    } as unknown as StaticEffectIR
    expect([...buildServiceRegistry([ir]).required.keys()]).toEqual(["FileSystem"])
  })
})
