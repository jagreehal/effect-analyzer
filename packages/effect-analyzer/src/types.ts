/**
 * Static Effect Analysis - Type Definitions
 *
 * These types represent Effect code structure extracted through static analysis
 * (AST walking) rather than runtime execution.
 */

import { Effect, Option } from 'effect';

// =============================================================================
// Static Node Types
// =============================================================================

/**
 * Source code location for tracing back to original code.
 */
export interface SourceLocation {
  /** Absolute file path */
  readonly filePath: string;
  /** Line number (1-indexed) */
  readonly line: number;
  /** Column number (0-indexed) */
  readonly column: number;
  /** End line number */
  readonly endLine?: number | undefined;
  /** End column number */
  readonly endColumn?: number | undefined;
}

/**
 * Semantic role classification for display and styling.
 */
export type SemanticRole =
  | 'constructor'
  | 'service-call'
  | 'environment'
  | 'side-effect'
  | 'transform'
  | 'error-handler'
  | 'concurrency'
  | 'resource'
  | 'control-flow'
  | 'scheduling'
  | 'stream'
  | 'layer'
  | 'fiber'
  | 'unknown';

/**
 * Structured JSDoc tag data extracted from comments.
 */
export interface JSDocTags {
  readonly params: readonly { readonly name: string; readonly description?: string }[];
  readonly returns?: string | undefined;
  readonly throws: readonly string[];
  readonly example?: string | undefined;
}

/**
 * Detail level for Mermaid diagram labels.
 */
export type MermaidDetailLevel = 'compact' | 'standard' | 'verbose';

/**
 * Base properties shared by all static analysis nodes.
 */
export interface StaticBaseNode {
  /** Unique identifier for this node */
  readonly id: string;
  /** Human-readable name */
  readonly name?: string | undefined;
  /** Source location */
  readonly location?: SourceLocation | undefined;
  /** Pre-computed human-readable display label (e.g. "user <- UserRepo.getById") */
  readonly displayName?: string | undefined;
  /** Semantic role classification for styling and filtering */
  readonly semanticRole?: SemanticRole | undefined;
}

/**
 * A single Effect operation (yield* or direct call).
 */
export interface StaticEffectNode extends StaticBaseNode {
  readonly type: 'effect';
  /** The Effect being created (e.g., "Effect.succeed", "Effect.sync") */
  readonly callee: string;
  /** Description of what this effect does */
  readonly description?: string | undefined;
  /** JSDoc description extracted from comments above the effect */
  readonly jsdocDescription?: string | undefined;
  /** Structured JSDoc tags extracted from comments */
  readonly jsdocTags?: JSDocTags | undefined;
  /** Error type if statically determinable */
  readonly errorType?: string | undefined;
  /** Full type signature (A, E, R) - requires type extraction */
  readonly typeSignature?: EffectTypeSignature | undefined;
  /** Services required by this specific effect */
  readonly requiredServices?: ServiceRequirement[] | undefined;
  /** If this effect is a method call on a typed service object */
  readonly serviceCall?: {
    /** Resolved type name of the service object (e.g. 'UserRepo') */
    readonly serviceType: string;
    /** Method name being called (e.g. 'getById') */
    readonly methodName: string;
    /** Variable/expression name used at call site (e.g. 'repo') */
    readonly objectName: string;
  } | undefined;
  /** Resolved service method when call is e.g. yield* db.query() and db is bound to a service tag */
  readonly serviceMethod?: { readonly serviceId: string; readonly methodName: string } | undefined;
  /** Inner effects from Effect.sync/promise/async callback body (one level only) */
  readonly callbackBody?: readonly StaticFlowNode[] | undefined;
  /** Effect.async/asyncEffect only: resume/canceller callback patterns (GAP async callback interop). */
  readonly asyncCallback?: {
    readonly resumeParamName: string;
    readonly resumeCallCount: number;
    readonly returnsCanceller: boolean;
  } | undefined;
  /** Effect.provide only: whether context is provided via Layer, Context, or Runtime. */
  readonly provideKind?: 'layer' | 'context' | 'runtime' | undefined;
  /** Constructor subtype classification */
  readonly constructorKind?: 'sync' | 'promise' | 'async' | 'never' | 'void' | 'fromNullable' | 'fn' | 'fnUntraced' | undefined;
  /** FiberRef built-in name (e.g. currentLogLevel, currentConcurrency) */
  readonly fiberRefName?: string | undefined;
  /** Effect.fn traced name */
  readonly tracedName?: string | undefined;
}

/**
 * Generator-based effect block (Effect.gen).
 */
export interface StaticGeneratorNode extends StaticBaseNode {
  readonly type: 'generator';
  /** Variables yielded in the generator */
  readonly yields: {
    readonly variableName?: string | undefined;
    readonly effect: StaticFlowNode;
  }[];
  /** Final return value */
  readonly returnNode?: StaticFlowNode | undefined;
  /** JSDoc description extracted from comments above the generator function */
  readonly jsdocDescription?: string | undefined;
  /** Structured JSDoc tags extracted from comments */
  readonly jsdocTags?: JSDocTags | undefined;
}

/**
 * Pipe composition chain (effect.pipe(...)).
 */
export interface StaticPipeNode extends StaticBaseNode {
  readonly type: 'pipe';
  /** The initial effect */
  readonly initial: StaticFlowNode;
  /** Pipe transformations in order */
  readonly transformations: readonly StaticFlowNode[];
  /** Type flow through the pipe chain (A, E, R at each step) */
  readonly typeFlow?: readonly EffectTypeSignature[] | undefined;
}

/**
 * Concurrency mode for Effect.all / Effect.allWith.
 */
export type ConcurrencyMode = 'sequential' | 'bounded' | 'unbounded' | number;

/**
 * Parallel execution (Effect.all, Effect.allPar).
 */
export interface StaticParallelNode extends StaticBaseNode {
  readonly type: 'parallel';
  /** Child effects running in parallel */
  readonly children: readonly StaticFlowNode[];
  /** Mode: sequential (all) or parallel (allPar) */
  readonly mode: 'sequential' | 'parallel';
  /** The callee (e.g., "Effect.all", "Effect.allPar") */
  readonly callee: string;
  /** Resolved concurrency: from options or inferred from mode (GAP 18) */
  readonly concurrency?: ConcurrencyMode | undefined;
  /** Request batching enabled (Effect.all with { batching: true }) */
  readonly batching?: boolean | undefined;
  /** Results discarded (Effect.all with { discard: true }) */
  readonly discard?: boolean | undefined;
  /** Labels for each parallel branch (from child displayNames) */
  readonly branchLabels?: readonly string[] | undefined;
}

/**
 * Race execution (Effect.race, Effect.raceAll).
 */
export interface StaticRaceNode extends StaticBaseNode {
  readonly type: 'race';
  /** Child effects racing */
  readonly children: readonly StaticFlowNode[];
  /** The callee */
  readonly callee: string;
  /** Labels for each race competitor */
  readonly raceLabels?: readonly string[] | undefined;
}

/**
 * Error handling (catchAll, catchTag, orElse, etc.).
 */
