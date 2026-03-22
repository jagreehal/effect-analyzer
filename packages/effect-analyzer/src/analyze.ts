/**
 * Fluent Builder API for Static Effect Analysis
 *
 * Provides an ergonomic API for analyzing Effect files with explicit intent.
 * Built entirely with Effect for composability.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { analyze } from "effect-analyzer";
 *
 * // Single program file
 * const ir = await Effect.runPromise(analyze("./program.ts").single());
 *
 * // Multi-program file
 * const programs = await Effect.runPromise(analyze("./programs.ts").all());
 *
 * // Get specific program by name
 * const program = await Effect.runPromise(analyze("./programs.ts").named("myProgram"));
 *
 * // From source string
 * const ir = await Effect.runPromise(analyze.source(code).single());
 * ```
 */

import { Effect, Option } from 'effect';
import { AnalysisError } from './types';
import type { StaticEffectIR, AnalyzerOptions } from './types';
import {
  analyzeEffectFile,
  analyzeEffectSource,
  resetIdCounter,
} from './static-analyzer';

/**
 * Result object from analyze() with fluent methods to retrieve programs.
 */
export interface AnalyzeResult {
  /**
   * Get single program. Fails if file has 0 or >1 programs.
   */
  readonly single: () => Effect.Effect<StaticEffectIR, AnalysisError>;

  /**
   * Get single program or None if not exactly one.
   */
  readonly singleOption: () => Effect.Effect<
    Option.Option<StaticEffectIR>
  >;

  /**
   * Get all programs as array.
   */
  readonly all: () => Effect.Effect<
    readonly StaticEffectIR[],
    AnalysisError
  >;

  /**
   * Get program by name. Fails if not found.
   */
  readonly named: (
    name: string,
  ) => Effect.Effect<StaticEffectIR, AnalysisError>;

  /**
   * Get first program. Fails if empty.
   */
  readonly first: () => Effect.Effect<StaticEffectIR, AnalysisError>;

  /**
   * Get first program or None if empty.
   */
  readonly firstOption: () => Effect.Effect<
    Option.Option<StaticEffectIR>
  >;
}

const createResult = (
  programs: readonly StaticEffectIR[],
): AnalyzeResult => ({
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
    }),

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
    }),
});

/**
 * Analyze an Effect file and return a fluent result object.
 *
 * @param filePath - Path to the TypeScript file containing the Effect program(s)
 * @param options - Analysis options
 * @returns Fluent result object with methods to retrieve programs
 *
 * @example
 * ```typescript
 * // Single program file
 * const ir = await Effect.runPromise(analyze("./program.ts").single());
 *
 * // Multiple programs - get all as array
 * const programs = await Effect.runPromise(analyze("./programs.ts").all());
 *
 * // Get specific program by name
 * const program = await Effect.runPromise(analyze("./programs.ts").named("myProgram"));
 * ```
 */
export const analyze = (
  filePath: string,
  options?: AnalyzerOptions,
): AnalyzeResult => {
  // Reset ID counter for deterministic results
  resetIdCounter();

  // Lazily evaluate the analysis
  const programsEffect = analyzeEffectFile(filePath, options);

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

/**
 * Analyze Effect source code directly (for testing or dynamic analysis).
 *
 * @param code - TypeScript source code containing the Effect program(s)
 * @param options - Analysis options
 * @returns Fluent result object with methods to retrieve programs
 *
 * @example
 * ```typescript
 * const source = `
 *   const program = Effect.gen(function* () {
 *     yield* Effect.log("Hello");
 *     return 42;
 *   });
 * `;
 *
 * const ir = await Effect.runPromise(analyze.source(source).single());
 * ```
 */
analyze.source = (code: string, options?: AnalyzerOptions): AnalyzeResult => {
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
