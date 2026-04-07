import { describe, expect, it } from 'vitest';
import { Effect, Option } from 'effect';
import { analyzeEffectSource } from './static-analyzer';
import { renderExplanation } from './output/explain';
import type { StaticEffectNode, StaticFlowNode } from './types';
import { getStaticChildren, isStaticEffectNode } from './types';

const collectEffectNodes = (nodes: readonly StaticFlowNode[]): StaticEffectNode[] => {
  const collected: StaticEffectNode[] = [];
  const visit = (node: StaticFlowNode): void => {
    if (isStaticEffectNode(node)) collected.push(node);
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    for (const child of children) visit(child);
  };
  for (const node of nodes) visit(node);
  return collected;
};

describe('t3code-inspired regressions', () => {
  it('hides top-level Effect.fn wrapper nodes in explain output', async () => {
    const [ir] = await Effect.runPromise(
      analyzeEffectSource(
        `
        import { Effect, Option, Schema } from "effect";

        class BootstrapError extends Error {}

        export const readBootstrapEnvelope = Effect.fn("readBootstrapEnvelope")(function* () {
          const fdReady = yield* Effect.succeed(true);
          if (!fdReady) return Option.none();
          return yield* Effect.callback<Option.Option<string>, BootstrapError>((resume) => {
            resume(Effect.succeed(Option.some("ok")));
            return Effect.sync(() => undefined);
          }).pipe(Effect.timeoutOption(1000), Effect.map(Option.flatten));
        });
        `,
        'bootstrap.ts',
      ),
    );

    const explanation = renderExplanation(ir);
    expect(explanation).toContain('Yields fdReady <- succeed');
    expect(explanation).toContain('Registers callback bridge');
    expect(explanation).not.toContain('Calls fn');
  });

  it('does not duplicate callback-return internals as sibling generator steps', async () => {
    const [ir] = await Effect.runPromise(
      analyzeEffectSource(
        `
        import { Effect, Option } from "effect";

        class BootstrapError extends Error {}

        export const readBootstrapEnvelope = Effect.fn("readBootstrapEnvelope")(function* () {
          const fdReady = yield* Effect.succeed(true);
          if (!fdReady) return Option.none();
          return yield* Effect.callback<Option.Option<string>, BootstrapError>((resume) => {
            resume(Effect.succeed(Option.some("ok")));
            return Effect.sync(() => undefined);
          }).pipe(Effect.timeoutOption(1000));
        });
        `,
        'bootstrap.ts',
      ),
    );

    const generator = ir.root.children.find((child) => child.type === 'generator');
    expect(generator?.type).toBe('generator');
    if (!generator || generator.type !== 'generator') return;

    expect(generator.yields).toHaveLength(2);
    const callbackNodes = collectEffectNodes(ir.root.children).filter(
      (node) => node.callee === 'Effect.callback',
    );
    expect(callbackNodes).toHaveLength(1);
    expect(renderExplanation(ir).match(/Registers callback bridge/g)?.length ?? 0).toBe(1);
  });

  it('models yielded service properties as service calls instead of unknown nodes', async () => {
    const [ir] = await Effect.runPromise(
      analyzeEffectSource(
        `
        import { Effect, ServiceMap } from "effect";

        interface CliConfigShape {
          readonly fixPath: Effect.Effect<void>;
        }

        class CliConfig extends ServiceMap.Service<CliConfig, CliConfigShape>()("CliConfig") {}

        export const makeServerProgram = Effect.gen(function* () {
          const cliConfig = yield* CliConfig;
          yield* cliConfig.fixPath;
          return yield* Effect.succeed("ok");
        });
        `,
        'main.ts',
      ),
    );

    const effectNodes = collectEffectNodes(ir.root.children);
    const fixPathNode = effectNodes.find((node) => node.callee === 'cliConfig.fixPath');
    expect(fixPathNode?.serviceCall?.serviceType).toBe('CliConfig');
    expect(ir.root.dependencies.map((dep) => dep.name)).toContain('CliConfig');
    expect(renderExplanation(ir)).toContain('Calls CliConfig.fixPath');
  });

  it('does not treat STM primitives as service dependencies', async () => {
    const [ir] = await Effect.runPromise(
      analyzeEffectSource(
        `
        import { Effect, TxQueue, TxRef } from "effect";
        import type { Scope } from "effect";

        export const makeDrainableWorker = <A>(process: (item: A) => Effect.Effect<void>) =>
          Effect.gen(function* () {
            const ref = yield* TxRef.make(0);
            const queue = yield* Effect.acquireRelease(TxQueue.unbounded<A>(), (queue) =>
              TxQueue.shutdown(queue),
            );
            yield* Effect.succeed({ ref, queue, process });
          });
        `,
        'DrainableWorker.ts',
      ),
    );

    expect(ir.root.dependencies.map((dep) => dep.name)).toEqual([]);
  });

  it('renders built-in platform services with consistent dotted names', async () => {
    const [ir] = await Effect.runPromise(
      analyzeEffectSource(
        `
        import { Effect } from "effect";
        import { FileSystem } from "@effect/platform";

        export const program = Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          yield* fileSystem.exists("/tmp/demo");
        });
        `,
        'fs.ts',
      ),
    );

    const explanation = renderExplanation(ir);
    expect(explanation).toContain('Services required: FileSystem.FileSystem');
    expect(explanation).not.toContain('Services required: FileSystem\n');
  });

  it('models service stream properties as reactor streams instead of unknown sources', async () => {
    const [ir] = await Effect.runPromise(
      analyzeEffectSource(
        `
        import { Effect, Stream, ServiceMap } from "effect";

        interface ProviderShape {
          readonly streamChanges: Stream.Stream<number>;
        }

        class Provider extends ServiceMap.Service<Provider, ProviderShape>()("Provider") {}

        export const program = Effect.gen(function* () {
          const provider = yield* Provider;
          yield* Stream.runForEach(provider.streamChanges, () => Effect.sync(() => undefined)).pipe(
            Effect.forkScoped,
          );
        });
        `,
        'ProviderRegistry.ts',
      ),
    );

    const explanation = renderExplanation(ir);
    expect(explanation).toContain('Background stream reactor (Provider.streamChanges)');
    expect(explanation).not.toContain('Could not determine effect type');
  });

  it('summarizes callback handlers instead of only shallow callback internals', async () => {
    const [ir] = await Effect.runPromise(
      analyzeEffectSource(
        `
        import { Effect, Option, Result } from "effect";

        class BootstrapError extends Error {}

        export const readBootstrapEnvelope = Effect.fn("readBootstrapEnvelope")(function* () {
          return yield* Effect.callback<Option.Option<string>, BootstrapError>((resume) => {
            const handleError = (error: Error) => {
              resume(Effect.fail(error));
            };

            const handleLine = (line: string) => {
              const parsed = Result.succeed(line);
              if (Result.isSuccess(parsed)) {
                resume(Effect.succeed(Option.some(parsed.value)));
              }
            };

            return Effect.sync(() => {
              handleError(new Error("boom"));
              handleLine("ok");
            });
          });
        });
        `,
        'bootstrap.ts',
      ),
    );

    const explanation = renderExplanation(ir);
    expect(explanation).toContain('Calls handleError — callback-handler');
    expect(explanation).toContain('Calls handleLine — callback-handler');
    expect(explanation).toContain('Calls resume -> Effect.fail(error) — callback-resume');
    expect(explanation).toContain('Calls resume -> Effect.succeed(Option.some(parsed.value)) — callback-resume');
  });

  it('keeps service property effects inside Effect.all branches', async () => {
    const [ir] = await Effect.runPromise(
      analyzeEffectSource(
        `
        import { Effect, ServiceMap } from "effect";

        interface ProviderShape {
          readonly refresh: Effect.Effect<void>;
        }

        class CodexProvider extends ServiceMap.Service<CodexProvider, ProviderShape>()("CodexProvider") {}
        class ClaudeProvider extends ServiceMap.Service<ClaudeProvider, ProviderShape>()("ClaudeProvider") {}

        export const refresh = Effect.gen(function* () {
          const codexProvider = yield* CodexProvider;
          const claudeProvider = yield* ClaudeProvider;
          yield* Effect.all([codexProvider.refresh, claudeProvider.refresh], {
            concurrency: "unbounded",
          });
        });
        `,
        'ProviderRegistry.ts',
      ),
    );

    const explanation = renderExplanation(ir);
    expect(explanation).toContain('Calls CodexProvider.refresh');
    expect(explanation).toContain('Calls ClaudeProvider.refresh');
    expect(explanation).not.toContain('Could not determine effect type');
  });
});
