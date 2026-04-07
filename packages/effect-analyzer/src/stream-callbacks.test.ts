import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { analyze } from './analyze';
import { renderMultipleExplanations } from './output/explain';

describe('stream callback summaries', () => {
  it('renders pure and effectful stream callbacks in explanations', async () => {
    const source = `
      import { Effect, Stream } from "effect";

      export const mapped = Effect.runPromise(
        Stream.fromIterable([1, 2, 3]).pipe(
          Stream.map((n) => n * 2),
          Stream.filter((n) => n % 2 === 0),
          Stream.flatMap((n) => Stream.fromIterable([n, n + 1])),
          Stream.mapEffect((n) => Effect.succeed(n + 10)),
          Stream.runCollect,
        ),
      );
    `;

    const programs = await Effect.runPromise(analyze.source(source).all());
    const explanation = renderMultipleExplanations(programs);

    expect(explanation).toContain('map callback:');
    expect(explanation).toContain('filter callback:');
    expect(explanation).toContain('flatMap callback:');
    expect(explanation).toContain('mapEffect callback:');
    expect(explanation).toContain('Calls n * 2');
    expect(explanation).toContain('If n % 2 === 0');
    expect(explanation).toContain('Calls fromIterable');
    expect(explanation).toContain('Calls succeed');
  });
});
