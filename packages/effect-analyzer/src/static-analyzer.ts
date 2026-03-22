/**
 * Static Effect Analyzer
 *
 * Uses ts-morph to walk the TypeScript AST and extract Effect structure
 * without executing the code. Built entirely with Effect for composability.
 *
 * Public API: analyzeEffectFile, analyzeEffectSource, resetIdCounter.
 * Implementation is split across analysis-utils, analysis-patterns, alias-resolution,
 * program-discovery, effect-analysis, and core-analysis.
 */

import { Effect } from 'effect';
import {
  loadTsMorph,
  createProject,
  createProjectFromSource,
} from './ts-morph-loader';
import { AnalysisError } from './types';
import type { StaticEffectIR, AnalyzerOptions } from './types';
import { DEFAULT_OPTIONS, isJsOrJsxPath } from './analysis-utils';
import { findEffectPrograms } from './program-discovery';
import { analyzeProgram } from './core-analysis';

export { resetIdCounter } from './analysis-utils';

export const analyzeEffectFile = (
  filePath: string,
  options?: AnalyzerOptions,
): Effect.Effect<readonly StaticEffectIR[], AnalysisError> =>
  Effect.gen(function* () {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { ts, Project } = loadTsMorph();

    const project = yield* Effect.try({
      try: () => {
        if (isJsOrJsxPath(filePath)) {
          return new Project({
            skipAddingFilesFromTsConfig: true,
            compilerOptions: { allowJs: true },
          });
        }
        return createProject(opts.tsConfigPath);
      },
      catch: (error) =>
        new AnalysisError(
          'PROJECT_CREATION_FAILED',
          `Failed to create project: ${String(error)}`,
        ),
    });

    const existingFile = project.getSourceFile(filePath);
    if (existingFile) {
      project.removeSourceFile(existingFile);
    }

    const sourceFile = yield* Effect.try({
      try: () => project.addSourceFileAtPath(filePath),
      catch: (error) =>
        new AnalysisError(
          'FILE_NOT_FOUND',
          `Failed to load file ${filePath}: ${String(error)}`,
        ),
    });

    const programs = findEffectPrograms(sourceFile, opts);

    if (programs.length === 0) {
      return yield* Effect.fail(
        new AnalysisError(
          'NO_EFFECTS_FOUND',
          `No Effect programs found in ${filePath}`,
        ),
      );
    }

    return yield* Effect.forEach(
      programs,
      (program) =>
        analyzeProgram(program, sourceFile, filePath, opts, ts.version),
      { concurrency: 'unbounded' },
    );
  });

export const analyzeEffectSource = (
  code: string,
  filePath = 'temp.ts',
  options?: AnalyzerOptions,
): Effect.Effect<readonly StaticEffectIR[], AnalysisError> =>
  Effect.gen(function* () {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { ts } = loadTsMorph();

    const sourceFile = yield* Effect.try({
      try: () => createProjectFromSource(code, filePath),
      catch: (error) =>
        new AnalysisError(
          'SOURCE_PARSE_FAILED',
          `Failed to parse source: ${String(error)}`,
        ),
    });

    const programs = findEffectPrograms(sourceFile, opts);

    if (programs.length === 0) {
      return yield* Effect.fail(
        new AnalysisError(
          'NO_EFFECTS_FOUND',
          `No Effect programs found in source`,
        ),
      );
    }

    return yield* Effect.forEach(
      programs,
      (program) =>
        analyzeProgram(program, sourceFile, filePath, opts, ts.version),
      { concurrency: 'unbounded' },
    );
  });