export interface StaticErrorHandlerNode extends StaticBaseNode {
  readonly type: 'error-handler';
  /** Type of handler: catchAll, catchTag, orElse, etc. */
  readonly handlerType:
    | 'catchAll'
    | 'catchTag'
    | 'catchAllCause'
    | 'catchIf'
    | 'catchSome'
    | 'catchSomeCause'
    | 'catchSomeDefect'
    | 'catchAllDefect'
    | 'catchTags'
    | 'orElse'
    | 'orElseFail'
    | 'orElseSucceed'
    | 'orDie'
    | 'orDieWith'
    | 'flip'
    | 'mapError'
    | 'mapErrorCause'
    | 'mapBoth'
    | 'sandbox'
    | 'unsandbox'
    | 'parallelErrors'
    | 'filterOrDie'
    | 'filterOrDieMessage'
    | 'filterOrElse'
    | 'filterOrFail'
    | 'match'
    | 'matchCause'
    | 'matchEffect'
    | 'matchCauseEffect'
    | 'firstSuccessOf'
    | 'ignore'
    | 'ignoreLogged'
    | 'eventually';
  /** The effect being handled */
  readonly source: StaticFlowNode;
  /** The handler (recovery) effect */
  readonly handler?: StaticFlowNode | undefined;
  /** For catchTag, the error tag being caught */
  readonly errorTag?: string | undefined;
  /** For catchTags (object form), the error tags being caught */
  readonly errorTags?: readonly string[] | undefined;
  /** Edge label for the error path (e.g. "on DatabaseError") */
  readonly errorEdgeLabel?: string | undefined;
}

/**
 * Schedule composition info (GAP 8).
 */
export interface ScheduleInfo {
  readonly baseStrategy:
    | 'fixed'
    | 'exponential'
    | 'fibonacci'
    | 'spaced'
    | 'linear'
    | 'cron'
    | 'windowed'
    | 'duration'
    | 'elapsed'
    | 'delays'
    | 'once'
    | 'stop'
    | 'count'
    | 'custom';
  readonly maxRetries?: number | 'unlimited' | undefined;
  readonly initialDelay?: string | undefined;
  readonly maxDelay?: string | undefined;
  readonly jittered: boolean;
  readonly conditions: readonly string[];
  readonly estimatedMaxDuration?: string | undefined;
}

/**
 * Retry/Schedule operation.
 */
export interface StaticRetryNode extends StaticBaseNode {
  readonly type: 'retry';
  /** The effect being retried */
  readonly source: StaticFlowNode;
  /** Schedule policy if statically determinable (expression text) */
  readonly schedule?: string | undefined;
  /** Parsed schedule when present (GAP 8 dedicated Schedule IR) */
  readonly scheduleNode?: StaticFlowNode | undefined;
  /** Whether it's a retryOrElse */
  readonly hasFallback: boolean;
  /** Decomposed schedule (GAP 8) */
  readonly scheduleInfo?: ScheduleInfo | undefined;
  /** Edge label for the retry path (e.g. "retry: exponential(100ms)") */
  readonly retryEdgeLabel?: string | undefined;
}

/**
 * Timeout operation.
 */
export interface StaticTimeoutNode extends StaticBaseNode {
  readonly type: 'timeout';
  /** The effect being timed out */
  readonly source: StaticFlowNode;
  /** Timeout duration if statically determinable */
  readonly duration?: string | undefined;
  /** Whether there's a fallback */
  readonly hasFallback: boolean;
}

/**
 * Resource acquisition (acquireRelease).
 */
export interface StaticResourceNode extends StaticBaseNode {
  readonly type: 'resource';
  /** Acquisition effect */
  readonly acquire: StaticFlowNode;
  /** Release effect */
  readonly release: StaticFlowNode;
  /** Use effect */
  readonly use?: StaticFlowNode | undefined;
}

/**
 * Conditional execution (Effect.if, when, unless).
 */
export interface StaticConditionalNode extends StaticBaseNode {
  readonly type: 'conditional';
  /** The condition as source string */
  readonly condition: string;
  /** Type of conditional */
  readonly conditionalType:
    | 'if'
    | 'when'
    | 'unless'
    | 'whenEffect'
    | 'whenFiberRef'
    | 'whenRef'
    | 'unlessEffect'
    | 'option'
    | 'either'
    | 'exit'
    | 'liftPredicate';
  /** Branch when condition is true */
  readonly onTrue: StaticFlowNode;
  /** Branch when condition is false (if present) */
  readonly onFalse?: StaticFlowNode | undefined;
  /** Semantic label for the condition (e.g. "isAdmin") */
  readonly conditionLabel?: string | undefined;
  /** Label for the true branch edge */
  readonly trueEdgeLabel?: string | undefined;
  /** Label for the false branch edge */
  readonly falseEdgeLabel?: string | undefined;
}

/**
 * Decision node for raw `if`, ternaries, short-circuits, and `Step.decide`.
 */
export interface StaticDecisionNode extends StaticBaseNode {
  readonly type: 'decision';
  /** Unique decision identifier */
  readonly decisionId: string;
  /** Human-readable label for the decision */
  readonly label: string;
  /** Condition expression source text */
  readonly condition: string;
  /** Origin of the decision construct */
  readonly source: 'effect-flow' | 'raw-if' | 'raw-ternary' | 'raw-short-circuit';
  /** Branch when condition is true */
  readonly onTrue: readonly StaticFlowNode[];
  /** Branch when condition is false (if present) */
  readonly onFalse?: readonly StaticFlowNode[] | undefined;
}

/**
 * A single case arm in a switch node.
 */
export interface StaticSwitchCase {
  /** Labels for this case (e.g. string/number literals) */
  readonly labels: readonly string[];
  /** Whether this is the default case */
  readonly isDefault: boolean;
  /** Body nodes for this case */
  readonly body: readonly StaticFlowNode[];
}

/**
 * Switch node for raw `switch` statements and `Step.branch`.
 */
export interface StaticSwitchNode extends StaticBaseNode {
  readonly type: 'switch';
  /** Optional switch identifier */
  readonly switchId?: string | undefined;
  /** Expression being switched on */
  readonly expression: string;
  /** Case arms */
  readonly cases: readonly StaticSwitchCase[];
  /** Origin of the switch construct */
  readonly source: 'effect-flow' | 'raw-js';
  /** Whether a default case is present */
  readonly hasDefault: boolean;
  /** Whether any case falls through to the next */
  readonly hasFallthrough: boolean;
}

/**
 * Try/catch/finally node for raw exception handling.
 */
export interface StaticTryCatchNode extends StaticBaseNode {
  readonly type: 'try-catch';
  /** Body of the try block */
  readonly tryBody: readonly StaticFlowNode[];
  /** Catch clause variable name */
  readonly catchVariable?: string | undefined;
  /** Body of the catch block */
  readonly catchBody?: readonly StaticFlowNode[] | undefined;
  /** Body of the finally block */
  readonly finallyBody?: readonly StaticFlowNode[] | undefined;
  /** Whether the try body contains a terminal statement (return/throw) */
  readonly hasTerminalInTry: boolean;
}

/**
 * Terminal node for `return`, `throw`, `break`, and `continue` statements.
 */
