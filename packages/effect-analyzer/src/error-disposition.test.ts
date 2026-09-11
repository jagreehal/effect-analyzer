/**
 * `catchTag` and `orDie` both shrink `E`. They are opposites, and the analyzer
 * used to report both as "handled" — so a program that turned every typed
 * error into a defect looked identical to one that dealt with them.
 */
import { Effect } from 'effect';
import { describe, it, expect } from 'vitest';
import { analyzeErrorPropagation, errorDisposition } from './error-flow';
import { classifyErrorHandlerName } from './error-handler-analyzer';
import { flattenIR } from './ir';
import { analyzeEffectSource } from './static-analyzer';
import { analyze } from './analysis-entry';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StaticEffectIR, StaticFlowNode } from './types';

/** One handler wrapped around one failing step, as bare IR. */
const handlerOver = (
  handlerType: string,
  errorType: string,
  errorTag?: string,
): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'test',
    source: 'generator',
    children: [
      {
        id: 'handler-1',
        type: 'error-handler',
        handlerType,
        ...(errorTag ? { errorTag } : {}),
        source: {
          id: 'n1',
          type: 'effect',
          callee: 'step',
          typeSignature: {
            successType: 'unknown',
            errorType,
            requirementsType: 'never',
            isInferred: false,
            typeConfidence: 'declared',
          },
        },
      } as unknown as StaticFlowNode,
    ],
    dependencies: [],
    errorTypes: [],
  },
  metadata: {
    analyzedAt: 0,
    filePath: 'test.ts',
    stats: {
      totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0,
      retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0,
      conditionalCount: 0, layerCount: 0, unknownCount: 0,
      interruptionCount: 0, decisionCount: 0, switchCount: 0,
    },
  },
  references: new Map(),
});

const removedBy = (handlerType: string, errorType: string, errorTag?: string): string[] => {
  const narrowed = analyzeErrorPropagation(handlerOver(handlerType, errorType, errorTag))
    .propagation.find((p) => p.narrowedBy);
  return narrowed?.narrowedBy?.removedErrors ?? [];
};

describe('errorDisposition', () => {
  it.each([
    ['catchTag', 'handled'],
    ['catchReason', 'handled'],
    ['catchNoSuchElement', 'handled'],
    ['mapError', 'transformed'],
    ['orDie', 'defect'],
    ['filterOrDie', 'defect'],
    ['ignore', 'swallowed'],
    ['orElseSucceed', 'swallowed'],
  ] as const)('%s is %s', (handlerType, expected) => {
    expect(errorDisposition(handlerType)).toBe(expected);
  });
});

describe('classifyErrorHandlerName', () => {
  it('does not fold Effect 4 selective catches into catch-everything', () => {
    // Substring matching: without a longest-first order these all read as
    // 'catch', which removes the whole error channel instead of one member.
    expect(classifyErrorHandlerName('Effect.catchReason')).toBe('catchReason');
    expect(classifyErrorHandlerName('Effect.catchReasons')).toBe('catchReasons');
    expect(classifyErrorHandlerName('Effect.catchFilter')).toBe('catchFilter');
    expect(classifyErrorHandlerName('Effect.catchCauseIf')).toBe('catchCauseIf');
    expect(classifyErrorHandlerName('Effect.catch')).toBe('catch');
  });
});

describe('uncalled combinators in a pipe', () => {
  it(
    'sees Effect.orDie, which is passed without being called',
    { timeout: 20_000 },
    async () => {
      const irs = await Effect.runPromise(
        analyzeEffectSource(`
          import { Effect } from 'effect';
          declare const fetchRate: () => Effect.Effect<number, 'RateError'>;
          export const prog = Effect.gen(function* () {
            return yield* fetchRate().pipe(Effect.orDie);
          });
        `),
      );
      const ir = irs.find((p) => p.root.programName === 'prog');
      expect(ir, 'expected a program named prog').toBeDefined();

      const handlerTypes = flattenIR(ir!.root.children).flatMap((n) =>
        n.type === 'error-handler' ? [n.handlerType] : [],
      );
      expect(handlerTypes).toContain('orDie');
      expect(ir!.metadata.stats.errorHandlerCount).toBe(1);
    },
  );
});

describe('what a handler actually takes off the channel', () => {
  it.each(['filterOrFail', 'filterOrElse', 'filterOrDie', 'filterOrDieMessage'])(
    '%s leaves existing errors in E',
    (handlerType) => {
      // These test the *success* value: `Effect<A, E, R> => Effect<B, E2 | E, R>`.
      // Treating them as catch-alls made RateError vanish from the diagram.
      expect(removedBy(handlerType, 'RateError')).toEqual([]);
    },
  );

  it('catchNoSuchElement takes only NoSuchElementError', () => {
    // Exclude<E, Cause.NoSuchElementError> — not a share of whatever E holds.
    expect(removedBy('catchNoSuchElement', 'RateError | OtherError')).toEqual([]);
    expect(removedBy('catchNoSuchElement', 'RateError | NoSuchElementError'))
      .toEqual(['NoSuchElementError']);
  });

  it('catchTag still takes the tag it names', () => {
    expect(removedBy('catch', 'RateError')).toEqual(['RateError']);
  });
});

describe('qualified error names', () => {
  it(
    'catchNoSuchElement takes Cause.NoSuchElementError as printed by the checker',
    { timeout: 60_000 },
    async () => {
      const fixture = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '__fixtures__/qualified-error-names.ts',
      );
      const ir = await Effect.runPromise(analyze(fixture).named('withNoSuchElement'));

      const narrowed = analyzeErrorPropagation(ir).propagation.find((p) => p.narrowedBy);
      expect(narrowed?.narrowedBy?.handler).toBe('catchNoSuchElement');
      // Matched through the qualifier, removed under the spelling it carries.
      expect(narrowed?.narrowedBy?.removedErrors).toEqual(['Cause.NoSuchElementError']);
      expect(narrowed?.possibleErrors).toEqual(['RateError']);
    },
  );

  it('keeps A.Error and B.Error as two errors', () => {
    // Qualifiers are identity. Normalising every parsed name would fold two
    // separately tagged classes into one node and one propagation entry.
    const ir = handlerOver('catch', 'A.Error | B.Error');
    const first = analyzeErrorPropagation(ir).propagation[0];
    expect(first?.possibleErrors).toEqual(['A.Error', 'B.Error']);
  });

  it('catchTag with no literal tag removes nothing rather than guessing', () => {
    expect(removedBy('catchTag', 'RateError | LedgerError')).toEqual([]);
  });

  it('catchTag matches a bare tag against a qualified error', () => {
    expect(removedBy('catchTag', 'Cause.NoSuchElementError', 'NoSuchElementError'))
      .toEqual(['Cause.NoSuchElementError']);
  });
});
