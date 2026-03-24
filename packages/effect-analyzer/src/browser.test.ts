import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import * as tsMorph from 'ts-morph';
import { analyzeSource, setTsMorphModule } from './browser';

describe('browser entrypoint', () => {
  it('supports source-only analysis with an injected ts-morph module', async () => {
    setTsMorphModule(tsMorph);

    const program = await Effect.runPromise(
      analyzeSource(
        `
          import { Effect } from "effect";

          export const program = Effect.gen(function* () {
            yield* Effect.log("hello");
            return 42;
          });
        `,
      ).single(),
    );

    expect(program.root.programName).toBe('program');
    expect(program.root.children.length).toBeGreaterThan(0);
  });
});
