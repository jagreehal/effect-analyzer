/**
 * Retry / Timeout / Schedule call analyzers.
 *
 * Retry and Timeout both need to recurse into their source effect via
 * `deps.analyzeEffectExpression`. The standalone Schedule analyzer is purely
 * structural and doesn't recurse, but it lives here for cohesion with the
 * temporal-control analyzers.
 *
 * Extracted from effect-analysis.ts via the strangler-fig DI pattern —
 * behaviour is preserved exactly.
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
  StaticRetryNode,
  StaticTimeoutNode,
  StaticScheduleNode,
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
  getNodeText,
} from './analysis-utils';
import { SCHEDULE_OP_MAP } from './analysis-patterns';
import { parseScheduleInfo } from './analysis-classifiers';
import type { AnalysisContext } from './analysis-context';

export const analyzeRetryCall = (
  deps: AnalysisContext,
  call: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticRetryNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    let source: StaticFlowNode;
    let schedule: string | undefined;
    let scheduleNode: StaticFlowNode | undefined;
    let hasFallback: boolean;

    const expr = call.getExpression();
    if (expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression) {
      const propAccess = expr as PropertyAccessExpression;
      const exprSource = propAccess.getExpression();
      source = yield* deps.analyzeEffectExpression(
        exprSource,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );

      if (args.length > 0 && args[0]) {
        schedule = args[0].getText();
        scheduleNode = yield* deps.analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      }

      hasFallback = expr.getText().includes('retryOrElse');
    } else {
      if (args.length > 0 && args[0]) {
        source = yield* deps.analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      } else {
        source = {
          id: generateId(),
          type: 'unknown',
          reason: 'Could not determine source effect',
        };
      }

      if (args.length > 1 && args[1]) {
        schedule = args[1].getText();
        scheduleNode = yield* deps.analyzeEffectExpression(
          args[1],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      }

      hasFallback = args.length > 2;
    }

    stats.retryCount++;

    const scheduleInfo = schedule ? parseScheduleInfo(schedule) : undefined;

    const retryNode: StaticRetryNode = {
      id: generateId(),
      type: 'retry',
      source,
      schedule,
      ...(scheduleNode !== undefined ? { scheduleNode } : {}),
      hasFallback,
      scheduleInfo,
      retryEdgeLabel: schedule ? `retry: ${schedule}` : 'retry',
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...retryNode,
      displayName: computeDisplayName(retryNode),
      semanticRole: computeSemanticRole(retryNode),
    };
  });

export const analyzeTimeoutCall = (
  deps: AnalysisContext,
  call: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticTimeoutNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    let source: StaticFlowNode;
    let duration: string | undefined;
    let hasFallback: boolean;

    const expr = call.getExpression();
    if (expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression) {
      const propAccess = expr as PropertyAccessExpression;
      const exprSource = propAccess.getExpression();
      source = yield* deps.analyzeEffectExpression(
        exprSource,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );

      if (args.length > 0 && args[0]) {
        duration = getNodeText(args[0]);
      }

      const exprText = getNodeText(expr);
      hasFallback =
        exprText.includes('timeoutFail') ||
        exprText.includes('timeoutTo');
    } else {
      if (args.length > 0 && args[0]) {
        source = yield* deps.analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      } else {
        source = {
          id: generateId(),
          type: 'unknown',
          reason: 'Could not determine source effect',
        };
      }

      if (args.length > 1 && args[1]) {
        duration = getNodeText(args[1]);
      }

      hasFallback = args.length > 2;
    }

    stats.timeoutCount++;

    const timeoutNode: StaticTimeoutNode = {
      id: generateId(),
      type: 'timeout',
      source,
      duration,
      hasFallback,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...timeoutNode,
      displayName: computeDisplayName(timeoutNode),
      semanticRole: computeSemanticRole(timeoutNode),
    };
  });

/** Analyze Schedule.exponential / spaced / jittered / andThen / etc. (GAP 8 dedicated IR). */
export const analyzeScheduleCall = (
  call: CallExpression,
  callee: string,
  filePath: string,
  opts: Required<AnalyzerOptions>,
): Effect.Effect<StaticScheduleNode, AnalysisError> =>
  Effect.sync(() => {
    const scheduleOp: StaticScheduleNode['scheduleOp'] =
      SCHEDULE_OP_MAP[callee] ?? 'other';
    const scheduleText = call.getText();
    const scheduleInfo = parseScheduleInfo(scheduleText);
    const scheduleNode: StaticScheduleNode = {
      id: generateId(),
      type: 'schedule',
      scheduleOp,
      ...(scheduleInfo ? { scheduleInfo } : {}),
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...scheduleNode,
      displayName: computeDisplayName(scheduleNode),
      semanticRole: computeSemanticRole(scheduleNode),
    };
  });