export interface StaticTerminalNode extends StaticBaseNode {
  readonly type: 'terminal';
  /** Kind of terminal statement */
  readonly terminalKind: 'return' | 'throw' | 'break' | 'continue';
  /** Label for labeled break/continue */
  readonly label?: string | undefined;
  /** Value expression (e.g. the returned/thrown value) */
  readonly value?: readonly StaticFlowNode[] | undefined;
}

/**
 * Opaque node for unsupported or unanalyzable constructs.
 */
export interface StaticOpaqueNode extends StaticBaseNode {
  readonly type: 'opaque';
  /** Reason why this construct could not be analyzed */
  readonly reason: string;
  /** Original source text of the construct */
  readonly sourceText: string;
}

/**
 * Cause module operation — construction or inspection of Effect Cause values.
 */
export interface StaticCauseNode extends StaticBaseNode {
  readonly type: 'cause';
  /** The specific Cause operation */
  readonly causeOp:
    | 'fail'
    | 'die'
    | 'interrupt'
    | 'parallel'
    | 'sequential'
    | 'empty'
    | 'failures'
    | 'defects'
    | 'interruptors'
    | 'squash'
    | 'squashWith'
    | 'pretty'
    | 'flatten'
    | 'isDie'
    | 'isFailure'
    | 'isInterrupted'
    | 'isEmpty'
    | 'map'
    | 'filter'
    | 'other';
  /** Whether this is a constructor (fail/die/interrupt/parallel/sequential/empty) */
  readonly isConstructor: boolean;
  /** For parallel/sequential: child cause nodes (GAP Cause structural traversal). */
  readonly children?: readonly StaticFlowNode[] | undefined;
  /** Cause kind classification */
  readonly causeKind?: 'fail' | 'die' | 'interrupt' | 'mixed' | undefined;
}

/**
 * Exit module operation — construction or inspection of Effect Exit values.
 */
export interface StaticExitNode extends StaticBaseNode {
  readonly type: 'exit';
  /** The specific Exit operation */
  readonly exitOp:
    | 'succeed'
    | 'fail'
    | 'die'
    | 'interrupt'
    | 'void'
    | 'unit'
    | 'match'
    | 'isSuccess'
    | 'isFailure'
    | 'isInterrupted'
    | 'when'
    | 'whenEffect'
    | 'exists'
    | 'contains'
    | 'flatten'
    | 'map'
    | 'mapBoth'
    | 'mapError'
    | 'flatMap'
    | 'zipWith'
    | 'tap'
    | 'tapBoth'
    | 'tapError'
    | 'other';
  /** Whether this is a constructor (succeed/fail/die/interrupt/void/unit) */
  readonly isConstructor: boolean;
}

/**
 * Schedule module operation — construction or composition of Schedule values (GAP 8 dedicated IR).
 */
export interface StaticScheduleNode extends StaticBaseNode {
  readonly type: 'schedule';
  /** The specific Schedule operation */
  readonly scheduleOp:
    | 'exponential'
    | 'fibonacci'
    | 'spaced'
    | 'fixed'
    | 'linear'
    | 'cron'
    | 'windowed'
    | 'duration'
    | 'elapsed'
    | 'delays'
    | 'once'
    | 'stop'
    | 'count'
    | 'forever'
    | 'jittered'
    | 'andThen'
    | 'intersect'
    | 'union'
    | 'compose'
    | 'zipWith'
    | 'addDelay'
    | 'modifyDelay'
    | 'check'
    | 'resetAfter'
    | 'resetWhen'
    | 'ensure'
    | 'driver'
    | 'mapInput'
    | 'other';
  /** Decomposed schedule (when parseable from expression text) */
  readonly scheduleInfo?: ScheduleInfo | undefined;
}

/**
 * Match module operation (Match.type / Match.when / Match.exhaustive etc.).
 */
export interface StaticMatchNode extends StaticBaseNode {
  readonly type: 'match';
  /** The specific Match operation */
  readonly matchOp:
    | 'type'
    | 'tag'
    | 'value'
    | 'when'
    | 'whenOr'
    | 'whenAnd'
    | 'not'
    | 'is'
    | 'exhaustive'
    | 'orElse'
    | 'option'
    | 'either'
    | 'discriminator'
    | 'discriminatorsExhaustive'
    | 'tags'
    | 'tagsExhaustive'
    | 'withReturnType'
    | 'run'
    | 'other';
  /** Tag names matched (for Match.tag, Match.when with tag literals, Match.tags) */
  readonly matchedTags?: readonly string[] | undefined;
  /** Whether this match arm makes the overall match exhaustive */
  readonly isExhaustive: boolean;
}

/**
 * Transformation step in a pipe chain (map, flatMap, andThen, tap, zip, as, etc.).
 * These preserve the Effect channel but transform A, E, or R.
 */
export interface StaticTransformNode extends StaticBaseNode {
  readonly type: 'transform';
  /** Specific transformation operation */
  readonly transformType:
    | 'map'
    | 'flatMap'
    | 'andThen'
    | 'tap'
    | 'tapBoth'
    | 'tapError'
    | 'tapErrorTag'
    | 'tapErrorCause'
    | 'tapDefect'
    | 'zipLeft'
    | 'zipRight'
    | 'zipWith'
    | 'zip'
    | 'as'
    | 'asVoid'
    | 'asSome'
    | 'asSomeError'
    | 'flatten'
    | 'ap'
    | 'negate'
    | 'merge'
    | 'other';
  /**
   * Whether this is an effectful transformation
   * (e.g. flatMap/andThen produce a new Effect, map does not).
   */
  readonly isEffectful: boolean;
  /** The source/input effect (if extractable from args, undefined for curried forms). */
  readonly source?: StaticFlowNode | undefined;
  /** The transformation function text (if simple enough to extract). */
  readonly fn?: string | undefined;
  /** Input type signature (before transform) */
  readonly inputType?: EffectTypeSignature | undefined;
  /** Output type signature (after transform) */
  readonly outputType?: EffectTypeSignature | undefined;
}

/**
 * Loop structure (forEach, loop).
 */
export interface StaticLoopNode extends StaticBaseNode {
  readonly type: 'loop';
  /** Type of loop / collection operation */
  readonly loopType:
    | 'forEach'
    | 'filter'
    | 'filterMap'
    | 'partition'
    | 'reduce'
    | 'validate'
    | 'replicate'
    | 'dropUntil'
    | 'dropWhile'
    | 'takeUntil'
    | 'takeWhile'
    | 'every'
    | 'exists'
    | 'findFirst'
    | 'head'
    | 'mergeAll'
    | 'loop'
    | 'for'
    | 'forOf'
    | 'forIn'
    | 'while'
    | 'doWhile';
  /** The iteration source */
  readonly iterSource?: string | undefined;
  /** Body of the loop */
  readonly body: StaticFlowNode;
  /** Whether the loop contains an early exit (break/return) */
  readonly hasEarlyExit?: boolean | undefined;
  /** Yield expressions in the loop header (e.g. for-of with yield* in initializer) */
  readonly headerYields?: readonly StaticFlowNode[] | undefined;
  /** Iteration variable name (for for-of/for-in loops) */
  readonly iterVariable?: string | undefined;
}

/**
 * Layer lifecycle (GAP 2).
 */
export type LayerLifecycle = 'default' | 'fresh' | 'scoped' | 'memoized';

/**
 * Layer/service provision.
 */
