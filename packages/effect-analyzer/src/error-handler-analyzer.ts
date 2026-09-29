/**
 * Error-handler call analyzer (catch/catchTag/catchTags/orElse/orDie/match/...).
 *
 * Recurses via `deps.analyzeEffectExpression` into the source effect and the
 * handler. Tag/tags extraction reads the first/handler argument literally.
 *
 * Extracted from effect-analysis.ts via the strangler-fig DI pattern.
 * Behaviour is preserved exactly.
 */

import { Effect } from "effect"
import type {
  CallExpression,
  MethodDeclaration,
  Node,
  ObjectLiteralExpression,
  PropertyAccessExpression,
  PropertyAssignment,
  SourceFile,
  StringLiteral
} from "ts-morph"
import type { AnalysisContext } from "./analysis-context"
import { computeDisplayName, computeSemanticRole, extractLocation, generateId } from "./analysis-utils"
import { loadTsMorph } from "./ts-morph-loader"
import type {
  AnalysisError,
  AnalysisStats,
  AnalysisWarning,
  AnalyzerOptions,
  StaticErrorHandlerNode,
  StaticFlowNode
} from "./types"

/**
 * Which handler a callee names. Ordered longest-first: the chain is substring
 * based, so `catchReason` must be tested before `catchCause` and `catch`, or
 * Effect 4's selective catches all read as catch-everything.
 */
export const classifyErrorHandlerName = (
  callee: string
): StaticErrorHandlerNode["handlerType"] => {
  if (callee.includes("catchCauseFilter")) {
    return "catchCauseFilter"
  }
  if (callee.includes("catchCauseIf")) {
    return "catchCauseIf"
  }
  if (callee.includes("catchNoSuchElement")) {
    return "catchNoSuchElement"
  }
  if (callee.includes("catchReasons")) {
    return "catchReasons"
  }
  if (callee.includes("catchReason")) {
    return "catchReason"
  }
  if (callee.includes("catchFilter")) {
    return "catchFilter"
  }
  if (callee.includes("catchEager")) {
    return "catchEager"
  }
  if (callee.includes("catchCause")) {
    return "catchCause"
  }
  if (callee.includes("catchSomeCause")) {
    return "catchSomeCause"
  }
  if (callee.includes("catchSomeDefect")) {
    return "catchSomeDefect"
  }
  if (callee.includes("catchDefect")) {
    return "catchDefect"
  }
  if (callee.includes("catchTags")) {
    return "catchTags"
  }
  if (callee.includes("catchIf")) {
    return "catchIf"
  }
  if (callee.includes("catchSome")) {
    return "catchSome"
  }
  if (callee.includes("catchTag")) {
    return "catchTag"
  }
  if (callee.includes("catch")) {
    return "catch"
  }
  if (callee.includes("orElseFail")) {
    return "orElseFail"
  }
  if (callee.includes("orElseSucceed")) {
    return "orElseSucceed"
  }
  if (callee.includes("orElse")) {
    return "orElse"
  }
  if (callee.includes("orDieWith")) {
    return "orDieWith"
  }
  if (callee.includes("orDie")) {
    return "orDie"
  }
  if (callee.includes("flip")) {
    return "flip"
  }
  if (callee.includes("mapErrorCause")) {
    return "mapErrorCause"
  }
  if (callee.includes("mapBoth")) {
    return "mapBoth"
  }
  if (callee.includes("mapError")) {
    return "mapError"
  }
  if (callee.includes("unsandbox")) {
    return "unsandbox"
  }
  if (callee.includes("sandbox")) {
    return "sandbox"
  }
  if (callee.includes("parallelErrors")) {
    return "parallelErrors"
  }
  if (callee.includes("filterOrDieMessage")) {
    return "filterOrDieMessage"
  }
  if (callee.includes("filterOrDie")) {
    return "filterOrDie"
  }
  if (callee.includes("filterOrElse")) {
    return "filterOrElse"
  }
  if (callee.includes("filterOrFail")) {
    return "filterOrFail"
  }
  if (callee.includes("matchCauseEffect")) {
    return "matchCauseEffect"
  }
  if (callee.includes("matchCause")) {
    return "matchCause"
  }
  if (callee.includes("matchEffect")) {
    return "matchEffect"
  }
  if (callee.includes("match")) {
    return "match"
  }
  if (callee.includes("firstSuccessOf")) {
    return "firstSuccessOf"
  }
  if (callee.includes("ignoreLogged")) {
    return "ignoreLogged"
  }
  if (callee.includes("ignore")) {
    return "ignore"
  }
  if (callee.includes("eventually")) {
    return "eventually"
  }
  return "catch"
}

