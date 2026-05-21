/**
 * Stream / Channel / Sink call analyzers.
 *
 * These functions parse Stream.*, Channel.* and Sink.* call expressions into
 * their corresponding IR nodes. They recursively analyse argument expressions,
 * which used to create a circular import on `analyzeEffectExpression` — so the
 * dependency is now passed in via the `AnalyzerDeps` parameter, keeping the
 * module acyclic.
 *
 * Extracted from effect-analysis.ts as part of the strangler-fig cleanup.
 * Behaviour is preserved exactly; the only change is `analyzeEffectExpression`
 * is now accessed via `deps.analyzeEffectExpression` instead of a direct call.
 */

import { Effect } from 'effect';
import type {
  CallExpression,
  Node,
  SourceFile,
  PropertyAccessExpression,
  ArrowFunction,
  FunctionExpression,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type {
  StaticFlowNode,
  StaticStreamNode,
  StaticChannelNode,
  StaticSinkNode,
  StreamOperatorInfo,
  ChannelOperatorInfo,
  SinkOperatorInfo,
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
  buildCallbackSummaryNodes,
  buildPureCallbackSummaryNodes,
} from './callback-summary';
import { channelOpCategory, sinkOpCategory } from './analysis-classifiers';
import { getNumericLiteralFromNode } from './analysis-patterns';

/**
 * Signature of `analyzeEffectExpression` — passed into the extracted analyzers
 * so they can recurse without re-importing the main module.
 */
export type AnalyzeEffectExpressionFn = (
  node: Node,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  serviceScope?: Map<string, string>,
) => Effect.Effect<StaticFlowNode, AnalysisError>;

export interface AnalyzerDeps {
  readonly analyzeEffectExpression: AnalyzeEffectExpressionFn;
}

/** Parse Stream.* call into StaticStreamNode (GAP 5). */
export function analyzeStreamCall(
  deps: AnalyzerDeps,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  serviceScope?: Map<string, string>,
): Effect.Effect<StaticStreamNode, AnalysisError> {
  return Effect.gen(function* () {
    const args = call.getArguments();
    const { SyntaxKind } = loadTsMorph();

    if (
      call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression &&
      (call.getExpression() as PropertyAccessExpression).getName() === 'pipe'
    ) {
      const propAccess = call.getExpression() as PropertyAccessExpression;
      const baseExpr = propAccess.getExpression();
      const analyzedBase = yield* deps.analyzeEffectExpression(
        baseExpr,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
        serviceScope,
      );

      const effectiveSource =
        analyzedBase.type === 'stream' ? analyzedBase.source : analyzedBase;
      const pipeline =
        analyzedBase.type === 'stream' ? [...analyzedBase.pipeline] : [];
      let sink =
        analyzedBase.type === 'stream' ? analyzedBase.sink : undefined;
      let backpressureStrategy =
        analyzedBase.type === 'stream'
          ? analyzedBase.backpressureStrategy
          : undefined;
      let constructorType =
        analyzedBase.type === 'stream' ? analyzedBase.constructorType : undefined;

      for (const arg of args) {
        const analyzed = yield* deps.analyzeEffectExpression(
          arg,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
          serviceScope,
        );
        if (analyzed.type === 'stream') {
          pipeline.push(...analyzed.pipeline);
          if (!sink && analyzed.sink) sink = analyzed.sink;
          if (!backpressureStrategy && analyzed.backpressureStrategy) {
            backpressureStrategy = analyzed.backpressureStrategy;
          }
          if (!constructorType && analyzed.constructorType) {
            constructorType = analyzed.constructorType;
          }
        }
      }

      const streamNode: StaticStreamNode = {
        id: generateId(),
        type: 'stream',
        source: effectiveSource,
        pipeline,
        ...(sink ? { sink } : {}),
        ...(backpressureStrategy ? { backpressureStrategy } : {}),
        ...(constructorType ? { constructorType } : {}),
        location: extractLocation(call, filePath, opts.includeLocations ?? false),
      };
      return {
        ...streamNode,
        displayName: computeDisplayName(streamNode),
        semanticRole: computeSemanticRole(streamNode),
      };
    }

    let source: StaticFlowNode;
    if (args.length > 0 && args[0]) {
      source = yield* deps.analyzeEffectExpression(
        args[0],
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
        serviceScope,
      );
    } else {
      source = {
        id: generateId(),
        type: 'unknown',
        reason: 'Stream source not determined',
      };
    }
    const opName = callee.replace(/^Stream\./, '') || 'unknown';

    // Classify constructor type
    let constructorType: StaticStreamNode['constructorType'];
    if (callee.startsWith('Stream.')) {
      if (opName === 'fromIterable' || opName === 'fromChunk' || opName === 'fromChunkQueue') constructorType = 'fromIterable';
      else if (opName === 'fromArray') constructorType = 'fromArray';
      else if (opName === 'fromQueue' || opName === 'fromChunkQueue') constructorType = 'fromQueue';
      else if (opName === 'fromPubSub' || opName === 'fromChunkPubSub') constructorType = 'fromPubSub';
      else if (opName === 'fromEffect' || opName === 'unwrap' || opName === 'unwrapScoped') constructorType = 'fromEffect';
      else if (opName === 'fromAsyncIterable') constructorType = 'fromAsyncIterable';
      else if (opName === 'fromReadableStream' || opName === 'fromReadableStreamByob') constructorType = 'fromReadableStream';
      else if (opName === 'fromEventListener') constructorType = 'fromEventListener';
      else if (opName === 'fromSchedule') constructorType = 'fromSchedule';
      else if (opName === 'range') constructorType = 'range';
      else if (opName === 'tick') constructorType = 'tick';
      else if (opName === 'iterate' || opName === 'iterateEffect') constructorType = 'iterate';
      else if (opName === 'unfold' || opName === 'unfoldEffect' || opName === 'unfoldChunk' || opName === 'unfoldChunkEffect') constructorType = 'unfold';
      else if (opName === 'make') constructorType = 'make';
      else if (opName === 'empty') constructorType = 'empty';
      else if (opName === 'never') constructorType = 'never';
      else if (opName === 'succeed' || opName === 'sync') constructorType = 'succeed';
      else if (opName === 'fail' || opName === 'failSync' || opName === 'failCause' || opName === 'failCauseSync') constructorType = 'fail';
    }

    // Classify operator category
    const classifyOperator = (op: string): StreamOperatorInfo['category'] => {
      if (constructorType !== undefined) return 'constructor';
      if (op.startsWith('run')) return 'sink';
      if (op === 'toQueue' || op === 'toPubSub' || op === 'toReadableStream' || op === 'toAsyncIterable' || op === 'toChannel') return 'conversion';
      if (op.includes('pipeThroughChannel') || op.includes('Channel') || op.includes('channel') || op.includes('duplex')) return 'channel';
      if (op.includes('grouped') || op.includes('sliding') || op.includes('groupBy') || op.includes('aggregate') || op.includes('window')) return 'windowing';
      if (op.includes('broadcast') || op === 'share') return 'broadcasting';
      if (op.includes('haltAfter') || op.includes('haltWhen') || op.includes('interruptAfter')) return 'halting';
      if (op.includes('decodeText') || op.includes('encodeText') || op.includes('splitLines')) return 'text';
      if (op.includes('merge') || op === 'concat' || op.includes('interleave') || op.includes('zip')) return 'merge';
      if (op.includes('buffer') || op.includes('debounce') || op.includes('throttle')) return 'backpressure';
      if (op.includes('catchAll') || op.includes('catchTag') || op.includes('orElse') || op.includes('orDie') || op.includes('retry')) return 'error';
      if (op.includes('filter') || op.includes('take') || op.includes('drop') || op.includes('head') || op === 'first' || op === 'last') return 'filter';
      if (op.includes('acquireRelease') || op.includes('scoped') || op.includes('ensuring') || op.includes('onDone') || op.includes('onError')) return 'resource';
      if (op.includes('provide') || op.includes('withSpan') || op.includes('annotate')) return 'context';
      if (op.includes('map') || op.includes('tap') || op.includes('flatMap') || op.includes('mapChunk') || op.includes('scan') || op.includes('transduce')) return 'transform';
      return 'other';
    };

    const isEffectful =
      opName.includes('Effect') ||
      opName.startsWith('run') ||
      opName.includes('tap');
    const callbackArg = args.find(
      (arg) =>
        arg.getKind() === SyntaxKind.ArrowFunction ||
        arg.getKind() === SyntaxKind.FunctionExpression,
    );
    const callbackBody = callbackArg
      ? (
          opName.includes('Effect') || opName.includes('tap')
            ? buildCallbackSummaryNodes(
                callbackArg as ArrowFunction | FunctionExpression,
                filePath,
                opts.includeLocations ?? false,
              )
            : buildPureCallbackSummaryNodes(
                callbackArg as ArrowFunction | FunctionExpression,
                filePath,
                opts.includeLocations ?? false,
              )
        )
      : undefined;
    const opCategory = classifyOperator(opName);
    const cardinality: StreamOperatorInfo['estimatedCardinality'] =
      opCategory === 'filter' ? 'fewer' :
      opCategory === 'merge' ? 'more' :
      opCategory === 'broadcasting' ? 'more' :
      opCategory === 'halting' ? 'fewer' :
      opCategory === 'sink' ? 'fewer' :
      opCategory === 'windowing' ? 'fewer' :
      'unknown';

    // Windowing detail (GAP 2): size/stride for grouped, groupedWithin, sliding
    let windowSize: number | undefined;
    let stride: number | undefined;
    const isWindowingOp =
      opName === 'grouped' ||
      opName === 'groupedWithin' ||
      opName.includes('sliding') ||
      opName.includes('Sliding');
    if (isWindowingOp && args.length > 0 && args[0]) {
      windowSize = getNumericLiteralFromNode(args[0]);
      if (
        (opName.includes('sliding') || opName.includes('Sliding')) &&
        args.length > 1 &&
        args[1]
      ) {
        stride = getNumericLiteralFromNode(args[1]);
      }
    }

    const thisOp: StreamOperatorInfo = {
      operation: opName,
      isEffectful,
      ...(callbackBody ? { callbackBody } : {}),
      estimatedCardinality: cardinality,
      category: opCategory,
      ...(windowSize !== undefined ? { windowSize } : {}),
      ...(stride !== undefined ? { stride } : {}),
    };

    let sink: string | undefined;
    if (opName.startsWith('run')) sink = opName;
    let backpressureStrategy: StaticStreamNode['backpressureStrategy'];
    if (opName.includes('buffer')) backpressureStrategy = 'buffer';
    else if (opName.includes('drop') || opName.includes('Drop')) backpressureStrategy = 'drop';
    else if (opName.includes('sliding') || opName.includes('Sliding')) backpressureStrategy = 'sliding';

    // Flatten nested stream pipeline: if source is itself a StreamNode (data-last
    // call pattern), merge its pipeline into ours and use its base source.
    let effectiveSource = source;
    let pipeline: StreamOperatorInfo[] = [thisOp];
    let effectiveConstructorType = constructorType;
    if (source.type === 'stream') {
      const srcStream = source;
      // Prepend the upstream pipeline so the full chain is visible in one node
      pipeline = [...srcStream.pipeline, thisOp];
      effectiveSource = srcStream.source;
      // Inherit upstream constructorType/sink/strategy if this node doesn't override
      if (!effectiveConstructorType && srcStream.constructorType) effectiveConstructorType = srcStream.constructorType;
      if (!sink && srcStream.sink) sink = srcStream.sink;
      if (!backpressureStrategy && srcStream.backpressureStrategy) backpressureStrategy = srcStream.backpressureStrategy;
    }

    const streamNode: StaticStreamNode = {
      id: generateId(),
      type: 'stream',
      source: effectiveSource,
      pipeline,
      sink,
      backpressureStrategy,
      constructorType: effectiveConstructorType,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...streamNode,
      displayName: computeDisplayName(streamNode),
      semanticRole: computeSemanticRole(streamNode),
    };
  });
}

/** Parse Channel.* call into StaticChannelNode (improve.md §8). */
export function analyzeChannelCall(
  deps: AnalyzerDeps,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticChannelNode, AnalysisError> {
  return Effect.gen(function* () {
    const args = call.getArguments();
    let source: StaticFlowNode | undefined;
    if (args.length > 0 && args[0]) {
      source = yield* deps.analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats);
    }
    const opName = callee.replace(/^Channel\./, '') || 'unknown';
    const pipeline: ChannelOperatorInfo[] = [{ operation: opName, category: channelOpCategory(opName) }];
    if (source?.type === 'channel') {
      const srcChan = source;
      pipeline.unshift(...srcChan.pipeline);
      source = srcChan.source;
    }
    const channelNode: StaticChannelNode = {
      id: generateId(),
      type: 'channel',
      source,
      pipeline,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...channelNode,
      displayName: computeDisplayName(channelNode),
      semanticRole: computeSemanticRole(channelNode),
    };
  });
}

/** Parse Sink.* call into StaticSinkNode (improve.md §8). */
export function analyzeSinkCall(
  deps: AnalyzerDeps,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticSinkNode, AnalysisError> {
  return Effect.gen(function* () {
    const args = call.getArguments();
    let source: StaticFlowNode | undefined;
    if (args.length > 0 && args[0]) {
      source = yield* deps.analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats);
    }
    const opName = callee.replace(/^Sink\./, '') || 'unknown';
    const pipeline: SinkOperatorInfo[] = [{ operation: opName, category: sinkOpCategory(opName) }];
    if (source?.type === 'sink') {
      const srcSink = source;
      pipeline.unshift(...srcSink.pipeline);
      source = srcSink.source;
    }
    const sinkNode: StaticSinkNode = {
      id: generateId(),
      type: 'sink',
      source,
      pipeline,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...sinkNode,
      displayName: computeDisplayName(sinkNode),
      semanticRole: computeSemanticRole(sinkNode),
    };
  });
}