export interface StaticLayerNode extends StaticBaseNode {
  readonly type: 'layer';
  /** Layer operations */
  readonly operations: readonly StaticFlowNode[];
  /** Whether this is a merged layer */
  readonly isMerged: boolean;
  /** Service tags this layer provides (GAP 2) */
  readonly provides?: readonly string[] | undefined;
  /** Service tags this layer requires (GAP 2) */
  readonly requires?: readonly string[] | undefined;
  /** Lifecycle (GAP 2) */
  readonly lifecycle?: LayerLifecycle | undefined;
  /** True when this layer is or contains Layer.MemoMap (GAP dedicated memo-map analysis). */
  readonly isMemoMap?: boolean | undefined;
}

/**
 * Stream operator in a pipeline (GAP 5).
 */
export interface StreamOperatorInfo {
  readonly operation: string;
  readonly isEffectful: boolean;
  readonly estimatedCardinality?: 'same' | 'fewer' | 'more' | 'unknown' | undefined;
  readonly category?:
    | 'constructor'
    | 'transform'
    | 'filter'
    | 'windowing'
    | 'merge'
    | 'broadcasting'
    | 'halting'
    | 'text'
    | 'backpressure'
    | 'error'
    | 'resource'
    | 'context'
    | 'sink'
    | 'conversion'
    | 'channel'
    | 'other'
    | undefined;
  /** Windowing: size for grouped/groupedWithin/sliding (GAP 2 windowing detail). */
  readonly windowSize?: number | undefined;
  /** Windowing: stride/step for sliding (GAP 2 windowing detail). */
  readonly stride?: number | undefined;
}

/**
 * Stream pipeline (GAP 5).
 */
export interface StaticStreamNode extends StaticBaseNode {
  readonly type: 'stream';
  readonly source: StaticFlowNode;
  readonly pipeline: readonly StreamOperatorInfo[];
  readonly sink?: string | undefined;
  readonly backpressureStrategy?: 'buffer' | 'drop' | 'sliding' | undefined;
  /** Classified constructor type when this is a Stream.from* / Stream.make / etc. */
  readonly constructorType?:
    | 'fromIterable'
    | 'fromArray'
    | 'fromQueue'
    | 'fromPubSub'
    | 'fromEffect'
    | 'fromAsyncIterable'
    | 'fromReadableStream'
    | 'fromEventListener'
    | 'fromSchedule'
    | 'range'
    | 'tick'
    | 'iterate'
    | 'unfold'
    | 'make'
    | 'empty'
    | 'never'
    | 'succeed'
    | 'fail'
    | 'fromMailbox'
    | 'fromSubscriptionRef'
    | 'other'
    | undefined;
}

/**
 * Concurrency primitive (Queue, PubSub, Deferred, Semaphore, Mailbox, Latch, FiberSet, FiberMap, FiberHandle, RateLimiter, SubscriptionRef) - GAP 6.
 */
export interface StaticConcurrencyPrimitiveNode extends StaticBaseNode {
  readonly type: 'concurrency-primitive';
  readonly primitive:
    | 'queue'
    | 'pubsub'
    | 'deferred'
    | 'semaphore'
    | 'mailbox'
    | 'latch'
    | 'fiberHandle'
    | 'fiberSet'
    | 'fiberMap'
    | 'rateLimiter'
    | 'cache'
    | 'scopedCache'
    | 'rcRef'
    | 'rcMap'
    | 'reloadable'
    | 'subscriptionRef';
  readonly operation:
    | 'create'
    | 'offer'
    | 'take'
    | 'takeAll'
    | 'publish'
    | 'subscribe'
    | 'await'
    | 'succeed'
    | 'fail'
    | 'withPermit'
    | 'run'
    | 'open'
    | 'close'
    | 'release'
    | 'available'
    | 'get'
    | 'set'
    | 'invalidate'
    | 'contains'
    | 'update'
    | 'reload'
    | 'end'
    | 'toStream'
    | 'changes';
  readonly strategy?: 'bounded' | 'unbounded' | 'sliding' | 'dropping' | undefined;
  readonly capacity?: number | undefined;
  /** For Semaphore take(n) / release(n): permit count when first arg is numeric literal (GAP 13). */
  readonly permitCount?: number | undefined;
  readonly source?: StaticFlowNode | undefined;
  /** Lifecycle options (e.g. FiberHandle.run { onlyIfMissing: true }) */
  readonly lifecycleOptions?: Record<string, unknown> | undefined;
}

/**
 * Fiber operation (fork, join, interrupt) - GAP 1.
 */
export interface StaticFiberNode extends StaticBaseNode {
  readonly type: 'fiber';
  readonly operation:
    | 'fork'
    | 'forkScoped'
    | 'forkDaemon'
    | 'forkAll'
    | 'forkIn'
    | 'forkWithErrorHandler'
    | 'join'
    | 'await'
    | 'interrupt'
    | 'interruptFork'
    | 'poll'
    | 'status'
    | 'all'
    | 'awaitAll'
    | 'children'
    | 'dump'
    | 'scoped'
    | 'inheritAll'
    | 'map'
    | 'mapEffect'
    | 'mapFiber'
    | 'roots'
    | 'getCurrentFiber';
  readonly fiberSource?: StaticFlowNode | undefined;
  readonly joinPoint?: string | undefined;
  readonly isScoped: boolean;
  readonly isDaemon: boolean;
  /** Scope context: 'safe' when fiber is inside Effect.scoped or after Scope.make */
  readonly scopeContext?: string | undefined;
}

/**
 * Interruption region (interruptible/uninterruptible/mask/onInterrupt).
 */
export interface StaticInterruptionNode extends StaticBaseNode {
  readonly type: 'interruption';
  /** The interruption operation */
  readonly interruptionType:
    | 'interrupt'
    | 'interruptWith'
    | 'interruptible'
    | 'uninterruptible'
    | 'interruptibleMask'
    | 'uninterruptibleMask'
    | 'onInterrupt'
    | 'disconnect'
    | 'allowInterrupt';
  /** The wrapped effect (for interruptible/uninterruptible/mask) */
  readonly source?: StaticFlowNode | undefined;
  /** The interrupt handler (for onInterrupt) */
  readonly handler?: StaticFlowNode | undefined;
}

/**
 * Unknown or unanalyzable code block.
 */
export interface StaticUnknownNode extends StaticBaseNode {
  readonly type: 'unknown';
  /** Reason why this couldn't be analyzed */
  readonly reason: string;
  /** The source code that couldn't be analyzed */
  readonly sourceCode?: string | undefined;
}

/** Channel operator or constructor (improve.md §8). */
export interface ChannelOperatorInfo {
  readonly operation: string;
  readonly category?: 'constructor' | 'transform' | 'pipe' | 'other' | undefined;
}

/**
 * Channel pipeline node (improve.md §8 dedicated Channel analysis).
 */
export interface StaticChannelNode extends StaticBaseNode {
  readonly type: 'channel';
  readonly source?: StaticFlowNode | undefined;
  readonly pipeline: readonly ChannelOperatorInfo[];
}

/** Sink operator (improve.md §8). */
export interface SinkOperatorInfo {
  readonly operation: string;
  readonly category?: 'constructor' | 'transform' | 'other' | undefined;
}

