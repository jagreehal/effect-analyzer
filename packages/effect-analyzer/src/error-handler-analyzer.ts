/**
 * Error-handler call analyzer (catchAll/catchTag/catchTags/orElse/orDie/match/...).
 *
 * Recurses via `deps.analyzeEffectExpression` into the source effect and the
 * handler. Tag/tags extraction reads the first/handler argument literally.
 *
 * Extracted from effect-analysis.ts via the strangler-fig DI pattern.
 * Behaviour is preserved exactly.
 */

import { Effect } from 'effect';
import type {
  CallExpression,
  SourceFile,
  PropertyAccessExpression,
  StringLiteral,
  ObjectLiteralExpression,
  PropertyAssignment,
  MethodDeclaration,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type {
  StaticFlowNode,
  StaticErrorHandlerNode,
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

export const analyzeErrorHandlerCall = (
  deps: AnalyzerDeps,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticErrorHandlerNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();

    let handlerType: StaticErrorHandlerNode['handlerType'];
    if (callee.includes('catchAllCause')) {
      handlerType = 'catchAllCause';
    } else if (callee.includes('catchSomeCause')) {
      handlerType = 'catchSomeCause';
    } else if (callee.includes('catchSomeDefect')) {
      handlerType = 'catchSomeDefect';
    } else if (callee.includes('catchAllDefect')) {
      handlerType = 'catchAllDefect';
    } else if (callee.includes('catchTags')) {
      handlerType = 'catchTags';
    } else if (callee.includes('catchIf')) {
      handlerType = 'catchIf';
    } else if (callee.includes('catchSome')) {
      handlerType = 'catchSome';
    } else if (callee.includes('catchTag')) {
      handlerType = 'catchTag';
    } else if (callee.includes('catchAll')) {
      handlerType = 'catchAll';
    } else if (callee.includes('orElseFail')) {
      handlerType = 'orElseFail';
    } else if (callee.includes('orElseSucceed')) {
      handlerType = 'orElseSucceed';
    } else if (callee.includes('orElse')) {
      handlerType = 'orElse';
    } else if (callee.includes('orDieWith')) {
      handlerType = 'orDieWith';
    } else if (callee.includes('orDie')) {
      handlerType = 'orDie';
    } else if (callee.includes('flip')) {
      handlerType = 'flip';
    } else if (callee.includes('mapErrorCause')) {
      handlerType = 'mapErrorCause';
    } else if (callee.includes('mapBoth')) {
      handlerType = 'mapBoth';
    } else if (callee.includes('mapError')) {
      handlerType = 'mapError';
    } else if (callee.includes('unsandbox')) {
      handlerType = 'unsandbox';
    } else if (callee.includes('sandbox')) {
      handlerType = 'sandbox';
    } else if (callee.includes('parallelErrors')) {
      handlerType = 'parallelErrors';
    } else if (callee.includes('filterOrDieMessage')) {
      handlerType = 'filterOrDieMessage';
    } else if (callee.includes('filterOrDie')) {
      handlerType = 'filterOrDie';
    } else if (callee.includes('filterOrElse')) {
      handlerType = 'filterOrElse';
    } else if (callee.includes('filterOrFail')) {
      handlerType = 'filterOrFail';
    } else if (callee.includes('matchCauseEffect')) {
      handlerType = 'matchCauseEffect';
    } else if (callee.includes('matchCause')) {
      handlerType = 'matchCause';
    } else if (callee.includes('matchEffect')) {
      handlerType = 'matchEffect';
    } else if (callee.includes('match')) {
      handlerType = 'match';
    } else if (callee.includes('firstSuccessOf')) {
      handlerType = 'firstSuccessOf';
    } else if (callee.includes('ignoreLogged')) {
      handlerType = 'ignoreLogged';
    } else if (callee.includes('ignore')) {
      handlerType = 'ignore';
    } else if (callee.includes('eventually')) {
      handlerType = 'eventually';
    } else {
      handlerType = 'catchAll';
    }

    // For methods that are called as effect.pipe(Effect.catchAll(handler))
    // we need to find the source effect differently
    let source: StaticFlowNode;
    let handler: StaticFlowNode | undefined;

    // Check if this is a method call on an effect (e.g., effect.catchAll(fn))
    const expr = call.getExpression();
    if (expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression) {
      // This is effect.method() - the source is the object of the property access
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

      // Handler is the first argument
      if (args.length > 0 && args[0]) {
        handler = yield* deps.analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      }
    } else {
      // This is Effect.method(effect, handler) - effect is first argument
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
        handler = yield* deps.analyzeEffectExpression(
          args[1],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      }
    }

    stats.errorHandlerCount++;

    // For catchTags (object form), extract the tag keys from the object literal
    let errorTag: string | undefined;
    let errorTags: readonly string[] | undefined;
    if (handlerType === 'catchTag') {
      // catchTag("TagName", handler) — first arg is the tag string
      const tagArg = args[0];
      if (tagArg?.getKind() === loadTsMorph().SyntaxKind.StringLiteral) {
        errorTag = (tagArg as StringLiteral).getLiteralValue();
      }
    } else if (handlerType === 'catchTags') {
      // catchTags({ NotFound: handler, DatabaseError: handler })
      // Find the object literal arg (may be args[0] for Effect.catchTags(eff, obj) or handler arg)
      const objArg = [...args].find(
        (a) => a?.getKind() === loadTsMorph().SyntaxKind.ObjectLiteralExpression,
      );
      if (objArg) {
        const props = (objArg as ObjectLiteralExpression).getProperties();
        errorTags = props
          .filter(
            (p) =>
              p.getKind() === loadTsMorph().SyntaxKind.PropertyAssignment ||
              p.getKind() === loadTsMorph().SyntaxKind.MethodDeclaration,
          )
          .map((p) => {
            if (p.getKind() === loadTsMorph().SyntaxKind.PropertyAssignment) {
              return (p as PropertyAssignment).getName();
            }
            return (p as MethodDeclaration).getName();
          });
      }
    }

    const handlerNode: StaticErrorHandlerNode = {
      id: generateId(),
      type: 'error-handler',
      handlerType,
      source,
      handler,
      errorTag,
      errorTags,
      errorEdgeLabel: errorTag
        ? `on ${errorTag}`
        : errorTags && errorTags.length > 0
          ? `on ${errorTags.join(' | ')}`
          : 'on error',
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...handlerNode,
      displayName: computeDisplayName(handlerNode),
      semanticRole: computeSemanticRole(handlerNode),
    };
  });
