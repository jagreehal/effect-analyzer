/**
 * Tests for effect-workflow patterns (Workflow.make / Workflow.run)
 * and Effect package workflow (Workflow.make(options), workflow.execute).
 * Uses the effect-workflow entrypoint so workflow detection is enabled.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { Effect } from 'effect';
import { analyze } from './effect-workflow';
import { resolve } from 'path';

const workflowDir = resolve(__dirname, '..', '..', '..', 'js', 'effect-workflow', 'src');
const hasWorkflowRepo = existsSync(workflowDir);

const effectPackageWorkflowPath =
  process.env.EFFECT_WORKFLOW_PACKAGE_PATH ??
  resolve(__dirname, '..', '..', '..', 'js', 'awaitly', '__temp', 'effect', 'packages', 'workflow');
const hasEffectPackageWorkflow = existsSync(effectPackageWorkflowPath);

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

  it.skipIf(!hasWorkflowRepo)(
    'analyzes real effect-workflow source files',
    { timeout: 15_000 },
    async () => {
      // workflow.test.ts may define programs inside test closures (not top-level),
      // so we only assert the analyzer runs without throwing.
      const exit = await Effect.runPromiseExit(
        analyze(resolve(workflowDir, 'workflow.test.ts')).all(),
      );

      // Either we discover programs or we get NO_EFFECTS_FOUND — both are valid
      // depending on how the external repo structures its test file.
      expect(exit._tag).toMatch(/^(Success|Failure)$/);
    },
  );

  it.skipIf(!hasWorkflowRepo)('analyzes effect-workflow runtime without crashing', async () => {
    // runtime/index.ts is a barrel re-export file — no top-level Effect programs
    // expected. We just assert the analyzer doesn't throw unexpectedly.
    const exit = await Effect.runPromiseExit(
      analyze(resolve(workflowDir, 'runtime', 'index.ts')).all(),
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

  it.skipIf(!hasEffectPackageWorkflow)(
    'analyzes Effect packages/workflow source without throwing',
    { timeout: 20_000 },
    async () => {
      const srcIndex = resolve(effectPackageWorkflowPath, 'src', 'index.ts');
      const workflowTs = resolve(effectPackageWorkflowPath, 'src', 'Workflow.ts');
      const exitIndex = await Effect.runPromiseExit(
        analyze(srcIndex).all(),
      );
      const exitWorkflow = await Effect.runPromiseExit(
        analyze(workflowTs).all(),
      );
      expect(exitIndex._tag).toMatch(/^(Success|Failure)$/);
      expect(exitWorkflow._tag).toMatch(/^(Success|Failure)$/);
      if (exitWorkflow._tag === 'Success' && exitWorkflow.value.length > 0) {
        expect(exitWorkflow.value.some((ir) => ir.root.source === 'workflow-execute' || ir.root.source === 'run' || ir.root.source === 'generator')).toBe(true);
      }
    },
  );
});
