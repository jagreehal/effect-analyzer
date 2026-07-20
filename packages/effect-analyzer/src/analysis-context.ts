/** Shared recursive context for domain-specific expression analyzers. */

import type { Effect } from 'effect';
import type { Node, SourceFile } from 'ts-morph';
import type {
  AnalysisError,
  AnalysisStats,
  AnalysisWarning,
  AnalyzerOptions,
  StaticFlowNode,
} from './types';

export type AnalyzeEffectExpression = (
  node: Node,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  serviceScope?: Map<string, string>,
) => Effect.Effect<StaticFlowNode, AnalysisError>;

export interface AnalysisContext {
  readonly analyzeEffectExpression: AnalyzeEffectExpression;
}

/**
 * Close recursive dispatch behind one context. The getter is intentionally
 * lazy so module initialization order is not part of any analyzer interface.
 */
export const createAnalysisContext = (
  getAnalyze: () => AnalyzeEffectExpression,
): AnalysisContext => ({
  get analyzeEffectExpression() {
    return getAnalyze();
  },
});

export type BindAnalysisContext<F> = F extends (
  context: AnalysisContext,
  ...args: infer Args
) => infer Output
  ? (...args: Args) => Output
  : never;

export const bindAnalysisContext = <
  F extends (context: AnalysisContext, ...args: never[]) => unknown,
>(
  context: AnalysisContext,
  analyzer: F,
): BindAnalysisContext<F> =>
  ((...args: never[]) => analyzer(context, ...args)) as BindAnalysisContext<F>;
