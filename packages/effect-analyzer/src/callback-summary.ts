/**
 * Callback body summarisation helpers.
 *
 * The static analyzer captures `Effect.callback`/`Effect.gen`/loop callbacks as
 * IR nodes, but their bodies are arbitrary JS. These helpers walk a callback
 * body and produce a compact, deduplicated summary of the calls /
 * conditionals inside it — used to render meaningful labels in diagrams and
 * keep the IR small.
 *
 * Extracted from effect-analysis.ts as part of the strangler-fig cleanup.
 * Behaviour is preserved exactly; only the module boundary moved.
 */

import { Effect } from "effect"
import type {
  ArrowFunction,
  Block,
  CallExpression,
  FunctionExpression,
  Identifier,
  Node,
  SourceFile,
  VariableStatement
} from "ts-morph"
import { computeDisplayName, computeSemanticRole, extractLocation, generateId } from "./analysis-utils"
import { loadTsMorph } from "./ts-morph-loader"
import type {
  AnalysisError,
  AnalysisStats,
  AnalysisWarning,
  AnalyzerOptions,
  StaticEffectNode,
  StaticFlowNode,
  StaticLoopNode
} from "./types"

const compactCallbackCalleeLabel = (call: CallExpression): string => {
  let expr: Node = call.getExpression()
  const { SyntaxKind } = loadTsMorph()
  while (expr.getKind() === SyntaxKind.CallExpression) {
    expr = (expr as CallExpression).getExpression()
  }
  return expr.getText()
}

