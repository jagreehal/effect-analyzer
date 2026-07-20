/**
 * Control-flow call analyzers: conditional, loop, match, cause, exit, transform.
 *
 * Each takes `deps.analyzeEffectExpression` so it can recurse into branches /
 * bodies / handlers / sources without depending on the parent module.
 *
 * Extracted from effect-analysis.ts via the strangler-fig DI pattern.
 * Behaviour is preserved exactly.
 */

import { Effect } from 'effect';
import type {
  CallExpression,
  SourceFile,
  PropertyAccessExpression,
  ObjectLiteralExpression,
  PropertyAssignment,
  ArrowFunction,
  FunctionExpression,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type {
  StaticFlowNode,
  StaticConditionalNode,
  StaticLoopNode,
  StaticMatchNode,
  StaticCauseNode,
  StaticExitNode,
  StaticTransformNode,
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
import {
  MATCH_OP_MAP,
  EXHAUSTIVE_OPS,
  CAUSE_OP_MAP,
  CAUSE_CONSTRUCTORS,
  EXIT_OP_MAP,
  EXIT_CONSTRUCTORS,
  TRANSFORM_OPS,
  EFFECTFUL_TRANSFORMS,
} from './analysis-patterns';
import {
  buildCallbackSummaryNodes,
  buildPureCallbackSummaryNodes,
  summarizeLoopCallbackSource,
} from './callback-summary';
import type { AnalysisContext } from './analysis-context';

export const analyzeConditionalCall = (
  deps: AnalysisContext,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticConditionalNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();

    let conditionalType: StaticConditionalNode['conditionalType'];
    if (callee.includes('.if') || callee === 'if') {
      conditionalType = 'if';
    } else if (callee.includes('whenEffect')) {
      conditionalType = 'whenEffect';
    } else if (callee.includes('whenFiberRef')) {
      conditionalType = 'whenFiberRef';
    } else if (callee.includes('whenRef')) {
      conditionalType = 'whenRef';
    } else if (callee.includes('.when') || callee === 'when') {
      conditionalType = 'when';
    } else if (callee.includes('unlessEffect')) {
      conditionalType = 'unlessEffect';
    } else if (callee.includes('.unless') || callee === 'unless') {
      conditionalType = 'unless';
    } else if (callee.includes('.option') || callee === 'option') {
      conditionalType = 'option';
    } else if (callee.includes('.either') || callee === 'either') {
      conditionalType = 'either';
    } else if (callee.includes('.exit') || callee === 'exit') {
      conditionalType = 'exit';
    } else if (callee.includes('liftPredicate')) {
      conditionalType = 'liftPredicate';
    } else {
      conditionalType = 'unless';
    }

    let condition = '<dynamic>';
    let onTrue: StaticFlowNode | undefined;
    let onFalse: StaticFlowNode | undefined;

    // Different call patterns for if vs when/unless
    if (conditionalType === 'if') {
      // Effect.if(condition, { onTrue, onFalse })
      if (args.length > 0 && args[0]) {
        condition = args[0].getText();
      }

      if (args.length > 1 && args[1]) {
        const secondArg = args[1];
        const { SyntaxKind } = loadTsMorph();

        if (secondArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
          const props = (secondArg as ObjectLiteralExpression).getProperties();
          for (const prop of props) {
            if (prop.getKind() === SyntaxKind.PropertyAssignment) {
              const propAssign = prop as PropertyAssignment;
              const name = propAssign.getName();
              const init = propAssign.getInitializer();

              if (init) {
                if (name === 'onTrue') {
                  onTrue = yield* deps.analyzeEffectExpression(
                    init,
                    sourceFile,
                    filePath,
                    opts,
                    warnings,
                    stats,
                  );
                } else if (name === 'onFalse') {
                  onFalse = yield* deps.analyzeEffectExpression(
                    init,
                    sourceFile,
                    filePath,
                    opts,
                    warnings,
                    stats,
                  );
                }
              }
            }
          }
        }
      }
    } else {
      // when/unless: effect.pipe(Effect.when(condition))
      const expr = call.getExpression();
      if (
        expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression
      ) {
        const propAccess = expr as PropertyAccessExpression;
        const exprSource = propAccess.getExpression();

        // The source effect is the object being piped
        if (!onTrue) {
          onTrue = yield* deps.analyzeEffectExpression(
            exprSource,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
        }
      }

      if (args.length > 0 && args[0]) {
        condition = args[0].getText();
      }
    }

    if (!onTrue) {
      onTrue = {
        id: generateId(),
        type: 'unknown',
        reason: 'Could not determine true branch',
      };
    }

    stats.conditionalCount++;

    const truncatedCondition = condition.length <= 30 ? condition : `${condition.slice(0, 30)}…`;
    const conditionalNode: StaticConditionalNode = {
      id: generateId(),
      type: 'conditional',
      conditionalType,
      condition,
      onTrue,
      onFalse,
      conditionLabel: truncatedCondition,
      trueEdgeLabel: 'true',
      falseEdgeLabel: 'false',
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...conditionalNode,
      displayName: computeDisplayName(conditionalNode),
      semanticRole: computeSemanticRole(conditionalNode),
    };
  });

export const analyzeLoopCall = (
  deps: AnalysisContext,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticLoopNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    const { SyntaxKind } = loadTsMorph();

    const loopType: StaticLoopNode['loopType'] =
      callee.includes('forEach') ? 'forEach' :
      callee.includes('filterMap') ? 'filterMap' :
      callee.includes('filter') ? 'filter' :
      callee.includes('partition') ? 'partition' :
      callee.includes('reduce') ? 'reduce' :
      callee.includes('validateAll') || callee.includes('validateFirst') || callee.includes('validateWith') ? 'validate' :
      callee.includes('replicate') ? 'replicate' :
      callee.includes('dropUntil') ? 'dropUntil' :
      callee.includes('dropWhile') ? 'dropWhile' :
      callee.includes('takeUntil') ? 'takeUntil' :
      callee.includes('takeWhile') ? 'takeWhile' :
      callee.includes('every') ? 'every' :
      callee.includes('exists') ? 'exists' :
      callee.includes('findFirst') ? 'findFirst' :
      callee.includes('head') ? 'head' :
      callee.includes('mergeAll') ? 'mergeAll' :
      'loop';

    // reduce/reduceRight/reduceEffect(iterable, initial, reducer) use body at index 2;
    // others (forEach, filter, ...) at index 1
    const bodyArgIndex =
      loopType === 'reduce' ||
      callee.includes('reduceRight') ||
      callee.includes('reduceWhile') ||
      callee.includes('reduceEffect')
        ? (args.length >= 3 ? 2 : 1)
        : 1;

    let iterSource: string | undefined;
    let body: StaticFlowNode;
    let callbackBody: readonly StaticFlowNode[] | undefined;

    if (args.length > 0 && args[0]) {
      const rawSource = args[0].getText();
      iterSource = rawSource.length > 30 ? rawSource.slice(0, 30) + '…' : rawSource;
    }

    if (args.length > bodyArgIndex && args[bodyArgIndex]) {
      const bodyArg = args[bodyArgIndex];
      const isFn =
        bodyArg.getKind() === SyntaxKind.ArrowFunction ||
        bodyArg.getKind() === SyntaxKind.FunctionExpression;
      if (isFn) {
        const fn = bodyArg as ArrowFunction | FunctionExpression;
        const effectfulSummary = buildCallbackSummaryNodes(
          fn,
          filePath,
          opts.includeLocations ?? false,
        );
        const pureSummary = buildPureCallbackSummaryNodes(
          fn,
          filePath,
          opts.includeLocations ?? false,
        );
        callbackBody = effectfulSummary ?? pureSummary;
        body =
          callbackBody?.length === 1
            ? callbackBody[0]!
            : {
                id: generateId(),
                type: 'opaque',
                reason: 'callback-body',
                sourceText: summarizeLoopCallbackSource(loopType, callbackBody ?? []),
                location: extractLocation(bodyArg, filePath, opts.includeLocations ?? false),
              };
      } else {
        body = yield* deps.analyzeEffectExpression(
          bodyArg,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      }
    } else {
      const predicateArg = args[0];
      const predicateLikeLoop =
        loopType === 'exists' ||
        loopType === 'every' ||
        loopType === 'findFirst' ||
        loopType === 'head';
      if (predicateLikeLoop && predicateArg) {
        body = {
          id: generateId(),
          type: 'opaque',
          reason: 'predicate',
          sourceText: predicateArg.getText().slice(0, 100),
          location: extractLocation(predicateArg, filePath, opts.includeLocations ?? false),
        };
      } else {
        body = {
          id: generateId(),
          type: 'unknown',
          reason: 'Could not determine loop body',
        };
      }
    }

    stats.loopCount++;

    const loopNode: StaticLoopNode = {
      id: generateId(),
      type: 'loop',
      loopType,
      iterSource,
      body,
      ...(callbackBody ? { callbackBody } : {}),
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...loopNode,
      displayName: computeDisplayName(loopNode),
      semanticRole: computeSemanticRole(loopNode),
    };
  });

/** Analyze Match.type / Match.when / Match.tag / Match.exhaustive etc. */
export const analyzeMatchCall = (
  call: CallExpression,
  callee: string,
  filePath: string,
  opts: Required<AnalyzerOptions>,
): StaticMatchNode => {
  const matchOp: StaticMatchNode['matchOp'] = MATCH_OP_MAP[callee] ?? 'other';
  const isExhaustive = EXHAUSTIVE_OPS.has(matchOp);

  // Extract tag names for Match.tag(tag, fn), Match.tags({ tag1: fn, tag2: fn })
  const args = call.getArguments();
  const matchedTags: string[] = [];
  if ((matchOp === 'when' || matchOp === 'tag') && args[0]) {
    const arg0 = args[0].getText().replace(/["'`]/g, '').trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg0)) matchedTags.push(arg0);
  }
  if (matchOp === 'tags' || matchOp === 'tagsExhaustive') {
    const { SyntaxKind } = loadTsMorph();
    for (const arg of args) {
      if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
        const obj = arg as ObjectLiteralExpression;
        for (const prop of obj.getProperties()) {
          const name = prop.getKind() === SyntaxKind.PropertyAssignment
            ? (prop as PropertyAssignment).getName()
            : undefined;
          if (name) matchedTags.push(name.replace(/["'`]/g, ''));
        }
      }
    }
  }

  const matchNode: StaticMatchNode = {
    id: generateId(),
    type: 'match',
    matchOp,
    isExhaustive,
    ...(matchedTags.length > 0 ? { matchedTags } : {}),
    location: extractLocation(call, filePath, opts.includeLocations ?? false),
  };
  return {
    ...matchNode,
    displayName: computeDisplayName(matchNode),
    semanticRole: computeSemanticRole(matchNode),
  };
};

/** Analyze Cause.fail / die / interrupt / parallel / sequential / failures / etc. */
export const analyzeCauseCall = (
  deps: AnalysisContext,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticCauseNode, AnalysisError> =>
  Effect.gen(function* () {
    const causeOp: StaticCauseNode['causeOp'] = CAUSE_OP_MAP[callee] ?? 'other';
    const isConstructor = CAUSE_CONSTRUCTORS.has(causeOp);
    let children: readonly StaticFlowNode[] | undefined;
    if (causeOp === 'parallel' || causeOp === 'sequential') {
      const args = call.getArguments();
      const childNodes: StaticFlowNode[] = [];
      for (const arg of args) {
        if (arg) {
          const child = yield* deps.analyzeEffectExpression(
            arg,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
          childNodes.push(child);
        }
      }
      if (childNodes.length > 0) children = childNodes;
    }
    // Determine causeKind
    let causeKind: StaticCauseNode['causeKind'];
    if (causeOp === 'fail') causeKind = 'fail';
    else if (causeOp === 'die') causeKind = 'die';
    else if (causeOp === 'interrupt') causeKind = 'interrupt';
    else if ((causeOp === 'parallel' || causeOp === 'sequential') && children && children.length > 0) {
      const childKinds = children
        .filter((c): c is StaticCauseNode => c.type === 'cause')
        .map((c) => c.causeKind)
        .filter((k): k is NonNullable<typeof k> => k !== undefined);
      if (childKinds.length > 0) {
        causeKind = childKinds.every((k) => k === childKinds[0]) ? childKinds[0] : 'mixed';
      }
    }

    const causeNode: StaticCauseNode = {
      id: generateId(),
      type: 'cause',
      causeOp,
      isConstructor,
      ...(children ? { children } : {}),
      ...(causeKind ? { causeKind } : {}),
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...causeNode,
      displayName: computeDisplayName(causeNode),
      semanticRole: computeSemanticRole(causeNode),
    };
  });

/** Analyze Exit.succeed / fail / die / interrupt / match / isSuccess / etc. */
export const analyzeExitCall = (
  call: CallExpression,
  callee: string,
  filePath: string,
  opts: Required<AnalyzerOptions>,
): StaticExitNode => {
  const exitOp: StaticExitNode['exitOp'] = EXIT_OP_MAP[callee] ?? 'other';
  const isConstructor = EXIT_CONSTRUCTORS.has(exitOp);
  const exitNode: StaticExitNode = {
    id: generateId(),
    type: 'exit',
    exitOp,
    isConstructor,
    location: extractLocation(call, filePath, opts.includeLocations ?? false),
  };
  return {
    ...exitNode,
    displayName: computeDisplayName(exitNode),
    semanticRole: computeSemanticRole(exitNode),
  };
};

/** Analyze Effect.map / flatMap / andThen / tap / zip / as / flatten etc. */
export const analyzeTransformCall = (
  deps: AnalysisContext,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticTransformNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    const transformType: StaticTransformNode['transformType'] =
      TRANSFORM_OPS[callee] ?? 'other';
    const isEffectful = EFFECTFUL_TRANSFORMS.has(transformType);

    // For data-last forms (2 args), first arg is the source
    // For curried forms (1 arg), the source is from the outer pipe
    let source: StaticFlowNode | undefined;
    let fn: string | undefined;

    if (args.length >= 2 && args[0]) {
      source = yield* deps.analyzeEffectExpression(
        args[0],
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
      if (args[1]) {
        const fnText = args[1].getText();
        fn = fnText.length <= 120 ? fnText : fnText.slice(0, 120) + '…';
      }
    } else if (args.length === 1 && args[0]) {
      // Curried - single arg is the function
      const fnText = args[0].getText();
      fn = fnText.length <= 120 ? fnText : fnText.slice(0, 120) + '…';
    }

    stats.totalEffects++;

    const transformNode: StaticTransformNode = {
      id: generateId(),
      type: 'transform',
      transformType,
      isEffectful,
      ...(source !== undefined ? { source } : {}),
      ...(fn !== undefined ? { fn } : {}),
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...transformNode,
      displayName: computeDisplayName(transformNode),
      semanticRole: computeSemanticRole(transformNode),
    } satisfies StaticTransformNode;
  });
