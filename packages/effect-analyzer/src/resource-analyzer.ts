/**
 * Resource (acquire/release) call analyzer.
 *
 * Covers Effect.acquireRelease, acquireUseRelease, ensuring, onExit, addFinalizer
 * and related scoped resource patterns. Recurses via `deps.analyzeEffectExpression`
 * for each effect argument.
 *
 * Extracted from effect-analysis.ts via the strangler-fig DI pattern.
 * Behaviour is preserved exactly.
 */

import { Effect } from 'effect';
import type {
  CallExpression,
  SourceFile,
  PropertyAccessExpression,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type {
  StaticFlowNode,
  StaticResourceNode,
  AnalyzerOptions,
  AnalysisWarning,
  AnalysisStats,
  AnalysisError,
} from './types';
import {
  generateId,
  extractLocation,
  computeDisplayName,
  computeSemanticRole,
} from './analysis-utils';
import type { AnalyzerDeps } from './stream-channel-sink-analyzers';

export const analyzeResourceCall = (
  deps: AnalyzerDeps,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticResourceNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    const resourceOperation = (/([A-Za-z_$][\w$]*)$/.exec(callee))?.[1] ?? callee;
    let acquire: StaticFlowNode;
    let release: StaticFlowNode;
    let useEffect: StaticFlowNode | undefined;

    if (resourceOperation.startsWith('acquireUseRelease')) {
      // acquireUseRelease / acquireUseReleaseInterruptible (acquire, use, release) - 3-arg form
      if (args.length >= 3 && args[0] && args[2]) {
        acquire = yield* deps.analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        release = yield* deps.analyzeEffectExpression(
          args[2],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        if (args[1]) {
          useEffect = yield* deps.analyzeEffectExpression(
            args[1],
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
        }
      } else {
        acquire = { id: generateId(), type: 'unknown', reason: 'Missing acquire' };
        release = { id: generateId(), type: 'unknown', reason: 'Missing release' };
      }
    } else if (resourceOperation.startsWith('acquireRelease')) {
      // acquireRelease / acquireReleaseInterruptible (acquire, release) - 2-arg form
      if (args.length >= 2 && args[0] && args[1]) {
        acquire = yield* deps.analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        release = yield* deps.analyzeEffectExpression(
          args[1],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      } else {
        acquire = {
          id: generateId(),
          type: 'unknown',
          reason: 'Missing acquire',
        };
        release = {
          id: generateId(),
          type: 'unknown',
          reason: 'Missing release',
        };
      }
    } else if (
      resourceOperation === 'addFinalizer' ||
      resourceOperation === 'onExit' ||
      resourceOperation === 'onError' ||
      resourceOperation === 'parallelFinalizers' ||
      resourceOperation === 'sequentialFinalizers' ||
      resourceOperation === 'finalizersMask' ||
      resourceOperation === 'using' ||
      resourceOperation === 'withEarlyRelease'
    ) {
      // Finalizer/cleanup patterns - acquire is the surrounding effect (method chain) or unknown
      const expr = call.getExpression();
      if (expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression) {
        const propAccess = expr as PropertyAccessExpression;
        acquire = yield* deps.analyzeEffectExpression(
          propAccess.getExpression(),
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      } else {
        acquire = { id: generateId(), type: 'unknown', reason: 'Scoped acquire' };
      }
      release =
        args.length > 0 && args[0]
          ? yield* deps.analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats)
          : { id: generateId(), type: 'unknown', reason: 'Missing finalizer' };
    } else if (resourceOperation === 'ensuring') {
      // Effect.ensuring(effect, cleanup)
      const expr = call.getExpression();
      if (
        expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression
      ) {
        const propAccess = expr as PropertyAccessExpression;
        const exprSource = propAccess.getExpression();
        acquire = yield* deps.analyzeEffectExpression(
          exprSource,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        release =
          args.length > 0 && args[0]
            ? yield* deps.analyzeEffectExpression(
                args[0],
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
              )
            : { id: generateId(), type: 'unknown', reason: 'Missing cleanup' };
      } else {
        acquire =
          args.length > 0 && args[0]
            ? yield* deps.analyzeEffectExpression(
                args[0],
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
              )
            : { id: generateId(), type: 'unknown', reason: 'Missing effect' };
        release =
          args.length > 1 && args[1]
            ? yield* deps.analyzeEffectExpression(
                args[1],
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
              )
            : { id: generateId(), type: 'unknown', reason: 'Missing cleanup' };
      }
    } else {
      acquire = {
        id: generateId(),
        type: 'unknown',
        reason: 'Unknown resource pattern',
      };
      release = {
        id: generateId(),
        type: 'unknown',
        reason: 'Unknown resource pattern',
      };
    }

    stats.resourceCount++;

    const resourceNode: StaticResourceNode = {
      id: generateId(),
      type: 'resource',
      acquire,
      release,
      use: useEffect,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...resourceNode,
      displayName: computeDisplayName(resourceNode),
      semanticRole: computeSemanticRole(resourceNode),
    };
  });
