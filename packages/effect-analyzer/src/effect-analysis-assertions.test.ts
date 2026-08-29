/**
 * A type assertion is not a program. `Effect.succeed(1) as Effect.Effect<number>`
 * is the same effect as `Effect.succeed(1)`, and the analyzer used to give up
 * at the `as` and emit an unknown node.
 *
 * Auditing Effect's own source found this is the single largest resolution gap
 * in the analyzer: of 141 nodes landing in the `Could not determine effect
 * type` bucket, 108 were `AsExpression`. Effect code asserts constantly, so the
 * walker was blinding itself on one of the language's most common wrappers.
 *
 * `unwrapExpression` in core-analysis.ts already handled exactly this set. It
 * was never exported, so the classifier could not reach it.
 */
import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import './register-node-ts-morph';
import { analyzeEffectSource } from './static-analyzer';
import type { StaticEffectIR } from './types';

const analyze = (src: string): Promise<readonly StaticEffectIR[]> =>
  Effect.runPromise(analyzeEffectSource(src));

/**
 * The whole IR as text. These tests ask whether a value appears anywhere in the
 * tree, which is a substring question, so walking the nodes to ask it was work
 * the serializer already does.
 */
const text = (irs: readonly StaticEffectIR[]): string => JSON.stringify(irs);

describe('type assertions are transparent', () => {
  it.each([
    ['as', `yield* (Effect.succeed(1) as Effect.Effect<number>);`],
    ['satisfies', `yield* (Effect.succeed(1) satisfies Effect.Effect<number>);`],
    ['non-null', `yield* Effect.succeed(1)!;`],
    ['parenthesized', `yield* ((Effect.succeed(1)));`],
  ])('sees through a %s wrapper', async (_label, line) => {
    const irs = await analyze(`
import { Effect } from 'effect';
export const program = Effect.gen(function* () {
  ${line}
});
`);

    expect(irs.length).toBeGreaterThan(0);
    expect(text(irs)).not.toContain('Could not determine effect type');
  });

  it('keeps the asserted call recognisable as the effect it is', async () => {
    const irs = await analyze(`
import { Effect } from 'effect';
export const program = Effect.gen(function* () {
  yield* (Effect.fail('BOOM') as Effect.Effect<never, 'BOOM'>);
});
`);

    expect(text(irs)).toContain('"callee":"Effect.fail"');
  });
});