const canonicalizeCallbackLabel = (label: string): string => {
  const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(/.exec(label)
  return match?.[1] ?? label
}

const CALLBACK_NOISE_LABELS = new Set([
  "Effect.sync",
  "Effect.succeed",
  "Effect.fail",
  "sync",
  "succeed",
  "fail",
  "tap",
  "recurs",
  "map",
  "flatMap"
])

const shouldSkipCallbackSummaryLabel = (
  label: string,
  availableLabels: ReadonlyArray<string>
): boolean => {
  if (!CALLBACK_NOISE_LABELS.has(label)) return false
  return availableLabels.some((candidate) => candidate !== label)
}

export const summarizeLoopCallbackSource = (
  loopType: StaticLoopNode["loopType"],
  callbackBody: ReadonlyArray<StaticFlowNode>
): string => {
  const labels = callbackBody.flatMap((node) => {
    if (node.type === "effect") {
      return [canonicalizeCallbackLabel(node.callee)]
    }
    if (node.type === "conditional") {
      return [`if ${node.conditionLabel ?? node.condition}`]
    }
    return []
  })
  const filtered = labels.filter((label, index) => {
    if (labels.indexOf(label) !== index) return false
    return !shouldSkipCallbackSummaryLabel(label, labels)
  })
  if (filtered.length === 0) return "callback body"
  const joined = filtered.slice(0, 4).join(" -> ")
  const suffix = filtered.length > 4 ? " -> ..." : ""
  return `${loopType} callback: ${joined}${suffix}`
}

export const buildCallbackSummaryNodes = (
  fnNode: ArrowFunction | FunctionExpression,
  filePath: string,
  includeLocations: boolean
): ReadonlyArray<StaticFlowNode> | undefined => {
  const { SyntaxKind } = loadTsMorph()
  const body = fnNode.getBody()
  const calls: Array<StaticFlowNode> = []
  const seen = new Set<string>()

  const collectFrom = (candidate: Node): void => {
    if (candidate.getKind() === SyntaxKind.CallExpression) {
      const call = candidate as CallExpression
      const callee = canonicalizeCallbackLabel(compactCallbackCalleeLabel(call))
      if (seen.has(callee)) return
      seen.add(callee)
      const callbackNode: StaticEffectNode = {
        id: generateId(),
        type: "effect",
        callee,
        description: "callback-call",
        location: extractLocation(candidate, filePath, includeLocations)
      }
      calls.push({
        ...callbackNode,
        displayName: computeDisplayName(callbackNode),
        semanticRole: computeSemanticRole(callbackNode)
      })
    }
  }

  if (body.getKind() === SyntaxKind.Block) {
    for (const stmt of (body as Block).getStatements()) {
      stmt.forEachDescendant((desc) => {
        collectFrom(desc)
        return undefined
      })
    }
  } else {
    body.forEachDescendant((desc) => {
      collectFrom(desc)
      return undefined
    })
    collectFrom(body)
  }

  const labels = calls.flatMap((node) => node.type === "effect" ? [node.callee] : [])
  const filtered = calls.filter((node) => {
    if (node.type !== "effect") return true
    return !shouldSkipCallbackSummaryLabel(node.callee, labels)
  })

  return filtered.length > 0 ? filtered : undefined
}

const isFunctionBoundaryForCallbackSummary = (node: Node): boolean => {
  const { SyntaxKind } = loadTsMorph()
  const kind = node.getKind()
  return (
    kind === SyntaxKind.FunctionDeclaration ||
    kind === SyntaxKind.FunctionExpression ||
    kind === SyntaxKind.ArrowFunction ||
    kind === SyntaxKind.MethodDeclaration
  )
}

const summarizeResumePayloads = (
  fnNode: ArrowFunction | FunctionExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats,
  resumeParamName: string
): Effect.Effect<ReadonlyArray<StaticFlowNode>, AnalysisError> =>
  Effect.gen(function*() {
    const { SyntaxKind } = loadTsMorph()
    const summaries: Array<StaticFlowNode> = []
    const seen = new Set<string>()
    const body = fnNode.getBody()

    const visit = (node: Node): void => {
      if (node.getKind() === SyntaxKind.CallExpression) {
        const call = node as CallExpression
        const expr = call.getExpression()
        if (
          expr.getKind() === SyntaxKind.Identifier &&
          (expr as Identifier).getText() === resumeParamName
        ) {
          const payload = call.getArguments()[0]
          if (payload) {
            const payloadText = payload.getText()
            const compactPayload = payloadText.length > 48 ? `${payloadText.slice(0, 48)}...` : payloadText
            const key = compactPayload
            if (!seen.has(key)) {
              seen.add(key)
              summaries.push({
                id: generateId(),
                type: "effect",
                callee: `resume -> ${compactPayload}`,
                description: "callback-resume",
                location: extractLocation(call, filePath, opts.includeLocations ?? false)
              })
            }
          }
        }
      }
      if (!isFunctionBoundaryForCallbackSummary(node)) {
        node.forEachChild(visit)
      }
    }

    if (body.getKind() === SyntaxKind.Block) {
      for (const stmt of (body as Block).getStatements()) {
        visit(stmt)
      }
    } else {
      visit(body)
    }

    return summaries
  })

const filterHandlerSummaryNoise = (
  nodes: ReadonlyArray<StaticFlowNode>
): ReadonlyArray<StaticFlowNode> => {
  const seenEffectLabels = new Set<string>()
  return nodes.filter((node) => {
    if (node.type !== "effect") return true
    if (node.callee === "resume") return false
    if (node.callee === "fail") return false
    if (
      node.callee === "succeed" ||
      node.callee === "succeedSome" ||
      node.callee === "succeedNone" ||
      node.callee === "Effect.fail" ||
      node.callee === "Effect.succeed" ||
      node.callee === "Effect.succeedSome" ||
      node.callee === "Effect.succeedNone"
    ) {
      return false
    }
    if (seenEffectLabels.has(node.callee)) return false
    seenEffectLabels.add(node.callee)
    return true
  })
}

export const summarizeNamedCallbackHandlers = (
  fnNode: ArrowFunction | FunctionExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats,
  resumeParamName: string
): Effect.Effect<ReadonlyArray<StaticFlowNode> | undefined, AnalysisError> =>
  Effect.gen(function*() {
    const { SyntaxKind } = loadTsMorph()
    const body = fnNode.getBody()
    if (body.getKind() !== SyntaxKind.Block) return undefined

    const summaries: Array<StaticFlowNode> = []
    const block = body as Block
    for (const stmt of block.getStatements()) {
      if (stmt.getKind() === SyntaxKind.VariableStatement) {
        for (const decl of (stmt as VariableStatement).getDeclarations()) {
          const init = decl.getInitializer()
          if (
            init &&
            (init.getKind() === SyntaxKind.ArrowFunction ||
              init.getKind() === SyntaxKind.FunctionExpression)
          ) {
            const handlerFn = init as ArrowFunction | FunctionExpression
            const callbackBody = [
              ...(yield* summarizeResumePayloads(
                handlerFn,
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
                resumeParamName
              )),
              ...filterHandlerSummaryNoise(
                buildPureCallbackSummaryNodes(
                  handlerFn,
                  filePath,
                  opts.includeLocations ?? false
                ) ?? []
              )
            ]
            if (callbackBody.length > 0) {
              const handlerNode: StaticEffectNode = {
                id: generateId(),
                type: "effect",
                callee: decl.getName(),
                description: "callback-handler",
                callbackBody,
                location: extractLocation(decl, filePath, opts.includeLocations ?? false)
              }
              summaries.push({
                ...handlerNode,
                displayName: computeDisplayName(handlerNode),
                semanticRole: computeSemanticRole(handlerNode)
              })
            }
          }
        }
      }
    }

    return summaries.length > 0 ? summaries : undefined
  })

export const buildPureCallbackSummaryNodes = (
  fnNode: ArrowFunction | FunctionExpression,
  filePath: string,
  includeLocations: boolean
): ReadonlyArray<StaticFlowNode> | undefined => {
  const { SyntaxKind } = loadTsMorph()
  const body = fnNode.getBody()
  const summaries: Array<StaticFlowNode> = []
  const seen = new Set<string>()

  const addEffectSummary = (label: string, description = "callback-transform"): void => {
    const canonicalLabel = canonicalizeCallbackLabel(label)
    if (seen.has(canonicalLabel)) return
    seen.add(canonicalLabel)
    const node: StaticEffectNode = {
      id: generateId(),
      type: "effect",
      callee: canonicalLabel,
      description,
      location: extractLocation(body, filePath, includeLocations)
    }
    summaries.push({
      ...node,
      displayName: computeDisplayName(node),
      semanticRole: computeSemanticRole(node)
    })
  }

  const addConditionalSummary = (condition: string): void => {
    if (seen.has(`if:${condition}`)) return
    seen.add(`if:${condition}`)
    summaries.push({
      id: generateId(),
      type: "conditional",
      conditionalType: "if",
      condition,
      conditionLabel: condition,
      onTrue: {
        id: generateId(),
        type: "opaque",
        reason: "callback-branch",
        sourceText: condition,
        location: extractLocation(body, filePath, includeLocations)
      },
      location: extractLocation(body, filePath, includeLocations)
    })
  }

  const visit = (candidate: Node): void => {
    if (candidate.getKind() === SyntaxKind.CallExpression) {
      const call = candidate as CallExpression
      addEffectSummary(call.getExpression().getText(), "callback-call")
    } else if (candidate.getKind() === SyntaxKind.BinaryExpression) {
      const text = candidate.getText()
      if (
        text.includes("===") ||
        text.includes("!==") ||
        text.includes(">") ||
        text.includes("<") ||
        text.includes("%") ||
        text.includes("&&") ||
        text.includes("||")
      ) {
        addConditionalSummary(text)
      }
    } else if (
      candidate.getKind() === SyntaxKind.Identifier ||
      candidate.getKind() === SyntaxKind.NumericLiteral ||
      candidate.getKind() === SyntaxKind.StringLiteral ||
      candidate.getKind() === SyntaxKind.TrueKeyword ||
      candidate.getKind() === SyntaxKind.FalseKeyword
    ) {
      return
    }
    candidate.forEachChild(visit)
  }

  if (body.getKind() === SyntaxKind.Block) {
    for (const stmt of (body as Block).getStatements()) {
      visit(stmt)
    }
  } else {
    visit(body)
    if (summaries.length === 0) {
      addEffectSummary(body.getText(), "callback-transform")
    }
  }

  return summaries.length > 0 ? summaries : undefined
}