/**
 * Sink pipeline node (improve.md §8 dedicated Sink analysis).
 */
export interface StaticSinkNode extends StaticBaseNode {
  readonly type: 'sink';
  readonly source?: StaticFlowNode | undefined;
  readonly pipeline: readonly SinkOperatorInfo[];
}

/**
 * Union of all static flow node types.
 */
export type StaticFlowNode =
  | StaticEffectNode
  | StaticGeneratorNode
  | StaticPipeNode
  | StaticParallelNode
  | StaticRaceNode
  | StaticErrorHandlerNode
  | StaticRetryNode
  | StaticTimeoutNode
  | StaticResourceNode
  | StaticConditionalNode
  | StaticLoopNode
  | StaticCauseNode
  | StaticExitNode
  | StaticScheduleNode
  | StaticMatchNode
  | StaticTransformNode
  | StaticLayerNode
  | StaticStreamNode
  | StaticChannelNode
  | StaticSinkNode
  | StaticConcurrencyPrimitiveNode
  | StaticFiberNode
  | StaticInterruptionNode
  | StaticDecisionNode
  | StaticSwitchNode
  | StaticTryCatchNode
  | StaticTerminalNode
  | StaticOpaqueNode
  | StaticUnknownNode;

// =============================================================================
// Static Effect IR
// =============================================================================

/**
 * Root node representing the analyzed effect program.
 */
export interface StaticEffectProgram extends StaticBaseNode {
  readonly type: 'program';
  /** Name of the program (from file name or variable) */
  readonly programName: string;
  /** Entry point: gen, direct, pipe, run, workflow-execute, or class */
  readonly source: 'generator' | 'direct' | 'pipe' | 'run' | 'workflow-execute' | 'class' | 'classProperty' | 'classMethod';
  /** Discovery confidence based on alias/path resolution vs heuristics */
  readonly discoveryConfidence?: 'high' | 'medium' | 'low';
  /** Best-effort reason used to classify this as an Effect program */
  readonly discoveryReason?: string | undefined;
  /** The root effect nodes */
  readonly children: readonly StaticFlowNode[];
  /** Dependencies (services required) */
  readonly dependencies: readonly DependencyInfo[];
  /** Error types */
  readonly errorTypes: readonly string[];
  /** Full type signature of the program (A, E, R) */
  readonly typeSignature?: EffectTypeSignature | undefined;
  /** All service requirements across the program */
  readonly requiredServices?: ServiceRequirement[] | undefined;
  /** Description */
  readonly description?: string | undefined;
  /** JSDoc description extracted from comments above the program */
  readonly jsdocDescription?: string | undefined;
  /** Structured JSDoc tags extracted from comments */
  readonly jsdocTags?: JSDocTags | undefined;
}

/**
 * Information about a dependency/service.
 */
export interface DependencyInfo {
  readonly name: string;
  readonly typeSignature?: string | undefined;
  readonly isLayer: boolean;
}

/**
 * Effect Type Signature - A, E, R parameters
 */
export interface EffectTypeSignature {
  /** Success type (A) */
  readonly successType: string;
  /** Error type (E) */
  readonly errorType: string;
  /** Requirements/Context type (R) */
  readonly requirementsType: string;
  /** Whether the type was successfully extracted */
  readonly isInferred: boolean;
  /** Confidence level of the type extraction */
  readonly typeConfidence: 'declared' | 'inferred' | 'unknown';
  /** Raw type string from TypeScript */
  readonly rawTypeString?: string;
}

/** Stream type args — Stream<A, E, R> (21.3 type extraction) */
export interface StreamTypeSignature {
  readonly successType: string;
  readonly errorType: string;
  readonly requirementsType: string;
  readonly rawTypeString?: string;
}

/** Layer type args — Layer<ROut, E, RIn> (provides, error, requires) (21.3 type extraction) */
export interface LayerTypeSignature {
  readonly providedType: string;
  readonly errorType: string;
  readonly requiredType: string;
  readonly rawTypeString?: string;
}

/** Schedule type args — Schedule<Out, In, R> (21.3 type extraction) */
export interface ScheduleTypeSignature {
  readonly outputType: string;
  readonly inputType: string;
  readonly requirementsType: string;
  readonly rawTypeString?: string;
}

/** Cause type args — Cause<E> (21.3 type extraction) */
export interface CauseTypeSignature {
  readonly errorType: string;
  readonly rawTypeString?: string;
}

/**
 * Service requirement extracted from Context type
 */
export interface ServiceRequirement {
  /** Service identifier (tag key) */
  readonly serviceId: string;
  /** Service type name */
  readonly serviceType: string;
  /** Where this requirement originates */
  readonly requiredAt: SourceLocation;
}

// =============================================================================
// Schema Analysis Types
// =============================================================================

/**
 * Schema validation path - represents a field that can fail validation
 */
export interface SchemaValidationPath {
  /** Field path (e.g., "user.email" or "items[0].name") */
  readonly path: string;
  /** Schema type at this path */
  readonly schemaType: string;
  /** Validation constraints (e.g., minLength, pattern) */
  readonly constraints: readonly SchemaConstraint[];
  /** Whether this field is optional */
  readonly isOptional: boolean;
  /** Location in source code */
  readonly location?: SourceLocation | undefined;
}

/**
 * Schema validation constraint
 */
export interface SchemaConstraint {
  /** Constraint type (e.g., "minLength", "pattern", "range") */
  readonly type: string;
  /** Constraint value */
  readonly value: string | number | boolean;
  /** Human-readable description */
  readonly description: string;
}

/**
 * Schema decode/encode operation analysis
 */
export interface SchemaOperation {
  /** Operation type */
  readonly operation: 'decode' | 'encode' | 'decodeUnknown' | 'encodeUnknown';
  /** Schema being used */
  readonly schemaName: string;
  /** Source type (encoded) */
  readonly sourceType: string;
  /** Target type (decoded) */
  readonly targetType: string;
  /** Validation paths that can fail */
  readonly validationPaths: readonly SchemaValidationPath[];
  /** Whether error handling is present */
  readonly hasErrorHandling: boolean;
  /** Location in source code */
  readonly location?: SourceLocation | undefined;
}

/**
 * Schema composition information
 */
export interface SchemaComposition {
  /** Schema name */
  readonly schemaName: string;
  /** Composition type */
  readonly compositionType:
    | 'struct'
    | 'union'
    | 'array'
    | 'record'
    | 'tuple'
    | 'class'
    | 'recursive'
    | 'optional'
    | 'nullable'
    | 'transform'
    | 'filter'
    | 'brand'
    | 'literal'
    | 'enum'
    | 'refinement'
    | 'datetime'
    | 'effect-type'
    | 'serializable';
  /** Child schemas */
  readonly children: readonly string[];
  /** Validation paths */
  readonly validationPaths: readonly SchemaValidationPath[];
}

/**
 * Complete Schema analysis result
 */
export interface SchemaAnalysis {
  /** All Schema.decode/encode operations found */
  readonly operations: readonly SchemaOperation[];
  /** Schema compositions detected */
  readonly compositions: readonly SchemaComposition[];
  /** Missing error handlers for Schema operations */
  readonly unhandledOperations: readonly SchemaOperation[];
}

