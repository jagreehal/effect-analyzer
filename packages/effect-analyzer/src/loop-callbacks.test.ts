import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { analyze } from './analyze';
import { renderExplanation } from './output/explain';

describe('loop callback summaries', () => {
  it('summarizes reducer callbacks instead of reporting unknown loop bodies', async () => {
    const source = `
      import { Array } from "effect";

      export const program = Array.reduce([1, 2, 3], 0, (acc, n) => acc + n);
    `;

    const ir = await Effect.runPromise(analyze.source(source).named('program'));
    const explanation = renderExplanation(ir);

    expect(explanation).toContain('Iterates (reduce)');
    expect(explanation).toContain('Callback:');
    expect(explanation).toContain('Calls acc + n');
    expect(explanation).not.toContain('Could not determine loop body');
  });

  it('summarizes forEach callback workflows instead of only showing opaque callback bodies', async () => {
    const source = `
      import { Array, Effect } from "effect";

      export const program = Array.forEach([1, 2, 3], (n) =>
        Effect.sync(() => n).pipe(
          Effect.tap(() => Effect.sync(() => console.log(n))),
          Effect.retry({ times: 2 }),
          Effect.catchAll(() => Effect.sync(() => undefined)),
        ),
      );
    `;

    const ir = await Effect.runPromise(analyze.source(source).named('program'));
    const explanation = renderExplanation(ir);

    expect(explanation).toContain('forEach callback:');
    expect(explanation).toContain('Effect.retry');
    expect(explanation).toContain('Calls catchAll');
    expect(explanation).toContain('Callback:');
    expect(explanation).not.toContain('(opaque: callback-body)');
  });
});