export const analyzeErrorHandlerCall = (
  deps: AnalysisContext,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: Array<AnalysisWarning>,
  stats: AnalysisStats
): Effect.Effect<StaticErrorHandlerNode, AnalysisError> =>
  Effect.gen(function*() {
    const args = call.getArguments()

    const handlerType = classifyErrorHandlerName(callee)

    // For methods that are called as effect.pipe(Effect.catch(handler))
    // we need to find the source effect differently
    let source: StaticFlowNode
    let handler: StaticFlowNode | undefined

    const { SyntaxKind } = loadTsMorph()
    const isEffect = (n: Node) => n.getType().getProperty("~effect/Effect") !== undefined
    // Callbacks, handler objects and tag strings are handler arguments. When
    // types do not resolve (in-memory sources), argument shape decides.
    const isHandlerShaped = (n: Node) =>
      n.getKind() === SyntaxKind.ArrowFunction ||
      n.getKind() === SyntaxKind.FunctionExpression ||
      n.getKind() === SyntaxKind.ObjectLiteralExpression ||
      n.getKind() === SyntaxKind.StringLiteral
    const isDataFirstSource = (n: Node) =>
      isEffect(n) || (args.length >= 2 && !isHandlerShaped(n) && n.getType().getText() === "any")
    const analyze = (n: Node) => deps.analyzeEffectExpression(n, sourceFile, filePath, opts, warnings, stats)
    // An object literal (catchTags, match) is a bag of handlers, not an Effect.
    const analyzeHandler = (n: Node) =>
      n.getKind() === SyntaxKind.ObjectLiteralExpression ? Effect.succeed(undefined) : analyze(n)

    // Three call shapes:
    //   effect.catch(fn)               method on an Effect value
    //   Effect.catchTags(eff, {...})   data-first: source is the first argument
    //   Effect.catchTags({...})        data-last (inside .pipe): returns a
    //                                  function, the source is the pipe's base
    const expr = call.getExpression()
    const receiver = expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression
      ? (expr as PropertyAccessExpression).getExpression()
      : undefined
    if (receiver && isEffect(receiver)) {
      source = yield* analyze(receiver)
      if (args[0]) handler = yield* analyzeHandler(args[0])
    } else if (args[0] && isDataFirstSource(args[0])) {
      source = yield* analyze(args[0])
      // catchTag(eff, "Tag", fn): the handler follows the tag.
      const handlerArg = args[args.length - 1]
      if (args.length > 1 && handlerArg) handler = yield* analyzeHandler(handlerArg)
    } else {
      // Same placeholder `asErrorHandler` uses for an uncalled combinator:
      // `walkPropagation` supplies the pipe's base when it reaches this node.
      source = { id: generateId(), type: "effect", callee, description: "pipe-input" }
      const handlerArg = args[args.length - 1]
      if (handlerArg) handler = yield* analyzeHandler(handlerArg)
    }

    stats.errorHandlerCount++

    // For catchTags (object form), extract the tag keys from the object literal
    let errorTag: string | undefined
    let errorTags: ReadonlyArray<string> | undefined
    let tagHandlers: Array<{ tag: string; handler: StaticFlowNode }> | undefined
    if (handlerType === "catchTag") {
      // catchTag("Tag", fn) or catchTag(eff, "Tag", fn): the first string literal.
      const tagArg = args.find((a) => a.getKind() === loadTsMorph().SyntaxKind.StringLiteral)
      if (tagArg) errorTag = (tagArg as StringLiteral).getLiteralValue()
    } else if (handlerType === "catchTags") {
      // catchTags({ NotFound: handler, DatabaseError: handler })
      // Find the object literal arg (may be args[0] for Effect.catchTags(eff, obj) or handler arg)
      const objArg = [...args].find(
        (a) => a?.getKind() === loadTsMorph().SyntaxKind.ObjectLiteralExpression
      )
      if (objArg !== undefined) {
        tagHandlers = []
        for (const p of (objArg as ObjectLiteralExpression).getProperties()) {
          // `Tag: (e) => ...` analyzes its initializer; `Tag(e) { ... }` the method itself.
          const body = p.getKind() === SyntaxKind.PropertyAssignment
            ? (p as PropertyAssignment).getInitializer()
            : p.getKind() === SyntaxKind.MethodDeclaration
            ? (p as MethodDeclaration)
              .getDescendantsOfKind(SyntaxKind.ReturnStatement)
              .at(-1)
              ?.getExpression()
            : undefined
          if (!body) continue
          const tag = (p as PropertyAssignment | MethodDeclaration).getName()
          tagHandlers.push({
            tag,
            handler: yield* deps.analyzeEffectExpression(body, sourceFile, filePath, opts, warnings, stats)
          })
        }
        errorTags = tagHandlers.map((t) => t.tag)
      }
    }

    const handlerNode: StaticErrorHandlerNode = {
      id: generateId(),
      type: "error-handler",
      handlerType,
      source,
      handler,
      errorTag,
      errorTags,
      ...(tagHandlers && tagHandlers.length > 0 ? { tagHandlers } : {}),
      errorEdgeLabel: errorTag
        ? `on ${errorTag}`
        : errorTags && errorTags.length > 0
        ? `on ${errorTags.join(" | ")}`
        : "on error",
      location: extractLocation(call, filePath, opts.includeLocations ?? false)
    }
    return {
      ...handlerNode,
      displayName: computeDisplayName(handlerNode),
      semanticRole: computeSemanticRole(handlerNode)
    }
  })