/**
 * Complete static Effect IR.
 */
export interface StaticEffectIR {
  readonly root: StaticEffectProgram;
  readonly metadata: StaticAnalysisMetadata;
  readonly references: ReadonlyMap<string, StaticEffectIR>;
}

/**
 * Service interface shape extracted from Context.Tag / Effect.Service class (GAP service interface tracking).
 */
export interface ServiceDefinition {
  /** Tag/service identifier (class name or tag string). */
  readonly tagId: string;
  /** Method names from the service interface type. */
  readonly methods: readonly string[];
  /** Property names (non-callable members) from the service interface type. */
  readonly properties: readonly string[];
  /** Whether class implements [Equal.symbol] */
  readonly hasCustomEquality?: boolean | undefined;
  /** Whether class implements [Hash.symbol] */
  readonly hasCustomHash?: boolean | undefined;
}

/**
 * Metadata about the static analysis.
 */
export interface StaticAnalysisMetadata {
  readonly analyzedAt: number;
  readonly filePath: string;
  readonly tsVersion?: string | undefined;
  readonly warnings: readonly AnalysisWarning[];
  readonly stats: AnalysisStats;
  /** Service interface shapes (methods/properties) from Context.Tag/Effect.Service in this file. */
  readonly serviceDefinitions?: readonly ServiceDefinition[] | undefined;
}

/**
 * Warning generated during analysis.
 */
export interface AnalysisWarning {
  readonly code: string;
  readonly message: string;
  readonly location?: SourceLocation | undefined;
}

/**
 * Statistics about the analysis.
 */
export interface AnalysisStats {
  totalEffects: number;
  parallelCount: number;
  raceCount: number;
  errorHandlerCount: number;
  retryCount: number;
  timeoutCount: number;
  resourceCount: number;
  loopCount: number;
  conditionalCount: number;
  layerCount: number;
  interruptionCount: number;
  unknownCount: number;
  decisionCount: number;
  switchCount: number;
  tryCatchCount: number;
  terminalCount: number;
  opaqueCount: number;
}

// =============================================================================
// Diagram Quality Types
// =============================================================================

export type DiagramReadabilityBand = 'good' | 'ok' | 'noisy';

export interface DiagramQualityMetrics {
  readonly stepCountDetailed: number;
  readonly stepCountSummary: number;
  readonly collapsedGroupsSummary: number;
  readonly logRatio: number;
  readonly sideEffectRatio: number;
  readonly anonymousNodeCount: number;
  readonly anonymousRatio: number;
  readonly unknownNodeCount: number;
  readonly serviceCallCount: number;
  readonly namedServiceCallRatio: number;
  readonly pipeChainCount: number;
  readonly maxPipeChainLength: number;
}

export interface DiagramQuality {
  readonly score: number;
  readonly band: DiagramReadabilityBand;
  readonly metrics: DiagramQualityMetrics;
  readonly reasons: readonly string[];
  readonly tips: readonly string[];
}

export interface DiagramTopOffenderEntry {
  readonly filePath: string;
  readonly metricValue: number;
  readonly tip: string;
}

export interface DiagramTopOffendersReport {
  readonly largestPrograms: readonly DiagramTopOffenderEntry[];
  readonly mostAnonymousNodes: readonly DiagramTopOffenderEntry[];
  readonly mostUnknownNodes: readonly DiagramTopOffenderEntry[];
  readonly highestLogRatio: readonly DiagramTopOffenderEntry[];
}

export interface DiagramQualityWithFile {
  readonly filePath: string;
  readonly quality: DiagramQuality;
}

/**
 * Options for the static analyzer.
 */
export interface AnalyzerOptions {
  readonly tsConfigPath?: string | undefined;
  readonly resolveReferences?: boolean | undefined;
  readonly maxReferenceDepth?: number | undefined;
  readonly includeLocations?: boolean | undefined;
  readonly assumeImported?: boolean | undefined;
  /** Enable effect-workflow patterns (Workflow.make / Workflow.run). Use the "effect-workflow" entrypoint for this. */
  readonly enableEffectWorkflow?: boolean | undefined;
  /** Optional path to known Effect internals root; local/relative imports under this path are treated as Effect-like (improve.md §1). */
  readonly knownEffectInternalsRoot?: string | undefined;
  /** Optional minimum confidence threshold for discovered programs. */
  readonly minDiscoveryConfidence?: 'low' | 'medium' | 'high' | undefined;
  /** When true, only keep discovered programs whose roots are exported (or top-level run statements). */
  readonly onlyExportedPrograms?: boolean | undefined;
  /** Enable effect-flow analysis for raw control-flow constructs (if/switch/try-catch/loops). */
  readonly enableEffectFlow?: boolean | undefined;
}

// =============================================================================
// Effect-based Analysis Result
// =============================================================================

/**
 * Result of static analysis - wrapped in Effect for composability.
 */
export type AnalysisResult = Effect.Effect<StaticEffectIR, AnalysisError>;

/**
 * Errors that can occur during analysis.
 */
export class AnalysisError extends Error {
  readonly code: string;
  readonly location?: SourceLocation | undefined;

  constructor(
    code: string,
    message: string,
    location?: SourceLocation  ,
  ) {
    super(message);
    this.code = code;
    this.location = location;
    this.name = 'AnalysisError';
  }
}

// =============================================================================
// Path Analysis Types
// =============================================================================

/**
 * A single execution path through the effect program.
 */
export interface EffectPath {
  readonly id: string;
  readonly description: string;
  readonly steps: readonly PathStepRef[];
  readonly conditions: readonly PathCondition[];
  readonly hasLoops: boolean;
  readonly hasUnresolvedRefs: boolean;
}

/**
 * Reference to a step in a path.
 */
export interface PathStepRef {
  readonly nodeId: string;
  readonly name?: string | undefined;
  readonly repeated: boolean;
}

/**
 * A condition for a path.
 */
export interface PathCondition {
  readonly expression: string;
  readonly mustBe: boolean;
  readonly location?: SourceLocation | undefined;
}

// =============================================================================
// Complexity Types
// =============================================================================

/**
 * Complexity metrics for an effect program.
 */
export interface ComplexityMetrics {
  readonly cyclomaticComplexity: number;
  readonly pathCount: number | 'unbounded';
  readonly maxDepth: number;
  readonly maxParallelBreadth: number;
  readonly decisionPoints: number;
  readonly cognitiveComplexity: number;
}

/**
 * Complexity thresholds.
 */
export interface ComplexityThresholds {
  readonly cyclomaticWarning: number;
  readonly cyclomaticError: number;
  readonly pathCountWarning: number;
  readonly maxDepthWarning: number;
}

// =============================================================================
// Test Matrix Types
// =============================================================================

/**
 * Test coverage matrix.
 */
export interface TestMatrix {
  readonly paths: readonly TestPath[];
  readonly conditions: readonly TestCondition[];
  readonly summary: TestMatrixSummary;
}

/**
 * A path in the test matrix.
 */
export interface TestPath {
  readonly id: string;
  readonly suggestedTestName: string;
  readonly description: string;
  readonly setupConditions: readonly string[];
  readonly expectedSteps: readonly string[];
  readonly priority: 'high' | 'medium' | 'low';
}

