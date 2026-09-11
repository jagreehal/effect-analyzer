/**
 * Error-handler call analyzer (catch/catchTag/catchTags/orElse/orDie/match/...).
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
import type { AnalysisContext } from './analysis-context';

/**
 * Which handler a callee names. Ordered longest-first: the chain is substring
 * based, so `catchReason` must be tested before `catchCause` and `catch`, or
 * Effect 4's selective catches all read as catch-everything.
 */
export const classifyErrorHandlerName = (
  callee: string,
): StaticErrorHandlerNode['handlerType'] => {
  if (callee.includes('catchCauseFilter')) {
    return 'catchCauseFilter';
  }
  if (callee.includes('catchCauseIf')) {
    return 'catchCauseIf';
  }
  if (callee.includes('catchNoSuchElement')) {
    return 'catchNoSuchElement';
  }
  if (callee.includes('catchReasons')) {
    return 'catchReasons';
  }
  if (callee.includes('catchReason')) {
    return 'catchReason';
  }
  if (callee.includes('catchFilter')) {
    return 'catchFilter';
  }
  if (callee.includes('catchEager')) {
    return 'catchEager';
  }
  if (callee.includes('catchCause')) {
    return 'catchCause';
  }
  if (callee.includes('catchSomeCause')) {
    return 'catchSomeCause';
  }
  if (callee.includes('catchSomeDefect')) {
    return 'catchSomeDefect';
  }
  if (callee.includes('catchDefect')) {
    return 'catchDefect';
  }
  if (callee.includes('catchTags')) {
    return 'catchTags';
  }
  if (callee.includes('catchIf')) {
    return 'catchIf';
  }
  if (callee.includes('catchSome')) {
    return 'catchSome';
  }
  if (callee.includes('catchTag')) {
    return 'catchTag';
  }
  if (callee.includes('catch')) {
    return 'catch';
  }
  if (callee.includes('orElseFail')) {
    return 'orElseFail';
  }
  if (callee.includes('orElseSucceed')) {
    return 'orElseSucceed';
  }
  if (callee.includes('orElse')) {
    return 'orElse';
  }
  if (callee.includes('orDieWith')) {
    return 'orDieWith';
  }
  if (callee.includes('orDie')) {
    return 'orDie';
  }
  if (callee.includes('flip')) {
    return 'flip';
  }
  if (callee.includes('mapErrorCause')) {
    return 'mapErrorCause';
  }
  if (callee.includes('mapBoth')) {
    return 'mapBoth';
  }
  if (callee.includes('mapError')) {
    return 'mapError';
  }
  if (callee.includes('unsandbox')) {
    return 'unsandbox';
  }
  if (callee.includes('sandbox')) {
    return 'sandbox';
  }
  if (callee.includes('parallelErrors')) {
    return 'parallelErrors';
  }
  if (callee.includes('filterOrDieMessage')) {
    return 'filterOrDieMessage';
  }
  if (callee.includes('filterOrDie')) {
    return 'filterOrDie';
  }
  if (callee.includes('filterOrElse')) {
    return 'filterOrElse';
  }
  if (callee.includes('filterOrFail')) {
    return 'filterOrFail';
  }
  if (callee.includes('matchCauseEffect')) {
    return 'matchCauseEffect';
  }
  if (callee.includes('matchCause')) {
    return 'matchCause';
  }
  if (callee.includes('matchEffect')) {
    return 'matchEffect';
  }
  if (callee.includes('match')) {
    return 'match';
  }
  if (callee.includes('firstSuccessOf')) {
    return 'firstSuccessOf';
  }
  if (callee.includes('ignoreLogged')) {
    return 'ignoreLogged';
  }
  if (callee.includes('ignore')) {
    return 'ignore';
  }
  if (callee.includes('eventually')) {
    return 'eventually';
  }
  return 'catch';
};

export const analyzeErrorHandlerCall = (
  deps: AnalysisContext,
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

    const handlerType = classifyErrorHandlerName(callee);

    // For methods that are called as effect.pipe(Effect.catch(handler))
    // we need to find the source effect differently
    let source: StaticFlowNode;
    let handler: StaticFlowNode | undefined;

    // Check if this is a method call on an effect (e.g., effect.catch(fn))
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
      if (objArg !== undefined) {
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
