/** Shared recursive context for domain-specific expression analyzers. */

import type { Effect } from "effect"
import type { Node, SourceFile } from "ts-morph"
import type { AnalysisError, AnalysisStats, AnalysisWarning, AnalyzerOptions, StaticFlowNode } from "./types"

export type AnalyzeEffectExpression = (
  node: Node,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats,
  serviceScope?: Map<string, string>
) => Effect.Effect<StaticFlowNode, AnalysisError>

export interface AnalysisContext {
  readonly analyzeEffectExpression: AnalyzeEffectExpression
}

/**
 * Close recursive dispatch behind one context. The getter is intentionally
 * lazy so module initialization order is not part of any analyzer interface.
 */
export const createAnalysisContext = (
  getAnalyze: () => AnalyzeEffectExpression
): AnalysisContext => ({
  get analyzeEffectExpression() {
    return getAnalyze()
  }
})

/**
 * The same context, with a generator's service scope (`s` → `Svc`) carried into
 * every recursive call that doesn't bring its own. Callbacks inside a pipe step
 * (`Effect.tapError(() => s.cleanup)`) then resolve `s.cleanup` as a service
 * call, the same as `s.a` at the head of the pipe.
 */
export const withServiceScope = (
  deps: AnalysisContext,
  serviceScope: Map<string, string> | undefined
): AnalysisContext =>
  serviceScope === undefined ? deps : {
    analyzeEffectExpression: (node, sourceFile, filePath, opts, warnings, stats, scope) =>
      deps.analyzeEffectExpression(node, sourceFile, filePath, opts, warnings, stats, scope ?? serviceScope)
  }

export type BindAnalysisContext<F> = F extends (
  context: AnalysisContext,
  ...args: infer Args
) => infer Output ? (...args: Args) => Output
  : never

export const bindAnalysisContext = <
  F extends (context: AnalysisContext, ...args: Array<never>) => unknown
>(
  context: AnalysisContext,
  analyzer: F
): BindAnalysisContext<F> => ((...args: Array<never>) => analyzer(context, ...args)) as BindAnalysisContext<F>