/**
 * A condition affecting tests.
 */
export interface TestCondition {
  readonly expression: string;
  readonly affectedPathsWhenTrue: readonly string[];
  readonly affectedPathsWhenFalse: readonly string[];
}

/**
 * Test matrix summary.
 */
export interface TestMatrixSummary {
  readonly totalPaths: number;
  readonly highPriorityPaths: number;
  readonly totalConditions: number;
  readonly minTestsForCoverage: number;
}

// =============================================================================
// Type Guards (using Effect Option)
// =============================================================================

export const isStaticEffectNode = (
  node: StaticFlowNode,
): node is StaticEffectNode => node.type === 'effect';

export const isStaticGeneratorNode = (
  node: StaticFlowNode,
): node is StaticGeneratorNode => node.type === 'generator';

export const isStaticPipeNode = (
  node: StaticFlowNode,
): node is StaticPipeNode => node.type === 'pipe';

export const isStaticParallelNode = (
  node: StaticFlowNode,
): node is StaticParallelNode => node.type === 'parallel';

export const isStaticRaceNode = (
  node: StaticFlowNode,
): node is StaticRaceNode => node.type === 'race';

export const isStaticErrorHandlerNode = (
  node: StaticFlowNode,
): node is StaticErrorHandlerNode => node.type === 'error-handler';

export const isStaticRetryNode = (
  node: StaticFlowNode,
): node is StaticRetryNode => node.type === 'retry';

export const isStaticTimeoutNode = (
  node: StaticFlowNode,
): node is StaticTimeoutNode => node.type === 'timeout';

export const isStaticResourceNode = (
  node: StaticFlowNode,
): node is StaticResourceNode => node.type === 'resource';

export const isStaticConditionalNode = (
  node: StaticFlowNode,
): node is StaticConditionalNode => node.type === 'conditional';

export const isStaticLoopNode = (
  node: StaticFlowNode,
): node is StaticLoopNode => node.type === 'loop';

export const isStaticLayerNode = (
  node: StaticFlowNode,
): node is StaticLayerNode => node.type === 'layer';

export const isStaticCauseNode = (
  node: StaticFlowNode,
): node is StaticCauseNode => node.type === 'cause';

export const isStaticExitNode = (
  node: StaticFlowNode,
): node is StaticExitNode => node.type === 'exit';

export const isStaticScheduleNode = (
  node: StaticFlowNode,
): node is StaticScheduleNode => node.type === 'schedule';

export const isStaticMatchNode = (
  node: StaticFlowNode,
): node is StaticMatchNode => node.type === 'match';

export const isStaticTransformNode = (
  node: StaticFlowNode,
): node is StaticTransformNode => node.type === 'transform';

export const isStaticStreamNode = (
  node: StaticFlowNode,
): node is StaticStreamNode => node.type === 'stream';

export const isStaticChannelNode = (
  node: StaticFlowNode,
): node is StaticChannelNode => node.type === 'channel';

export const isStaticSinkNode = (
  node: StaticFlowNode,
): node is StaticSinkNode => node.type === 'sink';

/**
 * Collect all `StreamOperatorInfo` entries from a stream node, traversing
 * nested `source` links (for curried pipe-style chains not yet flattened).
 */
export const collectStreamPipeline = (node: StaticStreamNode): readonly StreamOperatorInfo[] => {
  const ops: StreamOperatorInfo[] = [];
  const seen = new Set<string>();
  let current: StaticFlowNode = node;
  while (current.type === 'stream') {
    const s: StaticStreamNode = current;
    if (seen.has(s.id)) break;
    seen.add(s.id);
    // pipeline is already flattened if data-last; just collect
    ops.unshift(...s.pipeline);
    current = s.source;
  }
  return ops;
};

export const isStaticConcurrencyPrimitiveNode = (
  node: StaticFlowNode,
): node is StaticConcurrencyPrimitiveNode => node.type === 'concurrency-primitive';

export const isStaticFiberNode = (
  node: StaticFlowNode,
): node is StaticFiberNode => node.type === 'fiber';

export const isStaticInterruptionNode = (
  node: StaticFlowNode,
): node is StaticInterruptionNode => node.type === 'interruption';

export const isStaticUnknownNode = (
  node: StaticFlowNode,
): node is StaticUnknownNode => node.type === 'unknown';

export const isStaticDecisionNode = (node: StaticFlowNode): node is StaticDecisionNode => node.type === 'decision';
export const isStaticSwitchNode = (node: StaticFlowNode): node is StaticSwitchNode => node.type === 'switch';
export const isStaticTryCatchNode = (node: StaticFlowNode): node is StaticTryCatchNode => node.type === 'try-catch';
export const isStaticTerminalNode = (node: StaticFlowNode): node is StaticTerminalNode => node.type === 'terminal';
export const isStaticOpaqueNode = (node: StaticFlowNode): node is StaticOpaqueNode => node.type === 'opaque';

// =============================================================================
// Output Types
// =============================================================================

/**
 * Options for JSON output rendering.
 */
export interface JSONRenderOptions {
  readonly pretty: boolean;
  readonly includeMetadata: boolean;
  readonly compact: boolean;
}

/**
 * Style definitions for Mermaid diagram output.
 */
export interface MermaidStyles {
  readonly effect: string;
  readonly generator: string;
  readonly pipe: string;
  readonly parallel: string;
  readonly race: string;
  readonly errorHandler: string;
  readonly retry: string;
  readonly timeout: string;
  readonly resource: string;
  readonly conditional: string;
  readonly loop: string;
  readonly layer: string;
  readonly stream?: string | undefined;
  readonly concurrencyPrimitive?: string | undefined;
  readonly fiber?: string | undefined;
  readonly unknown: string;
  /** Start node style */
  readonly start?: string | undefined;
  /** End node style */
  readonly end?: string | undefined;
  /** Decision node style */
  readonly decision?: string | undefined;
  /** Switch node style */
  readonly switch?: string | undefined;
  /** Try/catch node style */
  readonly tryCatch?: string | undefined;
  /** Terminal node style */
  readonly terminal?: string | undefined;
  /** Opaque node style */
  readonly opaque?: string | undefined;
  /** Cause node style */
  readonly cause?: string | undefined;
  /** Exit node style */
  readonly exit?: string | undefined;
  /** Schedule node style */
  readonly schedule?: string | undefined;
  /** Match node style */
  readonly match?: string | undefined;
  /** Transform node style */
  readonly transform?: string | undefined;
  /** Channel node style */
  readonly channel?: string | undefined;
  /** Sink node style */
  readonly sink?: string | undefined;
  /** Interruption node style */
  readonly interruption?: string | undefined;
}

/**
 * Options for Mermaid diagram output.
 */
