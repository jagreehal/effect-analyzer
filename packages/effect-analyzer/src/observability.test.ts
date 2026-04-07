import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { analyze } from './analyze';
import { analyzeObservability } from './observability';

describe('observability analysis', () => {
  it('tracks named spans from merged withSpan annotations and nested effects', async () => {
    const source = `
      import { Effect } from "effect";

      export const program = Effect.gen(function* () {
        yield* Effect.log("outside");
        yield* Effect.succeed(1).pipe(
          Effect.withSpan("parent-span"),
          Effect.tap(() => Effect.log("inside")),
        );
        return yield* Effect.succeed(2).pipe(Effect.withSpan("child-span"));
      });
    `;

    const ir = await Effect.runPromise(analyze.source(source).single());
    const result = analyzeObservability(ir);

    expect(result.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining(['parent-span', 'child-span']),
    );
    expect(result.coverage.effectsWithSpans).toBeGreaterThan(0);
    expect(result.logPoints.length).toBeGreaterThan(0);
    expect(result.spans.every((span) => typeof span.childEffectCount === 'number')).toBe(true);
  });
});
