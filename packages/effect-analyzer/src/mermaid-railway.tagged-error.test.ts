import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { analyzeEffectSource } from './static-analyzer';
import { renderRailwayMermaid } from './output/mermaid-railway';

describe('railway TaggedError tags', () => {
  it('labels err branches with the _tag, not a stripped class name', { timeout: 20_000 }, async () => {
    const irs = await Effect.runPromise(
      analyzeEffectSource(`
        import { Data, Effect } from 'effect';

        class NotFound extends Data.TaggedError('NOT_FOUND')<{ readonly id: string }> {}
        class FetchError extends Data.TaggedError('FETCH_ERROR')<{ readonly userId: string }> {}

        const getUser = (id: string): Effect.Effect<{ id: string; name: string }, NotFound> =>
          id === '1'
            ? Effect.succeed({ id: '1', name: 'Alice' })
            : Effect.fail(new NotFound({ id }));

        const getOrders = (userId: string): Effect.Effect<{ id: number }[], FetchError> =>
          Effect.succeed([{ id: 1 }]);

        export const fetchUserAndOrders = Effect.gen(function* () {
          const user = yield* getUser('1');
          const orders = yield* getOrders(user.id);
          return { user, orders };
        });
      `),
    );

    const ir = irs.find((program) => program.root.programName === 'fetchUserAndOrders');
    expect(ir, 'expected fetchUserAndOrders').toBeDefined();

    const diagram = renderRailwayMermaid(ir!);
    expect(diagram).toContain('getUser');
    expect(diagram).toContain('getOrders');
    expect(diagram).not.toContain('#lt;-');
    expect(diagram).toContain('NOT_FOUND');
    expect(diagram).toContain('FETCH_ERROR');
    expect(diagram).not.toContain('["Fetch"]');
  });
});
