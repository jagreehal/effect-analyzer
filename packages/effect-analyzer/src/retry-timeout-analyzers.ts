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

import { Effect } from "effect"
import type {
  CallExpression,
  Node,
  ObjectLiteralExpression,
  PropertyAccessExpression,
  PropertyAssignment,
  ShorthandPropertyAssignment,
  SourceFile,
  VariableDeclaration
} from "ts-morph"
import { getAliasesForFile } from "./alias-resolution"
import { parseScheduleInfo } from "./analysis-classifiers"
import type { AnalysisContext } from "./analysis-context"
import { SCHEDULE_OP_MAP } from "./analysis-patterns"
import { computeDisplayName, computeSemanticRole, extractLocation, generateId, getNodeText } from "./analysis-utils"
import { loadTsMorph } from "./ts-morph-loader"
import type {
  AnalysisError,
  AnalysisStats,
  AnalysisWarning,
  AnalyzerOptions,
  StaticFlowNode,
  StaticRetryNode,
  StaticScheduleNode,
  StaticTimeoutNode
} from "./types"

type ScheduleResolution = Pick<StaticRetryNode, "schedule" | "scheduleInfo"> & {
  readonly scheduleExpr: Node | undefined
}

/** Follow const identifiers (`retrySchedule`) to their initializer. */
const followConst = (node: Node): Node => {
  const { SyntaxKind } = loadTsMorph()
  let current = node
  for (let hop = 0; hop < 5 && current.getKind() === SyntaxKind.Identifier; hop++) {
    const symbol = current.getSymbol()
    const decl = (symbol?.getAliasedSymbol() ?? symbol)
      ?.getDeclarations()
      .find((d) => d.getKind() === SyntaxKind.VariableDeclaration) as VariableDeclaration | undefined
    const init = decl?.getInitializer()
    if (!init) break
    current = init
  }
  return current
}

/** Value of `name` in an options object: `{ name: x }` or shorthand `{ name }`. */
const optionValue = (obj: ObjectLiteralExpression, name: string): Node | undefined => {
  const { SyntaxKind } = loadTsMorph()
  const prop = obj.getProperty(name)
  if (prop?.getKind() === SyntaxKind.PropertyAssignment) return (prop as PropertyAssignment).getInitializer()
  if (prop?.getKind() === SyntaxKind.ShorthandPropertyAssignment) {
    // `{ schedule }`: the name node's symbol is the property itself, so look
    // up the variable it reads to reach `Schedule.exponential(...)`.
    const shorthand = prop as ShorthandPropertyAssignment
    const decl = shorthand.getValueSymbol()
      ?.getDeclarations()
      .find((d) => d.getKind() === SyntaxKind.VariableDeclaration) as VariableDeclaration | undefined
    return decl?.getInitializer() ?? shorthand.getNameNode()
  }
  return undefined
}

const asOptions = (node: Node | undefined): ObjectLiteralExpression | undefined =>
  node?.getKind() === loadTsMorph().SyntaxKind.ObjectLiteralExpression
    ? (node as ObjectLiteralExpression)
    : undefined

/**
 * Resolve a retry policy (`Effect.retry(policy)`) to its schedule: unwraps
 * `{ schedule, times, while, until }` and follows schedule consts.
 */
export const resolveRetryPolicy = (policy: Node | undefined): ScheduleResolution => {
  if (!policy) return { schedule: undefined, scheduleInfo: undefined, scheduleExpr: undefined }
  const resolved = followConst(policy)
  const options = asOptions(resolved)
  const scheduleArg = options ? optionValue(options, "schedule") : resolved
  const scheduleExpr = scheduleArg ? followConst(scheduleArg) : undefined
  const scheduleText = (scheduleExpr ?? policy).getText().replace(/\s+/g, " ")
  const times = options ? optionValue(options, "times")?.getText() : undefined
  const info = parseScheduleInfo(times ? `${scheduleText} times: ${times}` : scheduleText)
  const predicates = options ? ["while", "until"].filter((name) => options.getProperty(name)) : []
  return {
    schedule: scheduleText,
    scheduleInfo: info && predicates.length > 0
      ? { ...info, conditions: [...info.conditions, ...predicates] }
      : info,
    scheduleExpr
  }
}

/**
 * Split a retry/timeout call into the effect it wraps and its policy argument.
 *   effect.retry(policy)        method on an Effect value
 *   Effect.retry(effect, policy) data-first
 *   Effect.retry(policy)        data-last (inside .pipe): the source is the pipe's base
 */