export interface MermaidOptions {
  readonly direction: 'TB' | 'LR' | 'BT' | 'RL';
  readonly includeIds: boolean;
  readonly includeDescriptions: boolean;
  readonly styles: MermaidStyles;
  readonly compact: boolean;
  readonly title?: string | undefined;
  /** Include type signatures (A, E, R) on effect nodes */
  readonly includeTypeSignatures?: boolean | undefined;
  /** Wrap parallel/race blocks in subgraphs */
  readonly useSubgraphs?: boolean | undefined;
  /** Show condition labels on edges (e.g. true/false for conditionals) */
  readonly showConditions?: boolean | undefined;
  /** Level of detail in node labels: compact (callee only), standard (+ variable names), verbose (+ types + roles) */
  readonly detail?: MermaidDetailLevel | undefined;
  /** Overlay data-flow variable annotations on edges and warning classes on nodes */
  readonly dataFlowOverlay?: boolean | undefined;
  /** Overlay error-flow annotations (error types, unhandled errors) on nodes */
  readonly errorFlowOverlay?: boolean | undefined;
}

/**
 * Get children of a node as an Option.
 * Accepts StaticFlowNode or StaticEffectProgram (root) so that walking from ir.root works.
 */
export const getStaticChildren = (
  node: StaticFlowNode | StaticEffectProgram,
): Option.Option<readonly StaticFlowNode[]> => {
  switch (node.type) {
    case 'program':
      return Option.some(node.children);
    case 'generator':
      return Option.some(node.yields.map((y) => y.effect));
    case 'pipe':
      return Option.some([node.initial, ...node.transformations]);
    case 'parallel':
    case 'race':
      return Option.some([...node.children]);
    case 'error-handler':
      return Option.some(
        node.handler ? [node.source, node.handler] : [node.source],
      );
    case 'retry': {
      const retryNode = node;
      const list = ([retryNode.source, retryNode.scheduleNode] as (StaticFlowNode | undefined)[]).filter(
        (n): n is StaticFlowNode => n !== undefined,
      );
      return list.length > 0 ? Option.some(list) : Option.none();
    }
    case 'timeout': {
      const src = node.source as StaticFlowNode | undefined;
      return src ? Option.some([src]) : Option.none();
    }
    case 'resource':
      return Option.some(
        node.use
          ? [node.acquire, node.release, node.use]
          : [node.acquire, node.release],
      );
    case 'conditional':
      return Option.some(
        node.onFalse ? [node.onTrue, node.onFalse] : [node.onTrue],
      );
    case 'loop':
      return Option.some([node.body]);
    case 'cause':
      return node.children && node.children.length > 0
        ? Option.some(node.children)
        : Option.none();
    case 'exit':
    case 'schedule':
    case 'match':
      return Option.none();
    case 'transform':
      return node.source ? Option.some([node.source]) : Option.none();
    case 'layer':
      return Option.some([...node.operations]);
    case 'stream':
      return Option.some([node.source]);
    case 'channel':
      return node.source ? Option.some([node.source]) : Option.none();
    case 'sink':
      return node.source ? Option.some([node.source]) : Option.none();
    case 'concurrency-primitive':
      return node.source ? Option.some([node.source]) : Option.none();
    case 'fiber':
      return node.fiberSource ? Option.some([node.fiberSource]) : Option.none();
    case 'interruption': {
      const children: StaticFlowNode[] = [];
      if (node.source) children.push(node.source);
      if (node.handler) children.push(node.handler);
      return children.length > 0 ? Option.some(children) : Option.none();
    }
    case 'effect':
      return node.callbackBody && node.callbackBody.length > 0
        ? Option.some([...node.callbackBody])
        : Option.none();
    case 'decision':
      return Option.some([...node.onTrue, ...(node.onFalse ?? [])]);
    case 'switch':
      return Option.some(node.cases.flatMap(c => [...c.body]));
    case 'try-catch':
      return Option.some([...node.tryBody, ...(node.catchBody ?? []), ...(node.finallyBody ?? [])]);
    case 'terminal':
      return node.value ? Option.some([...node.value]) : Option.none();
    case 'opaque':
      return Option.none();
    default:
      return Option.none();
  }
};

// =============================================================================
// Service Artifact Types (whole-codebase service mapping)
// =============================================================================

/**
 * A layer implementation that provides a service.
 */
export interface LayerImplementation {
  /** Name of the layer variable (e.g. 'UserRepoLive') */
  readonly name: string;
  /** File where the layer is defined */
  readonly filePath: string;
  /** Source location of the layer definition */
  readonly location: SourceLocation;
  /** Layer kind */
  readonly kind: 'effect' | 'succeed' | 'sync' | 'scoped' | 'other';
  /** Services required by this layer implementation */
  readonly requires: readonly string[];
  /** IR of the layer's implementation body (if analyzable) */
  readonly bodyIR?: StaticEffectIR | undefined;
}

/**
 * A reference to a program that consumes a service.
 */
export interface ServiceConsumerRef {
  /** Program name that uses this service */
  readonly programName: string;
  /** File containing the program */
  readonly filePath: string;
  /** Location of the yield* call */
  readonly location?: SourceLocation | undefined;
}

/**
 * First-class artifact for an Effect service, deduplicated at the project level.
 */
export interface ServiceArtifact {
  /** Unique service identifier (tag string, e.g. 'UserRepo') */
  readonly serviceId: string;
  /** Class name (may differ from serviceId if tag string differs) */
  readonly className: string;
  /** File where the service tag class is defined */
  readonly definitionFilePath: string;
  /** Source location of the class declaration */
  readonly definitionLocation: SourceLocation;
  /** Interface shape (methods, properties) */
  readonly definition: ServiceDefinition;
  /** Full type text of the service interface */
  readonly interfaceTypeText?: string | undefined;
  /** Layer implementations that provide this service */
  readonly layerImplementations: readonly LayerImplementation[];
  /** Programs that consume (yield*) this service */
  readonly consumers: readonly ServiceConsumerRef[];
  /** Services this service's layers depend on (transitive requirements) */
  readonly dependencies: readonly string[];
}

/**
 * Project-level deduplicated service map.
 */
export interface ProjectServiceMap {
  /** Map from serviceId to its artifact */
  readonly services: ReadonlyMap<string, ServiceArtifact>;
  /** Services referenced but with no tag definition found */
  readonly unresolvedServices: readonly string[];
  /** Topological order of services (leaves first) */
  readonly topologicalOrder: readonly string[];
}

// =============================================================================
// Showcase Types
// =============================================================================

export interface ShowcaseStepDetail {
  readonly stepId: string;
  readonly name: string;
  readonly callee: string;
  // Output type
  readonly outputType: string;
  readonly outputTypeKind: 'declared' | 'inferred' | 'unknown';
  readonly outputTypeDisplay: string;
  readonly outputTypeText: string;
  // Error type
  readonly errorTypeDisplay: string;
  readonly errors: readonly string[];
  // Dependency
  readonly depSource?: string | undefined;
  // Step kind
  readonly stepKind?: string | undefined;
  // Retry/timeout/resource/loop context (optional)
  readonly retry?: { readonly attempts: number | 'unlimited'; readonly backoff: string } | undefined;
  readonly timeout?: { readonly ms: string } | undefined;
  readonly kind?: 'resource' | undefined;
  readonly acquire?: string | undefined;
  readonly use?: string | undefined;
  readonly release?: string | undefined;
  readonly repeats?: 'loop' | undefined;
  readonly loopType?: string | undefined;
  readonly iterationSource?: string | undefined;
}

export interface ShowcaseEntry {
  readonly title: string;
  readonly code: string;
  readonly mermaid: string;
  readonly stepDetails: readonly ShowcaseStepDetail[];
}
