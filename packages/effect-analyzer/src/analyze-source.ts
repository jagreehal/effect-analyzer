/**
 * Fluent source-only analyzer API for browser and worker environments.
 */

import { Effect, Option } from 'effect';
import { AnalysisError } from './types';
import type { StaticEffectIR, AnalyzerOptions } from './types';
import { analyzeEffectSource, resetIdCounter } from './static-analyzer';

export interface AnalyzeSourceResult {
  readonly single: () => Effect.Effect<StaticEffectIR, AnalysisError>;
  readonly singleOption: () => Effect.Effect<Option.Option<StaticEffectIR>>;
  readonly all: () => Effect.Effect<readonly StaticEffectIR[], AnalysisError>;
  readonly named: (name: string) => Effect.Effect<StaticEffectIR, AnalysisError>;
  readonly first: () => Effect.Effect<StaticEffectIR, AnalysisError>;
  readonly firstOption: () => Effect.Effect<Option.Option<StaticEffectIR>>;
}

const createResult = (
  programs: readonly StaticEffectIR[],
): AnalyzeSourceResult => ({
  single: () =>
    Effect.gen(function* () {
      if (programs.length === 1) {
        const program = programs[0];
        if (program) {
          return program;
        }
      }
      return yield* Effect.fail(
        new AnalysisError(
          'NOT_SINGLE_PROGRAM',
          `Expected exactly 1 program, found ${String(programs.length)}`,
        ),
      );
    }),

  singleOption: () =>
    Effect.gen(function* () {
      if (programs.length === 1) {
        const program = programs[0];
        if (program) {
          return Option.some(program);
        }
      }
      return Option.none<StaticEffectIR>();
    }).pipe(Effect.orDie),

  all: () => Effect.succeed(programs),

  named: (name: string) =>
    Effect.gen(function* () {
      const found = programs.find((p) => p.root.programName === name);
      if (!found) {
        const available = programs.map((p) => p.root.programName).join(', ');
        return yield* Effect.fail(
          new AnalysisError(
            'PROGRAM_NOT_FOUND',
            `Program "${name}" not found. Available: ${available || '(none)'}`,
          ),
        );
      }
      return found;
    }),

  first: () =>
    Effect.gen(function* () {
      const program = programs[0];
      if (program) {
        return program;
      }
      return yield* Effect.fail(
        new AnalysisError('NO_PROGRAMS', 'No programs found'),
      );
    }),

  firstOption: () =>
    Effect.gen(function* () {
      const program = programs[0];
      if (program) {
        return Option.some(program);
      }
      return Option.none<StaticEffectIR>();
    }).pipe(Effect.orDie),
});

export const analyzeSource = (
  code: string,
  options?: AnalyzerOptions,
): AnalyzeSourceResult => {
  resetIdCounter();

  const programsEffect = analyzeEffectSource(code, 'temp.ts', options);

  return {
    single: () =>
      Effect.gen(function* () {
        const programs = yield* programsEffect;
        return yield* createResult(programs).single();
      }),

    singleOption: () =>
      Effect.gen(function* () {
        const programs = yield* programsEffect;
        return yield* createResult(programs).singleOption();
      }).pipe(Effect.orDie),

    all: () => programsEffect,

    named: (name: string) =>
      Effect.gen(function* () {
        const programs = yield* programsEffect;
        return yield* createResult(programs).named(name);
      }),

    first: () =>
      Effect.gen(function* () {
        const programs = yield* programsEffect;
        return yield* createResult(programs).first();
      }),

    firstOption: () =>
      Effect.gen(function* () {
        const programs = yield* programsEffect;
        return yield* createResult(programs).firstOption();
      }).pipe(Effect.orDie),
  };
};
