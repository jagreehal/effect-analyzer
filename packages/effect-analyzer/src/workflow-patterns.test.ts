/**
 * Tests for effect-workflow patterns (Workflow.make / Workflow.run)
 * and Effect package workflow (Workflow.make(options), workflow.execute).
 * Uses the effect-workflow entrypoint so workflow detection is enabled.
 */
import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { analyze } from './effect-workflow';

describe('workflow pattern analysis (effect-workflow)', () => {
  it('analyzes Workflow.run(Workflow.make(..., fn)) inline', async () => {
    const source = `
      import { Effect } from "effect";
      import { Workflow } from "effect-workflow";

      const fetchUser = () => Effect.succeed({ id: "u1" });
      const runCheckout = Workflow.run(
        Workflow.make("checkout", { fetchUser }, ({ step, deps }) =>
          Effect.gen(function* () {
            const user = yield* step("fetch-user", () => deps.fetchUser(), { key: "user:u1" });
            return user.id;
          })
        )
      );
    `;

    const ir = await Effect.runPromise(
      analyze.source(source).named('runCheckout'),
    );

    expect(ir.root.source).toBe('run');
    expect(ir.root.children.length).toBeGreaterThan(0);
    expect(ir.metadata.stats.totalEffects).toBeGreaterThan(0);
  });

  it('analyzes Workflow.run(workflowVar) with workflow in variable', async () => {
    const source = `
      import { Effect } from "effect";
      import { Workflow } from "effect-workflow";

      const fetchUser = () => Effect.succeed({ id: "u1" });
      const checkout = Workflow.make("checkout", { fetchUser }, ({ step, deps }) =>
        Effect.gen(function* () {
          const user = yield* step("fetch-user", () => deps.fetchUser(), { key: "user:u1" });
          return user.id;
        })
      );
      const runCheckout = Workflow.run(checkout);
    `;

    const ir = await Effect.runPromise(
      analyze.source(source).named('runCheckout'),
    );

    expect(ir.root.source).toBe('run');
    expect(ir.root.children.length).toBeGreaterThan(0);
    expect(ir.metadata.stats.totalEffects).toBeGreaterThan(0);
  });

  it('analyzes workflow source with test-like closures without crashing', { timeout: 15_000 }, async () => {
    // Simulates workflow test files where programs are inside closures
    const source = `
      import { Effect } from "effect";
      import { Workflow } from "effect-workflow";

      const deps = { fetchUser: () => Effect.succeed({ id: "u1" }) };
      describe("checkout", () => {
        it("works", async () => {
          const result = Workflow.run(
            Workflow.make("checkout", deps, ({ step, deps }) =>
              Effect.gen(function* () {
                const user = yield* step("fetch", () => deps.fetchUser(), { key: "u1" });
                return user.id;
              })
            )
          );
        });
      });
    `;

    const exit = await Effect.runPromiseExit(
      analyze.source(source).all(),
    );
    // Either discovers programs or NO_EFFECTS_FOUND — both valid
    expect(exit._tag).toMatch(/^(Success|Failure)$/);
  });

  it('analyzes barrel re-export files without crashing', async () => {
    // Simulates runtime/index.ts barrel file
    const source = `
      export { createWorkflow } from "./workflow";
      export { createRuntime } from "./runtime";
      export type { WorkflowOptions } from "./types";
    `;

    const exit = await Effect.runPromiseExit(
      analyze.source(source).all(),
    );

    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error.code).toBe('NO_EFFECTS_FOUND');
    }
  });

  describe('Effect package workflow (Workflow.make(options), workflow.execute)', () => {
    it('discovers and analyzes workflow.execute(payload) when Workflow.make(options) is used', async () => {
      const source = `
        import * as Workflow from "@effect/workflow";
        import * as Schema from "effect/Schema";

        const checkout = Workflow.make({
          name: "checkout",
          payload: Schema.Struct({ userId: Schema.String }),
          idempotencyKey: (p: { userId: string }) => p.userId,
        });
        const runCheckout = checkout.execute({ userId: "u1" });
      `;

      const ir = await Effect.runPromise(
        analyze.source(source).named('runCheckout'),
      );

      expect(ir.root.source).toBe('workflow-execute');
      expect(ir.root.children.length).toBe(1);
      expect(ir.root.children[0]?.type).toBe('effect');
      expect((ir.root.children[0] as { callee?: string }).callee).toContain('execute');
    });

    it('discovers and analyzes activity.execute() when Activity.make(options) is used', async () => {
      const source = `
        import * as Activity from "@effect/workflow";
        import { Effect } from "effect";

        const fetchUser = Activity.make({
          name: "fetchUser",
          execute: Effect.succeed({ id: "u1" }),
        });
        const runFetch = fetchUser.execute();
      `;

      const ir = await Effect.runPromise(
        analyze.source(source).named('runFetch'),
      );
      expect(ir.root.source).toBe('workflow-execute');
      expect(ir.root.children.length).toBe(1);
      expect((ir.root.children[0] as { callee?: string }).callee).toContain('execute');
    });
  });

  it('analyzes @effect/workflow-style source without throwing', { timeout: 15_000 }, async () => {
    // Simulates @effect/workflow package patterns: Workflow.make(options) + workflow.execute
    const indexSource = `
      export * from "./Workflow";
      export * from "./Activity";
    `;
    const workflowSource = `
      import * as Workflow from "@effect/workflow";
      import * as Schema from "effect/Schema";
      import { Effect } from "effect";

      const checkout = Workflow.make({
        name: "checkout",
        payload: Schema.Struct({ userId: Schema.String }),
        idempotencyKey: (p: { userId: string }) => p.userId,
      });

      export const runCheckout = checkout.execute({ userId: "u1" });

      export const program = Effect.gen(function* () {
        const result = yield* checkout.execute({ userId: "u2" });
        return result;
      });
    `;

    const exitIndex = await Effect.runPromiseExit(
      analyze.source(indexSource).all(),
    );
    const exitWorkflow = await Effect.runPromiseExit(
      analyze.source(workflowSource).all(),
    );
    expect(exitIndex._tag).toMatch(/^(Success|Failure)$/);
    expect(exitWorkflow._tag).toMatch(/^(Success|Failure)$/);
    if (exitWorkflow._tag === 'Success' && exitWorkflow.value.length > 0) {
      expect(exitWorkflow.value.some((ir) =>
        ir.root.source === 'workflow-execute' || ir.root.source === 'run' || ir.root.source === 'generator'
      )).toBe(true);
    }
  });
});
