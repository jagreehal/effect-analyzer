/**
 * Pattern maps and semantic helpers for Effect API detection and classification.
 */

import type {
  Node,
  CallExpression,
  PropertyAccessExpression,
  ObjectLiteralExpression,
  PropertyAssignment,
  Block,
  AwaitExpression,
  ConditionalExpression,
  PrefixUnaryExpression,
  ArrowFunction,
  FunctionExpression,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type {
  StaticTransformNode,
  StaticMatchNode,
  StaticCauseNode,
  StaticExitNode,
  StaticScheduleNode,
} from './types';

// =============================================================================
// Error / conditional / resource / collection / fiber patterns
// =============================================================================

export const ERROR_HANDLER_PATTERNS = [
  '.catchAll',
  '.catchTag',
  '.catchAllCause',
  '.catchIf',
  '.catchSome',
  '.catchSomeCause',
  '.catchSomeDefect',
  '.catchAllDefect',
  '.catchTags',
  '.orElse',
  '.orElseFail',
  '.orElseSucceed',
  '.orDie',
  '.orDieWith',
  '.flip',
  '.mapError',
  '.mapErrorCause',
  '.mapBoth',
  '.sandbox',
  '.unsandbox',
  '.parallelErrors',
  '.filterOrDie',
  '.filterOrDieMessage',
  '.filterOrElse',
  '.filterOrFail',
  '.match',
  '.matchCause',
  '.matchEffect',
  '.matchCauseEffect',
  '.firstSuccessOf',
  '.ignore',
  '.ignoreLogged',
  '.eventually',
];

export const CONDITIONAL_PATTERNS = [
  '.if',
  '.when',
  '.whenEffect',
  '.whenFiberRef',
  '.whenRef',
  '.unless',
  '.unlessEffect',
  '.option',
  '.either',
  '.exit',
  '.liftPredicate',
];

export const RESOURCE_PATTERNS = [
  '.acquireRelease',
  '.acquireUseRelease',
  '.ensuring',
  '.addFinalizer',
  '.onExit',
  '.onError',
  '.parallelFinalizers',
  '.sequentialFinalizers',
  '.finalizersMask',
  '.using',
  '.withEarlyRelease',
];

export const COLLECTION_PATTERNS = [
  '.forEach',
  '.loop',
  '.filter',
  '.filterMap',
  '.partition',
  '.reduce',
  '.reduceRight',
  '.reduceWhile',
  '.reduceEffect',
  '.dropUntil',
  '.dropWhile',
  '.takeUntil',
  '.takeWhile',
  '.every',
  '.exists',
  '.findFirst',
  '.head',
  '.mergeAll',
  '.replicate',
  '.replicateEffect',
  '.validateAll',
  '.validateFirst',
  '.validate',
  '.validateWith',
];

export const FIBER_PATTERNS = [
  'Effect.fork',
  '.fork',
  '.forkAll',
  '.forkIn',
  '.forkWithErrorHandler',
  'Fiber.',
];

// =============================================================================
// Transform / Match / Cause / Exit / Schedule ops
// =============================================================================

export const TRANSFORM_OPS: Record<string, StaticTransformNode['transformType']> = {
  'Effect.map': 'map',
  'Effect.flatMap': 'flatMap',
  'Effect.andThen': 'andThen',
  'Effect.tap': 'tap',
  'Effect.tapBoth': 'tapBoth',
  'Effect.tapError': 'tapError',
  'Effect.tapErrorTag': 'tapErrorTag',
  'Effect.tapErrorCause': 'tapErrorCause',
  'Effect.tapDefect': 'tapDefect',
  'Effect.zipLeft': 'zipLeft',
  'Effect.zipRight': 'zipRight',
  'Effect.zipWith': 'zipWith',
  'Effect.zip': 'zip',
  'Effect.as': 'as',
  'Effect.asVoid': 'asVoid',
  'Effect.asSome': 'asSome',
  'Effect.asSomeError': 'asSomeError',
  'Effect.flatten': 'flatten',
  'Effect.ap': 'ap',
  'Effect.negate': 'negate',
  'Effect.merge': 'merge',
};
export const EFFECTFUL_TRANSFORMS = new Set(['flatMap', 'andThen', 'tapBoth', 'tapError', 'tapErrorTag', 'tapErrorCause', 'tapDefect', 'zipWith', 'zipLeft', 'zipRight', 'zip', 'ap', 'flatten']);
export const isTransformCall = (callee: string): boolean => callee in TRANSFORM_OPS;

export const MATCH_OP_MAP: Record<string, StaticMatchNode['matchOp']> = {
  'Match.type': 'type',
  'Match.tag': 'tag',
  'Match.value': 'value',
  'Match.when': 'when',
  'Match.whenOr': 'whenOr',
  'Match.whenAnd': 'whenAnd',
  'Match.not': 'not',
  'Match.is': 'is',
  'Match.exhaustive': 'exhaustive',
  'Match.orElse': 'orElse',
  'Match.option': 'option',
  'Match.either': 'either',
  'Match.discriminator': 'discriminator',
  'Match.discriminatorsExhaustive': 'discriminatorsExhaustive',
  'Match.tags': 'tags',
  'Match.tagsExhaustive': 'tagsExhaustive',
  'Match.withReturnType': 'withReturnType',
  'Match.run': 'run',
};
export const EXHAUSTIVE_OPS = new Set(['exhaustive', 'discriminatorsExhaustive', 'tagsExhaustive']);
export const isMatchCall = (callee: string): boolean =>
  callee.startsWith('Match.') && callee in MATCH_OP_MAP;

export const CAUSE_OP_MAP: Record<string, StaticCauseNode['causeOp']> = {
  'Cause.fail': 'fail',
  'Cause.die': 'die',
  'Cause.interrupt': 'interrupt',
  'Cause.parallel': 'parallel',
  'Cause.sequential': 'sequential',
  'Cause.empty': 'empty',
  'Cause.failures': 'failures',
  'Cause.defects': 'defects',
  'Cause.interruptors': 'interruptors',
  'Cause.squash': 'squash',
  'Cause.squashWith': 'squashWith',
  'Cause.pretty': 'pretty',
  'Cause.flatten': 'flatten',
  'Cause.isDie': 'isDie',
  'Cause.isFailure': 'isFailure',
  'Cause.isInterrupted': 'isInterrupted',
  'Cause.isEmpty': 'isEmpty',
  'Cause.map': 'map',
  'Cause.filter': 'filter',
};
export const CAUSE_CONSTRUCTORS = new Set(['fail', 'die', 'interrupt', 'parallel', 'sequential', 'empty']);
export const isCauseCall = (callee: string): boolean =>
  callee.startsWith('Cause.') && callee in CAUSE_OP_MAP;

export const EXIT_OP_MAP: Record<string, StaticExitNode['exitOp']> = {
  'Exit.succeed': 'succeed',
  'Exit.fail': 'fail',
  'Exit.die': 'die',
  'Exit.interrupt': 'interrupt',
  'Exit.void': 'void',
  'Exit.unit': 'unit',
  'Exit.match': 'match',
  'Exit.isSuccess': 'isSuccess',
  'Exit.isFailure': 'isFailure',
  'Exit.isInterrupted': 'isInterrupted',
  'Exit.when': 'when',
  'Exit.whenEffect': 'whenEffect',
  'Exit.exists': 'exists',
  'Exit.contains': 'contains',
  'Exit.flatten': 'flatten',
  'Exit.map': 'map',
  'Exit.mapBoth': 'mapBoth',
  'Exit.mapError': 'mapError',
  'Exit.flatMap': 'flatMap',
  'Exit.zipWith': 'zipWith',
  'Exit.tap': 'tap',
  'Exit.tapBoth': 'tapBoth',
  'Exit.tapError': 'tapError',
};
export const EXIT_CONSTRUCTORS = new Set(['succeed', 'fail', 'die', 'interrupt', 'void', 'unit']);
export const isExitCall = (callee: string): boolean =>
  callee.startsWith('Exit.') && (callee in EXIT_OP_MAP || /^Exit\.\w+$/.test(callee));

export const SCHEDULE_OP_MAP: Record<string, StaticScheduleNode['scheduleOp']> = {
  'Schedule.exponential': 'exponential',
  'Schedule.fibonacci': 'fibonacci',
  'Schedule.spaced': 'spaced',
  'Schedule.fixed': 'fixed',
  'Schedule.linear': 'linear',
  'Schedule.cron': 'cron',
  'Schedule.windowed': 'windowed',
  'Schedule.duration': 'duration',
  'Schedule.elapsed': 'elapsed',
  'Schedule.delays': 'delays',
  'Schedule.once': 'once',
  'Schedule.stop': 'stop',
  'Schedule.count': 'count',
  'Schedule.forever': 'forever',
  'Schedule.jittered': 'jittered',
  'Schedule.andThen': 'andThen',
  'Schedule.intersect': 'intersect',
  'Schedule.union': 'union',
  'Schedule.compose': 'compose',
  'Schedule.zipWith': 'zipWith',
  'Schedule.addDelay': 'addDelay',
  'Schedule.modifyDelay': 'modifyDelay',
  'Schedule.check': 'check',
  'Schedule.resetAfter': 'resetAfter',
  'Schedule.resetWhen': 'resetWhen',
  'Schedule.ensure': 'ensure',
  'Schedule.driver': 'driver',
  'Schedule.mapInput': 'mapInput',
};
export const isScheduleCall = (callee: string): boolean =>
  callee.startsWith('Schedule.') && (callee in SCHEDULE_OP_MAP || /^Schedule\.\w+$/.test(callee));

export const INTERRUPTION_PATTERNS = [
  '.interruptible',
  '.uninterruptible',
  '.interruptibleMask',
  '.uninterruptibleMask',
  '.onInterrupt',
  '.disconnect',
  '.allowInterrupt',
  'Effect.interrupt',
  '.interruptWith',
];

export const DO_NOTATION_PATTERNS = [
  '.Do',
  '.bind',
  '.bindAll',
  '.bindTo',
];

export const CACHING_PATTERNS = [
  '.cached',
  '.cachedWithTTL',
  '.cachedInvalidateWithTTL',
  '.cachedFunction',
  '.once',
  'Cache.',
  'ScopedCache.',
];

// =============================================================================
// API prefixes and built-in / service classification
// =============================================================================

export const API_PREFIXES = [
  'Effect.',
  'Layer.',
  'Schedule.',
  'Stream.',
  'Queue.',
  'PubSub.',
  'Deferred.',
  'Semaphore.',
  'Mailbox.',
  'SubscriptionRef.',
  'Scope.',
  'Fiber.',
  'Runtime.',
  'ManagedRuntime.',
  'NodeRuntime.',
  'BunRuntime.',
  'DenoRuntime.',
  'Cause.',
  'Exit.',
  'Data.',
  'Option.',
  'Either.',
  'Chunk.',
  'HashMap.',
  'HashSet.',
  'List.',
  'SortedMap.',
  'SortedSet.',
  'RedBlackTree.',
  'Trie.',
  'Graph.',
  'Match.',
  'Config.',
  'Schema.',
  'Cache.',
  'ScopedCache.',
  'RcRef.',
  'RcMap.',
  'Reloadable.',
  'Cache.',
  'ScopedCache.',
  'RateLimiter.',
  'PartitionedSemaphore.',
  'FiberSet.',
  'FiberMap.',
  'FiberHandle.',
  'Metric.',
  'Logger.',
  'Tracer.',
  'Context.',
  'HttpClient.',
  'HttpRouter.',
  'HttpApi.',
  'FileSystem.',
  'Command.',
  'Socket.',
  'SocketServer.',
  'Worker.',
  'Terminal.',
  'KeyValueStore.',
  'Multipart.',
  'Ndjson.',
  'MsgPack.',
  'OpenApi.',
  'OpenApiJsonSchema.',
  'Brand.',
  'Encoding.',
  'Predicate.',
  'DateTime.',
  'Cron.',
  'BigDecimal.',
  'HashRing.',
  'Redacted.',
  'GlobalValue.',
  'Channel.',
  'Sink.',
  'CliApp.',
  'Args.',
  'Options.',
  'AiModel.',
  'AiToolkit.',
  'Completions.',
  'AiInput.',
  'AiResponse.',
  'NodeSdk.',
  'WebSdk.',
  'Entity.',
  'ClusterSchema.',
  'MessageState.',
  'Sharding.',
  'RpcGroup.',
  'RpcApi.',
  'RpcClient.',
  'RpcRouter.',
  'SqlResolver.',
  'SqlMigrator.',
  'Printer.',
  'Doc.',
  'DocTree.',
  'PageWidth.',
  'Optimize.',
];

export const BUILT_IN_TYPE_NAMES = new Set([
  'Array', 'ReadonlyArray', 'String', 'Number', 'Boolean', 'Object',
  'Function', 'Promise', 'Math', 'Date', 'RegExp', 'Error', 'Map',
  'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'JSON', 'Console',
  'process', 'Buffer', 'EventEmitter', 'Window', 'Document', 'AbortController',
]);

export const KNOWN_EFFECT_NAMESPACES = new Set([
  // Core runtime — these are never services themselves
  'Effect', 'Layer', 'Stream', 'Queue', 'PubSub', 'Deferred', 'Semaphore',
  'Mailbox', 'SubscriptionRef', 'Scope', 'Fiber', 'Runtime', 'ManagedRuntime', 'Cause', 'Exit',
  // Data types
  'Data', 'Option', 'Either', 'Chunk', 'HashMap', 'HashSet', 'List',
  'SortedMap', 'SortedSet',
  // Matching, config, schema (S is a common alias for Schema)
  'Match', 'Config', 'Schema', 'Schedule', 'S',
  // Observability
  'Metric', 'Tracer', 'Logger',
  // Fiber management
  'FiberRef', 'FiberHandle', 'FiberSet', 'FiberMap',
  // Caching
  'Cache', 'ScopedCache', 'RateLimiter', 'Supervisor',
  // Refs and state
  'Ref', 'SynchronizedRef', 'Context',
  // Pure utilities — never services
  'Random', 'Clock', 'Duration', 'DateTime', 'Predicate', 'Tuple', 'Struct',
  'Record', 'Encoding', 'Order', 'Equivalence', 'Brand', 'Inspectable',
  'Equal', 'Hash', 'Differ', 'Types', 'Unify', 'Pipeable',
  // Streams / channels / sinks
  'Sink', 'Channel', 'GroupBy', 'Take',
  // STM
  'STM', 'TRef', 'TMap', 'TSet', 'TArray', 'TQueue', 'TPubSub', 'TDeferred', 'TSemaphore',
  // HTTP request/response builders — utility namespaces, not services
  'HttpClientRequest', 'HttpClientResponse', 'HttpClientError',
  'HttpServerRequest', 'HttpServerResponse', 'HttpRouter', 'HttpApiEndpoint',
  'HttpApiGroup', 'HttpApi', 'HttpApiBuilder', 'HttpApiSecurity', 'HttpMiddleware',
  'FetchHttpClient', 'NodeHttpClient', 'BunHttpClient',
  // Command (the Effect platform process command, not a service)
  'Command',
  // SQL utilities
  'SqlSchema', 'SqlResolver', 'SqlMigrator',
  // RPC utilities
  'Rpc', 'RpcRouter', 'RpcGroup', 'RpcApi', 'RpcSerialization',
  // Cluster / distributed
  'Entity', 'ClusterSchema', 'MessageState', 'Sharding',
  // Printer / docs
  'Printer', 'Doc', 'DocTree', 'PageWidth', 'Optimize',
  // AI
  'AiToolkit', 'Completions', 'AiInput', 'AiResponse',
  // OpenTelemetry
  'NodeSdk', 'WebSdk',
]);

export const isServiceTagCallee = (callee: string): boolean => {
  if (callee.includes('.')) return false;
  if (KNOWN_EFFECT_NAMESPACES.has(callee)) return false;
  return /^[A-Z][A-Za-z0-9]*$/.test(callee);
};

// =============================================================================
// Semantic description and alias-aware helpers
// =============================================================================

export const getSemanticDescription = (callee: string): string | undefined => {
  if (callee.startsWith('Channel.')) return 'channel';
  if (callee.startsWith('Sink.')) return 'sink';
  if (callee.endsWith('.never')) return 'never';
  if (callee.endsWith('.void')) return 'void-effect';
  if (callee.endsWith('.fromNullable')) return 'null-coalescing';
  if (callee.endsWith('.fn')) return 'function-lift';
  if (callee.endsWith('.fnUntraced')) return 'function-lift';
  if (
    callee.includes('.async') ||
    callee.includes('.asyncEffect') ||
    callee.includes('.promise') ||
    callee.includes('.sync') ||
    callee.includes('.suspend') ||
    callee.includes('.succeed') ||
    callee.includes('.fail') ||
    callee.includes('.try')
  ) return 'constructor';
  if (INTERRUPTION_PATTERNS.some((p) => callee.includes(p))) return 'interruption';
  if (DO_NOTATION_PATTERNS.some((p) => callee.includes(p))) return 'do-notation';
  if (CACHING_PATTERNS.some((p) => callee.includes(p) || callee.startsWith(p))) return 'caching';
  if (ERROR_HANDLER_PATTERNS.some((p) => callee.includes(p))) return 'error-handler';
  if (CONDITIONAL_PATTERNS.some((p) => callee.includes(p))) return 'conditional';
  if (RESOURCE_PATTERNS.some((p) => callee.includes(p))) return 'resource';
  if (COLLECTION_PATTERNS.some((p) => callee.includes(p))) return 'collection';
  if (FIBER_PATTERNS.some((p) => callee.includes(p))) return 'fiber';
  if (callee.startsWith('Stream.')) return 'stream';
  if (callee.startsWith('Layer.')) return 'layer';
  if (callee.startsWith('Schema.')) return 'schema';
  if (callee.startsWith('Config.')) return 'config';
  if (callee.startsWith('Cause.')) return 'cause';
  if (callee.startsWith('Exit.')) return 'exit';
  if (callee === 'Data.tagged' || callee === 'Data.taggedEnum') return 'tagged-enum';
  if (callee.startsWith('Data.')) return 'data';
  if (callee.startsWith('Option.')) return 'option';
  if (callee.startsWith('Either.')) return 'either';
  if (callee.startsWith('Match.')) return 'match';
  if (callee.startsWith('ManagedRuntime.')) return 'runtime';
  if (callee.startsWith('Runtime.')) return 'runtime';
  if (callee.startsWith('NodeRuntime.') || callee.startsWith('BunRuntime.') || callee.startsWith('DenoRuntime.')) return 'runtime';
  if (callee.startsWith('Scope.')) return 'scope';
  if (callee.startsWith('ScopedRef.') || callee.startsWith('RcRef.') || callee.startsWith('RcMap.')) return 'resource-ref';
  if (callee.startsWith('Reloadable.') || callee.startsWith('Resource.')) return 'reloadable';
  if (callee.startsWith('Micro.')) return 'micro';
  if (callee.startsWith('Brand.')) return 'brand';
  if (callee.startsWith('Encoding.')) return 'encoding';
  if (callee.startsWith('Predicate.')) return 'predicate';
  if (callee.startsWith('DateTime.')) return 'datetime';
  if (callee.startsWith('Cron.')) return 'cron';
  if (callee.startsWith('Redacted.')) return 'redacted';
  if (callee.startsWith('GlobalValue.')) return 'global-value';
  if (callee.startsWith('Supervisor.')) return 'supervisor';
  if (
    callee.includes('.locally') ||
    callee.includes('.locallyWith') ||
    callee.includes('.locallyScoped') ||
    callee.includes('.getFiberRefs') ||
    callee.includes('.setFiberRefs') ||
    callee.includes('.inheritFiberRefs') ||
    callee.includes('FiberRef.')
  ) return 'fiberref';
  if (
    callee.includes('.withConcurrency') ||
    callee.includes('.withScheduler') ||
    callee.includes('.withSchedulingPriority') ||
    callee.includes('.daemonChildren') ||
    callee.includes('.awaitAllChildren') ||
    callee.includes('.supervised')
  ) return 'structured-concurrency';
  if (
    callee.startsWith('Context.pick') ||
    callee.startsWith('Context.omit')
  ) return 'context';
  if (
    callee === 'Effect.provide' ||
    (callee.startsWith('Effect.') && callee.includes('.provide') && !callee.includes('provideService'))
  ) return 'context';
  if (
    callee.includes('.serviceOption') ||
    callee.includes('.serviceOptional') ||
    callee.includes('.serviceFunction') ||
    callee.includes('.serviceFunctionEffect') ||
    callee.includes('.serviceFunctions') ||
    callee.includes('.serviceConstants') ||
    callee.includes('.serviceMembers') ||
    callee.includes('.updateService')
  ) return 'service';
  if (
    callee.startsWith('CliApp.') ||
    callee.startsWith('Args.') ||
    callee.startsWith('Options.')
  ) return 'cli';
  if (
    callee.startsWith('AiModel.') ||
    callee.startsWith('AiToolkit.') ||
    callee.startsWith('Completions.') ||
    callee.startsWith('AiInput.') ||
    callee.startsWith('AiResponse.')
  ) return 'ai';
  if (
    callee.startsWith('NodeSdk.') ||
    callee.startsWith('WebSdk.') ||
    callee.startsWith('OtelMetrics.')
  ) return 'opentelemetry';
  if (
    callee.startsWith('Entity.') ||
    callee.startsWith('ClusterSchema.') ||
    callee.startsWith('MessageState.') ||
    callee.startsWith('Sharding.')
  ) return 'cluster';
  if (
    callee.startsWith('RpcGroup.') ||
    callee.startsWith('RpcApi.') ||
    callee.startsWith('RpcClient.') ||
    callee.startsWith('RpcRouter.')
  ) return 'rpc';
  if (
    callee.startsWith('SqlResolver.') ||
    callee.startsWith('SqlMigrator.')
  ) return 'sql';
  if (callee.startsWith('DevTools.') || callee.startsWith('Server.')) return 'devtools';
  if (callee.startsWith('BigDecimal.')) return 'big-decimal';
  if (callee.startsWith('Graph.')) return 'graph';
  if (callee.startsWith('HashRing.')) return 'hash-ring';
  if (callee.startsWith('Chunk.')) return 'chunk';
  if (callee.startsWith('HashMap.') || callee.startsWith('HashSet.')) return 'immutable-collection';
  if (
    callee.startsWith('List.') ||
    callee.startsWith('SortedMap.') ||
    callee.startsWith('SortedSet.') ||
    callee.startsWith('RedBlackTree.') ||
    callee.startsWith('Trie.')
  ) return 'immutable-collection';
  if (
    callee.includes('.map') ||
    callee.includes('.flatMap') ||
    callee.includes('.andThen') ||
    callee.includes('.tap') ||
    callee.includes('.tapBoth') ||
    callee.includes('.tapError') ||
    callee.includes('.tapErrorTag') ||
    callee.includes('.tapErrorCause') ||
    callee.includes('.tapDefect') ||
    callee.includes('.zip') ||
    callee.includes('.zipLeft') ||
    callee.includes('.zipRight') ||
    callee.includes('.zipWith') ||
    callee.includes('.as') ||
    callee.includes('.asVoid') ||
    callee.includes('.flatten') ||
    callee.includes('.merge') ||
    callee.includes('.ap') ||
    callee.includes('.validate') ||
    callee.includes('.negate')
  ) return 'transformation';
  if (
    callee.startsWith('Printer.') ||
    callee.startsWith('Doc.') ||
    callee.startsWith('DocTree.') ||
    callee.startsWith('PageWidth.') ||
    callee.startsWith('Optimize.')
  ) return 'printer';
  if (
    callee.startsWith('Http') ||
    callee.startsWith('FileSystem.') ||
    callee.startsWith('Command.') ||
    callee.startsWith('Socket.') ||
    callee.startsWith('Worker.')
  ) return 'platform';
  if (callee.includes('channel.') && !callee.includes('Channel')) return 'channel';
  return undefined;
};

export const getSemanticDescriptionWithAliases = (
  callee: string,
  effectAliases?: Set<string>,
): string | undefined => {
  const direct = getSemanticDescription(callee);
  if (direct) return direct;

  if (effectAliases) {
    const dotIndex = callee.indexOf('.');
    if (dotIndex > 0) {
      const prefix = callee.substring(0, dotIndex);
      if (effectAliases.has(prefix)) {
        const method = callee.substring(dotIndex + 1);
        return getSemanticDescription(`Effect.${method}`);
      }
    }
  }
  return undefined;
};

export const isLikelyDirectEffectInitializer = (
  initializer: Node,
  effectImportNames: Set<string>,
  nonProgramEffectImportNames: Set<string> = new Set(),
): boolean => {
  const { SyntaxKind } = loadTsMorph();
  const isNonProgramName = (name: string): boolean => nonProgramEffectImportNames.has(name);
  const isRunEntrypointCalleeText = (exprText: string): boolean =>
    /\.run(?:Promise(?:Exit)?|Sync(?:Exit)?|Fork|Callback|Main)$/.test(exprText) ||
    /^Runtime\.run(?:Promise|Sync|Fork)$/.test(exprText);
  const isDirectEffectCalleeText = (exprText: string): boolean => {
    if (isRunEntrypointCalleeText(exprText)) {
      return false;
    }
    const isPipeCall = exprText === 'pipe' || exprText.endsWith('.pipe');
    const dotIndex = exprText.indexOf('.');
    if (dotIndex > 0 && isNonProgramName(exprText.slice(0, dotIndex))) {
      return false;
    }
    return (
      isPipeCall ||
      [...effectImportNames].some((alias) => exprText.startsWith(`${alias}.`))
    );
  };

  const isLikelyEffectCall = (call: CallExpression): boolean => {
    const callee = call.getExpression();
    const exprText = callee.getText();
    if (isRunEntrypointCalleeText(exprText)) {
      return false;
    }
    const isPipeCall = exprText === 'pipe';
    const isMethodPipeCall =
      callee.getKind() === SyntaxKind.PropertyAccessExpression &&
      (callee as PropertyAccessExpression).getName() === 'pipe';
    if (isPipeCall || isMethodPipeCall) {
      const argsContainEffect = call.getArguments().some((arg) =>
        isLikelyDirectEffectInitializer(arg, effectImportNames, nonProgramEffectImportNames)
      );
      if (argsContainEffect) {
        return true;
      }
      if (isMethodPipeCall) {
        const base = (callee as PropertyAccessExpression).getExpression();
        return isLikelyDirectEffectInitializer(
          base,
          effectImportNames,
          nonProgramEffectImportNames,
        );
      }
      return false;
    }
    if (
      callee.getKind() === SyntaxKind.Identifier &&
      effectImportNames.has(exprText) &&
      !isNonProgramName(exprText)
    ) {
      return true;
    }
    if (isDirectEffectCalleeText(exprText)) {
      return true;
    }

    // Builder / wrapper chains: inspect call receiver and arguments for effectful callbacks,
    // e.g. make(() => Effect.never).identified("Never")
    if (
      callee.getKind() === SyntaxKind.PropertyAccessExpression &&
      isLikelyDirectEffectInitializer(
        (callee as PropertyAccessExpression).getExpression(),
        effectImportNames,
        nonProgramEffectImportNames,
      )
    ) {
      return true;
    }

    return call.getArguments().some((arg) =>
      isLikelyDirectEffectInitializer(arg, effectImportNames, nonProgramEffectImportNames)
    );
  };

  /** True when `node` is NOT inside a nested function/arrow/method relative to `scope`. */
  const isInSameScope = (node: Node, scope: Node): boolean => {
    let current = node.getParent();
    while (current && current !== scope) {
      const k = current.getKind();
      if (
        k === SyntaxKind.FunctionDeclaration ||
        k === SyntaxKind.FunctionExpression ||
        k === SyntaxKind.ArrowFunction ||
        k === SyntaxKind.MethodDeclaration ||
        k === SyntaxKind.GetAccessor ||
        k === SyntaxKind.SetAccessor ||
        k === SyntaxKind.ClassDeclaration ||
        k === SyntaxKind.ClassExpression ||
        k === SyntaxKind.Constructor ||
        k === SyntaxKind.ClassStaticBlockDeclaration
      ) {
        return false;
      }
      current = current.getParent();
    }
    return true;
  };

  const blockContainsEffectLikeUsage = (block: import('ts-morph').Block): boolean => {
    const callExprs = block.getDescendantsOfKind(SyntaxKind.CallExpression);
    if (callExprs.some((call) => isInSameScope(call, block) && isLikelyEffectCall(call))) {
      return true;
    }

    const awaitedExprs = block.getDescendantsOfKind(SyntaxKind.AwaitExpression);
    if (
      awaitedExprs.some((awaitExpr) =>
        isInSameScope(awaitExpr, block) &&
        isLikelyDirectEffectInitializer(awaitExpr, effectImportNames, nonProgramEffectImportNames)
      )
    ) {
      return true;
    }

    const propertyAccessExprs = block.getDescendantsOfKind(
      SyntaxKind.PropertyAccessExpression,
    );
    return propertyAccessExprs.some((expr) =>
      isInSameScope(expr, block) &&
      isLikelyDirectEffectInitializer(expr, effectImportNames, nonProgramEffectImportNames)
    );
  };

  const blockContainsRunEntrypointUsage = (block: import('ts-morph').Block): boolean =>
    block
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((call) => isInSameScope(call, block) && isRunEntrypointCalleeText((call).getExpression().getText()));

  if (initializer.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = initializer as ObjectLiteralExpression;
    return obj.getProperties().some((prop) => {
      if (
        prop.getKind() === SyntaxKind.PropertyAssignment ||
        prop.getKind() === SyntaxKind.ShorthandPropertyAssignment
      ) {
        const init =
          prop.getKind() === SyntaxKind.PropertyAssignment
            ? (prop as PropertyAssignment).getInitializer()
            : undefined;
        return init
          ? isLikelyDirectEffectInitializer(init, effectImportNames, nonProgramEffectImportNames)
          : false;
      }
      if (
        prop.getKind() === SyntaxKind.MethodDeclaration ||
        prop.getKind() === SyntaxKind.GetAccessor ||
        prop.getKind() === SyntaxKind.SetAccessor
      ) {
        const body = (
          prop as
            | import('ts-morph').MethodDeclaration
            | import('ts-morph').GetAccessorDeclaration
            | import('ts-morph').SetAccessorDeclaration
        ).getBody();
        return body
          ? blockContainsEffectLikeUsage(body as Block)
          : false;
      }
      return false;
    });
  }

  if (
    initializer.getKind() === SyntaxKind.ArrowFunction ||
    initializer.getKind() === SyntaxKind.FunctionExpression
  ) {
    const fn = initializer as ArrowFunction | FunctionExpression;
    const body = fn.getBody();

    if (body.getKind() === SyntaxKind.Block) {
      const bodyBlock = body as Block;
      // Check return statements in the current function scope (if/else/switch branches)
      // but NOT those inside nested functions/callbacks.
      const returnStmts = bodyBlock.getDescendantsOfKind(SyntaxKind.ReturnStatement);
      const hasEffectReturn = returnStmts.some((ret) => {
        if (!isInSameScope(ret, bodyBlock)) return false;
        const expr = ret.getExpression();
        return expr !== undefined && isLikelyDirectEffectInitializer(
          expr,
          effectImportNames,
          nonProgramEffectImportNames,
        );
      });
      if (hasEffectReturn) {
        return true;
      }
      // Only fall back to body heuristic if no run* entrypoint is present —
      // a function that merely executes an Effect (runSync/runPromise/…)
      // without returning one is not itself an Effect program.
      if (blockContainsRunEntrypointUsage(bodyBlock)) {
        return false;
      }
      return blockContainsEffectLikeUsage(bodyBlock);
    }

    return isLikelyDirectEffectInitializer(body, effectImportNames, nonProgramEffectImportNames);
  }

  if (initializer.getKind() === SyntaxKind.CallExpression) {
    return isLikelyEffectCall(initializer as CallExpression);
  }

  if (initializer.getKind() === SyntaxKind.AwaitExpression) {
    const awaited = (
      initializer as AwaitExpression
    ).getExpression();
    if (awaited.getKind() !== SyntaxKind.CallExpression) {
      return false;
    }
    return isLikelyEffectCall(awaited as CallExpression);
  }

  if (initializer.getKind() === SyntaxKind.ConditionalExpression) {
    const conditional = initializer as ConditionalExpression;
    return (
      isLikelyDirectEffectInitializer(
        conditional.getWhenTrue(),
        effectImportNames,
        nonProgramEffectImportNames,
      ) ||
      isLikelyDirectEffectInitializer(
        conditional.getWhenFalse(),
        effectImportNames,
        nonProgramEffectImportNames,
      )
    );
  }

  if (initializer.getKind() === SyntaxKind.PropertyAccessExpression) {
    const text = initializer.getText();
    const dotIndex = text.indexOf('.');
    if (dotIndex > 0 && isNonProgramName(text.slice(0, dotIndex))) {
      return false;
    }
    return [...effectImportNames].some((alias) => text.startsWith(`${alias}.`));
  }

  return false;
};

export function isEffectPackageSpecifier(specifier: string): boolean {
  return (
    specifier === 'effect' ||
    specifier.startsWith('effect/') ||
    specifier.startsWith('@effect/')
  );
}

export const EFFECT_NAMESPACE_NAMES = new Set([
  'Effect', 'Layer', 'Schedule', 'Stream', 'Queue', 'PubSub', 'Deferred',
  'Semaphore', 'Mailbox', 'SubscriptionRef', 'Scope', 'Fiber', 'Runtime', 'ManagedRuntime',
  'Cause', 'Exit', 'Data', 'Option', 'Either', 'Chunk', 'HashMap', 'HashSet',
  'Match', 'Config', 'Schema', 'Cache', 'ScopedCache', 'Metric', 'Logger',
  'Tracer', 'Context', 'Brand', 'Encoding', 'Predicate', 'DateTime', 'Cron',
  'BigDecimal', 'Graph', 'HashRing', 'Redacted', 'GlobalValue',
  'NodeRuntime', 'BunRuntime', 'DenoRuntime', 'Channel', 'Sink',
]);

export const KNOWN_INTERNAL_MODULES = new Set([
  'core', 'core-effect', 'core-stream', 'fiberRuntime', 'effectable', 'channel', 'sink', 'layer', 'schedule', 'mailbox', 'pubsub',
]);

// =============================================================================
// Numeric literal and Context type parsing
// =============================================================================

export function parseServiceIdsFromContextType(requiredType: string): string[] {
  const skip = new Set(['never', 'unknown', 'any', '{}', 'object']);
  const normalized = requiredType.trim();
  if (!normalized || skip.has(normalized)) return [];
  const parts = normalized.split(/[\s|&]+/).map((s) => s.trim().split('<')[0]?.trim() ?? '');
  return parts.filter((s) => s.length > 0 && !skip.has(s));
}

export function getNumericLiteralFromNode(node: Node): number | undefined {
  const { SyntaxKind } = loadTsMorph();
  const kind = node.getKind();
  if (kind === SyntaxKind.NumericLiteral) {
    const text = node.getText();
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  if (kind === SyntaxKind.PrefixUnaryExpression) {
    const unary = node as PrefixUnaryExpression;
    if (unary.getOperatorToken() === SyntaxKind.MinusToken) {
      const operand = unary.getOperand();
      const v = getNumericLiteralFromNode(operand);
      return v !== undefined ? -v : undefined;
    }
  }
  return undefined;
}
