/**
 * Parallel and Race call analyzers (Effect.all, Effect.allPar, Effect.race, ...).
 *
 * Both recurse via `deps.analyzeEffectExpression` into each branch / child effect.
 *
 * Extracted from effect-analysis.ts via the strangler-fig DI pattern.
 * Behaviour is preserved exactly.
 */

import { Effect } from "effect"
import type {
  ArrayLiteralExpression,
  CallExpression,
  ObjectLiteralExpression,
  PropertyAssignment,
  SourceFile
} from "ts-morph"
import { parseEffectAllOptions } from "./analysis-classifiers"
import type { AnalysisContext } from "./analysis-context"
import { computeDisplayName, computeSemanticRole, extractLocation, generateId, isConcurrent } from "./analysis-utils"
import { loadTsMorph } from "./ts-morph-loader"
import type {
  AnalysisError,
  AnalysisStats,
  AnalysisWarning,
  AnalyzerOptions,
  ConcurrencyMode,
  StaticFlowNode,
  StaticParallelNode,
  StaticRaceNode
} from "./types"

export const analyzeParallelCall = (
  deps: AnalysisContext,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats,
  serviceScope?: Map<string, string>
): Effect.Effect<StaticParallelNode, AnalysisError> =>
  Effect.gen(function*() {
    const args = call.getArguments()
    const children: Array<StaticFlowNode> = []
    const { SyntaxKind } = loadTsMorph()

    // First argument: array of effects or object with effect properties
    if (args.length > 0 && args[0]) {
      const firstArg = args[0]

      if (firstArg.getKind() === SyntaxKind.ArrayLiteralExpression) {
        const elements = (firstArg as ArrayLiteralExpression).getElements()
        for (const elem of elements) {
          const analyzed = yield* deps.analyzeEffectExpression(
            elem,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
            serviceScope
          )
          children.push(analyzed)
        }
      } else if (firstArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
        const props = (firstArg as ObjectLiteralExpression).getProperties()
        for (const prop of props) {
          if (prop.getKind() === SyntaxKind.PropertyAssignment) {
            const initializer = (prop as PropertyAssignment).getInitializer()
            if (initializer) {
              const analyzed = yield* deps.analyzeEffectExpression(
                initializer,
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
                serviceScope
              )
              children.push(analyzed)
            }
          }
        }
      }
    }

    // Second argument: options { concurrency, batching, discard } (GAP 18)
    let concurrency: ConcurrencyMode | undefined
    let batching: boolean | undefined
    let discard: boolean | undefined
    if (args.length > 1 && args[1]?.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const parsed = parseEffectAllOptions(args[1] as ObjectLiteralExpression)
      concurrency = parsed.concurrency
      batching = parsed.batching
      discard = parsed.discard
    }

    const mode = callee.includes("Par") || isConcurrent(concurrency) ? "parallel" : "sequential"
    if (concurrency === undefined) {
      concurrency = mode === "parallel" ? "unbounded" : "sequential"
    }

    stats.parallelCount++

    const branchLabels = children.map((child) => computeDisplayName(child))
    const parallelNode: StaticParallelNode = {
      id: generateId(),
      type: "parallel",
      callee,
      mode,
      children,
      concurrency,
      batching,
      discard,
      branchLabels,
      location: extractLocation(call, filePath, opts.includeLocations ?? false)
    }
    return {
      ...parallelNode,
      displayName: computeDisplayName(parallelNode),
      semanticRole: computeSemanticRole(parallelNode)
    }
  })

export const analyzeRaceCall = (
  deps: AnalysisContext,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats
): Effect.Effect<StaticRaceNode, AnalysisError> =>
  Effect.gen(function*() {
    const args = call.getArguments()
    const children: Array<StaticFlowNode> = []

    for (const arg of args) {
      if (arg) {
        const analyzed = yield* deps.analyzeEffectExpression(
          arg,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats
        )
        children.push(analyzed)
      }
    }

    stats.raceCount++

    const raceLabels = children.map((child) => computeDisplayName(child))
    const raceNode: StaticRaceNode = {
      id: generateId(),
      type: "race",
      callee,
      children,
      raceLabels,
      location: extractLocation(call, filePath, opts.includeLocations ?? false)
    }
    return {
      ...raceNode,
      displayName: computeDisplayName(raceNode),
      semanticRole: computeSemanticRole(raceNode)
    }
  })
