/**
 * Concurrency-primitive / Fiber / Interruption call analyzers.
 *
 * - `analyzeConcurrencyPrimitiveCall` classifies Queue/PubSub/Deferred/Semaphore/etc.
 *   It does not recurse, so it takes no deps.
 * - `analyzeFiberCall` and `analyzeInterruptionCall` recurse into source effects
 *   via `deps.analyzeEffectExpression`.
 *
 * Extracted from effect-analysis.ts via the strangler-fig DI pattern.
 * Behaviour is preserved exactly.
 */

import { Effect } from 'effect';
import type {
  CallExpression,
  SourceFile,
  PropertyAccessExpression,
  NumericLiteral,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type {
  StaticFlowNode,
  StaticConcurrencyPrimitiveNode,
  StaticStreamNode,
  StaticFiberNode,
  StaticInterruptionNode,
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
import { getNumericLiteralFromNode } from './analysis-patterns';
import type { AnalyzerDeps } from './stream-channel-sink-analyzers';

/** Parse concurrency primitive (Queue, PubSub, Deferred, etc.) - GAP 6 */
export function analyzeConcurrencyPrimitiveCall(
  call: CallExpression,
  callee: string,
  _sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  _stats: AnalysisStats,
): Effect.Effect<StaticConcurrencyPrimitiveNode | StaticStreamNode, AnalysisError> {
  const { SyntaxKind } = loadTsMorph();
  let primitive: StaticConcurrencyPrimitiveNode['primitive'] = 'queue';
  let operation: StaticConcurrencyPrimitiveNode['operation'] = 'create';
  let strategy: 'bounded' | 'unbounded' | 'sliding' | 'dropping' | undefined;
  let capacity: number | undefined;
  let permitCount: number | undefined;

  if (callee.startsWith('Queue.')) {
    primitive = 'queue';
    if (callee.includes('bounded')) strategy = 'bounded';
    else if (callee.includes('unbounded')) strategy = 'unbounded';
    else if (callee.includes('sliding')) strategy = 'sliding';
    else if (callee.includes('dropping')) strategy = 'dropping';
    if (callee.includes('offer') || callee.includes('offerAll')) operation = 'offer';
    else if (callee.includes('take') || callee.includes('takeAll') || callee.includes('poll')) operation = 'take';
    else operation = 'create';
  } else if (callee.startsWith('PubSub.')) {
    primitive = 'pubsub';
    if (callee.includes('bounded')) strategy = 'bounded';
    else if (callee.includes('unbounded')) strategy = 'unbounded';
    if (callee.includes('publish')) operation = 'publish';
    else if (callee.includes('subscribe')) operation = 'subscribe';
    else operation = 'create';
  } else if (callee.startsWith('Deferred.')) {
    primitive = 'deferred';
    if (callee.includes('succeed')) operation = 'succeed';
    else if (callee.includes('fail')) operation = 'fail';
    else if (callee.includes('await')) operation = 'await';
    else operation = 'create';
  } else if (callee.startsWith('Semaphore.')) {
    primitive = 'semaphore';
    if (callee.includes('withPermit')) operation = 'withPermit';
    else if (callee.includes('take')) operation = 'take';
    else if (callee.includes('release')) operation = 'release';
    else if (callee.includes('available')) operation = 'available';
    else operation = 'create';
  } else if (callee.startsWith('Mailbox.')) {
    primitive = 'mailbox';
    if (callee.includes('offer')) operation = 'offer';
    else if (callee.includes('takeAll')) operation = 'takeAll';
    else if (callee.includes('take')) operation = 'take';
    else if (callee.includes('end')) operation = 'end';
    else if (callee.includes('toStream')) operation = 'toStream';
    else operation = 'create';
  } else if (callee.startsWith('SubscriptionRef.')) {
    primitive = 'subscriptionRef';
    if (callee.includes('changes')) operation = 'changes';
    else if (callee.includes('get')) operation = 'get';
    else if (callee.includes('set')) operation = 'set';
    else if (callee.includes('update')) operation = 'update';
    else operation = 'create';
  } else if (callee.includes('makeLatch') || callee.includes('Latch.')) {
    primitive = 'latch';
    if (callee.includes('open')) operation = 'open';
    else if (callee.includes('close')) operation = 'close';
    else if (callee.includes('await') || callee.includes('whenOpen')) operation = 'await';
    else operation = 'create';
  } else if (callee.startsWith('FiberHandle.')) {
    primitive = 'fiberHandle';
    if (callee.includes('run')) operation = 'run';
    else if (callee.includes('await')) operation = 'await';
    else operation = 'create';
  } else if (callee.startsWith('FiberSet.')) {
    primitive = 'fiberSet';
    if (callee.includes('run')) operation = 'run';
    else if (callee.includes('join')) operation = 'await';
    else operation = 'create';
  } else if (callee.startsWith('FiberMap.')) {
    primitive = 'fiberMap';
    if (callee.includes('run')) operation = 'run';
    else if (callee.includes('join')) operation = 'await';
    else operation = 'create';
  } else if (callee.startsWith('RateLimiter.')) {
    primitive = 'rateLimiter';
    if (callee.includes('withCost')) operation = 'withPermit';
    else operation = 'create';
  } else if (callee.startsWith('ScopedCache.')) {
    primitive = 'scopedCache';
    if (callee.includes('make') || callee.includes('Make')) operation = 'create';
    else if (callee.includes('get') && !callee.includes('getOrElse')) operation = 'get';
    else if (callee.includes('getOrElse')) operation = 'get';
    else if (callee.includes('set') || callee.includes('Set')) operation = 'set';
    else if (callee.includes('invalidate')) operation = 'invalidate';
    else if (callee.includes('contains')) operation = 'contains';
    else operation = 'create';
  } else if (callee.startsWith('Cache.')) {
    primitive = 'cache';
    if (callee.includes('make') || callee.includes('Make')) operation = 'create';
    else if (callee.includes('get') && !callee.includes('getOrElse')) operation = 'get';
    else if (callee.includes('getOrElse')) operation = 'get';
    else if (callee.includes('set') || callee.includes('Set')) operation = 'set';
    else if (callee.includes('invalidate')) operation = 'invalidate';
    else if (callee.includes('contains')) operation = 'contains';
    else operation = 'create';
  } else if (callee.startsWith('Reloadable.') || callee.includes('.Reloadable.')) {
    primitive = 'reloadable';
    if (callee.includes('make') || callee.includes('Make')) operation = 'create';
    else if (callee.includes('get') && !callee.includes('reload')) operation = 'get';
    else if (callee.includes('reload')) operation = 'reload';
    else operation = 'create';
  } else if (callee.startsWith('RcMap.') || callee.includes('.RcMap.')) {
    primitive = 'rcMap';
    if (callee.includes('make') || callee.includes('Make')) operation = 'create';
    else if (callee.includes('get')) operation = 'get';
    else if (callee.includes('set') || callee.includes('Set')) operation = 'set';
    else if (callee.includes('update')) operation = 'update';
    else operation = 'create';
  } else if (callee.startsWith('RcRef.') || callee.includes('.RcRef.')) {
    primitive = 'rcRef';
    if (callee.includes('make') || callee.includes('Make')) operation = 'create';
    else if (callee.includes('get')) operation = 'get';
    else if (callee.includes('set') || callee.includes('Set')) operation = 'set';
    else if (callee.includes('update')) operation = 'update';
    else operation = 'create';
  }

  const args = call.getArguments();
  if (args.length > 0 && strategy === 'bounded') {
    const first = args[0];
    if (first?.getKind() === SyntaxKind.NumericLiteral) {
      capacity = Number.parseInt((first as NumericLiteral).getText(), 10);
    }
  }
  if (primitive === 'semaphore' && (operation === 'take' || operation === 'release') && args.length > 0 && args[0]) {
    permitCount = getNumericLiteralFromNode(args[0]);
  }

  // Extract lifecycle options for FiberHandle.run({ onlyIfMissing: true })
  let lifecycleOptions: Record<string, unknown> | undefined;
  if (primitive === 'fiberHandle' && operation === 'run') {
    for (const arg of args) {
      const text = arg.getText();
      if (text.includes('onlyIfMissing')) {
        lifecycleOptions = { onlyIfMissing: text.includes('true') };
      }
    }
  }

  // Mailbox.toStream and SubscriptionRef.changes produce stream nodes
  if (
    (primitive === 'mailbox' && operation === 'toStream') ||
    (primitive === 'subscriptionRef' && operation === 'changes')
  ) {
    const constructorType =
      primitive === 'mailbox' ? ('fromMailbox' as const) : ('fromSubscriptionRef' as const);
    const innerPrimNode = {
      id: generateId(),
      type: 'concurrency-primitive' as const,
      primitive,
      operation,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    const streamNode = {
      id: generateId(),
      type: 'stream' as const,
      source: {
        ...innerPrimNode,
        displayName: computeDisplayName(innerPrimNode),
        semanticRole: computeSemanticRole(innerPrimNode),
      },
      pipeline: [],
      constructorType,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    } as StaticStreamNode;
    return Effect.succeed({
      ...streamNode,
      displayName: computeDisplayName(streamNode),
      semanticRole: computeSemanticRole(streamNode),
    });
  }

  const concurrencyNode: StaticConcurrencyPrimitiveNode = {
    id: generateId(),
    type: 'concurrency-primitive',
    primitive,
    operation,
    strategy,
    capacity,
    ...(permitCount !== undefined ? { permitCount } : {}),
    ...(lifecycleOptions ? { lifecycleOptions } : {}),
    location: extractLocation(call, filePath, opts.includeLocations ?? false),
  };
  return Effect.succeed({
    ...concurrencyNode,
    displayName: computeDisplayName(concurrencyNode),
    semanticRole: computeSemanticRole(concurrencyNode),
  });
}

/** Parse fiber operations (Effect.fork, Fiber.join, etc.) - GAP 1 */
export function analyzeFiberCall(
  deps: AnalyzerDeps,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticFiberNode, AnalysisError> {
  return Effect.gen(function* () {
    const args = call.getArguments();
    const { SyntaxKind } = loadTsMorph();
    let operation: StaticFiberNode['operation'] = 'fork';
    let isScoped = false;
    let isDaemon = false;
    let fiberSource: StaticFlowNode | undefined;
    let joinPoint: string | undefined;

    if (callee.startsWith('Fiber.')) {
      if (callee.includes('awaitAll')) operation = 'awaitAll';
      else if (callee.includes('join')) operation = 'join';
      else if (callee.includes('await')) operation = 'await';
      else if (callee.includes('interruptFork')) operation = 'interruptFork';
      else if (callee.includes('interrupt')) operation = 'interrupt';
      else if (callee.includes('poll')) operation = 'poll';
      else if (callee.includes('status')) operation = 'status';
      else if (callee.includes('all')) operation = 'all';
      else if (callee.includes('children')) operation = 'children';
      else if (callee.includes('dump')) operation = 'dump';
      else if (callee.includes('scoped')) { operation = 'scoped'; isScoped = true; }
      else if (callee.includes('inheritAll')) operation = 'inheritAll';
      else if (callee.includes('mapFiber')) operation = 'mapFiber';
      else if (callee.includes('mapEffect')) operation = 'mapEffect';
      else if (callee.includes('map')) operation = 'map';
      else if (callee.includes('roots')) operation = 'roots';
      else if (callee.includes('getCurrentFiber')) operation = 'getCurrentFiber';
    } else if (callee.includes('forkWithErrorHandler')) {
      operation = 'forkWithErrorHandler';
    } else if (callee.includes('forkAll')) {
      operation = 'forkAll';
    } else if (callee.includes('forkIn')) {
      operation = 'forkIn';
    } else if (callee.includes('fork')) {
      if (callee.includes('forkDaemon')) {
        operation = 'forkDaemon';
        isDaemon = true;
      } else if (callee.includes('forkScoped')) {
        operation = 'forkScoped';
        isScoped = true;
      } else {
        operation = 'fork';
      }
    }

    if (
      (operation === 'fork' ||
        operation === 'forkScoped' ||
        operation === 'forkDaemon' ||
        operation === 'forkAll' ||
        operation === 'forkIn' ||
        operation === 'forkWithErrorHandler') &&
      args.length > 0 &&
      args[0]
    ) {
      fiberSource = yield* deps.analyzeEffectExpression(
        args[0],
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (
      (operation === 'join' || operation === 'await' || operation === 'interrupt' || operation === 'interruptFork') &&
      args.length > 0 &&
      args[0]
    ) {
      const firstArg = args[0];
      if (firstArg.getKind() === SyntaxKind.Identifier) {
        joinPoint = firstArg.getText();
      }
    }

    // Determine scope context: 'safe' when fork is scoped or inside Effect.scoped/Scope.make
    let scopeContext: string | undefined;
    if (isScoped) {
      scopeContext = 'safe';
    } else {
      // Walk up AST to check if inside Effect.scoped
      let parent = call.getParent();
      while (parent) {
        const parentText = parent.getText?.();
        if (parentText && (parentText.includes('Effect.scoped') || parentText.includes('Scope.make'))) {
          scopeContext = 'safe';
          break;
        }
        parent = parent.getParent();
        // Don't walk too far
        if (parent && parent === sourceFile) break;
      }
    }

    const fiberNode: StaticFiberNode = {
      id: generateId(),
      type: 'fiber',
      operation,
      fiberSource,
      isScoped,
      isDaemon,
      ...(joinPoint ? { joinPoint } : {}),
      ...(scopeContext ? { scopeContext } : {}),
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...fiberNode,
      displayName: computeDisplayName(fiberNode),
      semanticRole: computeSemanticRole(fiberNode),
    };
  });
}

/** Parse interruption operations (interruptible, uninterruptible, onInterrupt, etc.) */
export function analyzeInterruptionCall(
  deps: AnalyzerDeps,
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticInterruptionNode, AnalysisError> {
  return Effect.gen(function* () {
    const args = call.getArguments();
    const { SyntaxKind } = loadTsMorph();

    let interruptionType: StaticInterruptionNode['interruptionType'];
    if (callee.includes('uninterruptibleMask')) interruptionType = 'uninterruptibleMask';
    else if (callee.includes('interruptibleMask')) interruptionType = 'interruptibleMask';
    else if (callee.includes('uninterruptible')) interruptionType = 'uninterruptible';
    else if (callee.includes('interruptible')) interruptionType = 'interruptible';
    else if (callee.includes('onInterrupt')) interruptionType = 'onInterrupt';
    else if (callee.includes('disconnect')) interruptionType = 'disconnect';
    else if (callee.includes('allowInterrupt')) interruptionType = 'allowInterrupt';
    else if (callee.includes('interruptWith')) interruptionType = 'interruptWith';
    else interruptionType = 'interrupt';

    let source: StaticFlowNode | undefined;
    let handler: StaticFlowNode | undefined;

    // Method call form: effect.pipe(Effect.interruptible) or effect.interruptible
    const expr = call.getExpression();
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const propAccess = expr as PropertyAccessExpression;
      source = yield* deps.analyzeEffectExpression(propAccess.getExpression(), sourceFile, filePath, opts, warnings, stats);
      if (args.length > 0 && args[0]) {
        handler = yield* deps.analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats);
      }
    } else if (args.length > 0 && args[0]) {
      source = yield* deps.analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats);
      if (args.length > 1 && args[1]) {
        handler = yield* deps.analyzeEffectExpression(args[1], sourceFile, filePath, opts, warnings, stats);
      }
    }

    stats.interruptionCount++;

    const interruptionNode: StaticInterruptionNode = {
      id: generateId(),
      type: 'interruption',
      interruptionType,
      source,
      handler,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...interruptionNode,
      displayName: computeDisplayName(interruptionNode),
      semanticRole: computeSemanticRole(interruptionNode),
    };
  });
}