const splitPolicyCall = (call: CallExpression, sourceFile: SourceFile) => {
  const { SyntaxKind } = loadTsMorph()
  const args = call.getArguments()
  const expr = call.getExpression()
  const receiver = expr.getKind() === SyntaxKind.PropertyAccessExpression
    ? (expr as PropertyAccessExpression).getExpression()
    : undefined
  if (receiver && !getAliasesForFile(sourceFile).has(receiver.getText())) {
    return { source: receiver, policy: args[0], extraArgs: args.length - 1 }
  }
  if (args.length >= 2) return { source: args[0], policy: args[1], extraArgs: args.length - 2 }
  return { source: undefined, policy: args[0], extraArgs: 0 }
}

const analyzePolicySource = (
  deps: AnalysisContext,
  call: CallExpression,
  sourceNode: Node | undefined,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats
): Effect.Effect<StaticFlowNode, AnalysisError> =>
  sourceNode
    ? deps.analyzeEffectExpression(sourceNode, sourceFile, filePath, opts, warnings, stats)
    // Same placeholder the error-handler analyzer uses for a data-last call.
    : Effect.succeed({
      id: generateId(),
      type: "effect",
      callee: call.getExpression().getText(),
      description: "pipe-input"
    })

export const analyzeRetryCall = (
  deps: AnalysisContext,
  call: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats
): Effect.Effect<StaticRetryNode, AnalysisError> =>
  Effect.gen(function*() {
    const split = splitPolicyCall(call, sourceFile)
    const source = yield* analyzePolicySource(
      deps,
      call,
      split.source,
      sourceFile,
      filePath,
      opts,
      warnings,
      stats
    )
    const { schedule, scheduleInfo, scheduleExpr } = resolveRetryPolicy(split.policy)
    const scheduleNode = scheduleExpr
      ? yield* deps.analyzeEffectExpression(scheduleExpr, sourceFile, filePath, opts, warnings, stats)
      : undefined
    const hasFallback = call.getExpression().getText().includes("OrElse") || split.extraArgs > 0

    stats.retryCount++

    const retryNode: StaticRetryNode = {
      id: generateId(),
      type: "retry",
      source,
      schedule,
      ...(scheduleNode !== undefined ? { scheduleNode } : {}),
      hasFallback,
      scheduleInfo,
      retryEdgeLabel: schedule ? `retry: ${schedule}` : "retry",
      location: extractLocation(call, filePath, opts.includeLocations ?? false)
    }
    return {
      ...retryNode,
      displayName: computeDisplayName(retryNode),
      semanticRole: computeSemanticRole(retryNode)
    }
  })

export const analyzeTimeoutCall = (
  deps: AnalysisContext,
  call: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats
): Effect.Effect<StaticTimeoutNode, AnalysisError> =>
  Effect.gen(function*() {
    const split = splitPolicyCall(call, sourceFile)
    const source = yield* analyzePolicySource(
      deps,
      call,
      split.source,
      sourceFile,
      filePath,
      opts,
      warnings,
      stats
    )
    // `timeoutOrElse({ duration, orElse })` carries the duration in an options object.
    const options = asOptions(split.policy)
    const durationArg = options ? optionValue(options, "duration") : split.policy
    const duration = durationArg ? getNodeText(followConst(durationArg)) : undefined
    const calleeText = getNodeText(call.getExpression())
    const hasFallback = /timeout(?:Fail|To|OrElse)/.test(calleeText) ||
      (options?.getProperty("orElse") !== undefined) ||
      split.extraArgs > 0

    stats.timeoutCount++

    const timeoutNode: StaticTimeoutNode = {
      id: generateId(),
      type: "timeout",
      source,
      duration,
      hasFallback,
      location: extractLocation(call, filePath, opts.includeLocations ?? false)
    }
    return {
      ...timeoutNode,
      displayName: computeDisplayName(timeoutNode),
      semanticRole: computeSemanticRole(timeoutNode)
    }
  })

/** Analyze Schedule.exponential / spaced / jittered / andThen / etc. (GAP 8 dedicated IR). */
export const analyzeScheduleCall = (
  call: CallExpression,
  callee: string,
  filePath: string,
  opts: Required<AnalyzerOptions>
): Effect.Effect<StaticScheduleNode, AnalysisError> =>
  Effect.sync(() => {
    const scheduleOp: StaticScheduleNode["scheduleOp"] = SCHEDULE_OP_MAP[callee] ?? "other"
    const scheduleText = call.getText()
    const scheduleInfo = parseScheduleInfo(scheduleText)
    const scheduleNode: StaticScheduleNode = {
      id: generateId(),
      type: "schedule",
      scheduleOp,
      ...(scheduleInfo ? { scheduleInfo } : {}),
      location: extractLocation(call, filePath, opts.includeLocations ?? false)
    }
    return {
      ...scheduleNode,
      displayName: computeDisplayName(scheduleNode),
      semanticRole: computeSemanticRole(scheduleNode)
    }
  })
