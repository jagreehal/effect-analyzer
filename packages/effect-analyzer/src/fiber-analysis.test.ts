import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { analyze } from './analyze';
import { analyzeFiberLeaks } from './fiber-analysis';

describe('fiber leak analysis', () => {
  it('does not treat any join in the tree as proof that every fork is safe', async () => {
    const source = `
      import { Effect, Fiber } from "effect";

      export const program = Effect.gen(function* () {
        const joined = yield* Effect.fork(Effect.succeed(1));
        const leaked = yield* Effect.fork(Effect.succeed(2));
        yield* Fiber.join(joined);
        return leaked;
      });
    `;

    const ir = await Effect.runPromise(analyze.source(source).single());
    const result = analyzeFiberLeaks(ir);

    expect(result.summary.total).toBe(2);
    expect(result.summary.safe).toBe(1);
    expect(result.summary.potentialLeaks).toBe(1);
  });
});
