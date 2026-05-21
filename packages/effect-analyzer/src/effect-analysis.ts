/**
 * Effect expression analysis: pipe chains, effect calls, and domain-specific analyzers.
 */

import { Effect, Option } from 'effect';
import type {
  SourceFile,
  Node,
  CallExpression,
  ArrowFunction,
  FunctionExpression,
  Block,
  ReturnStatement,
  ObjectLiteralExpression,
  PropertyAssignment,
  PropertyAccessExpression,
  ExpressionStatement,
  Identifier,
  ArrayLiteralExpression,
  TaggedTemplateExpression,
  NewExpression,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type { AnalysisError, AnalyzerOptions, AnalysisWarning, AnalysisStats } from './types';
import type {
  StaticFlowNode,
  StaticEffectNode,
  StaticPipeNode,
  StaticLayerNode,
  StaticStreamNode,
  StaticFiberNode,
  StaticUnknownNode,
  LayerLifecycle,
  EffectTypeSignature,
} from './types';
import { getStaticChildren } from './types';
import {
  extractEffectTypeSignature,
  extractServiceRequirements,
  extractLayerTypeSignature,
} from './type-extractor';
import {
  generateId,
  extractLocation,
  extractJSDocDescription,
  extractJSDocTags,
  computeDisplayName,
  computeSemanticRole,
} from './analysis-utils';
import {
  ERROR_HANDLER_PATTERNS,
  CONDITIONAL_PATTERNS,
  COLLECTION_PATTERNS,
  FIBER_PATTERNS,
  INTERRUPTION_PATTERNS,
  isTransformCall,
  isMatchCall,
  isCauseCall,
  isExitCall,
  isScheduleCall,
  getSemanticDescriptionWithAliases,
  parseServiceIdsFromContextType,
  BUILT_IN_TYPE_NAMES,
  KNOWN_EFFECT_NAMESPACES,
} from './analysis-patterns';
import {
  getAliasesForFile,
  isEffectCallee,
  isEffectLikeCallExpression,
  normalizeEffectCallee,
} from './alias-resolution';
import {
  buildCallbackSummaryNodes,
  summarizeNamedCallbackHandlers,
} from './callback-summary';
import { resolveIdentifierToLayerInitializer } from './layer-initializer-resolution';
import {
  isEffectRuntimePrimitive,
  isLikelyServiceStreamProperty,
  tryResolveServicePropertyAccess,
  classifyUseCallbackKind,
} from './service-type-heuristics';
import type { AnalyzerDeps } from './stream-channel-sink-analyzers';
import {
  analyzeStreamCall as _analyzeStreamCall,
  analyzeChannelCall as _analyzeChannelCall,
  analyzeSinkCall as _analyzeSinkCall,
} from './stream-channel-sink-analyzers';

/**
 * Deferred reference to `analyzeEffectExpression` used by extracted analyzers
 * (stream/channel/sink) that need to recurse. The getter resolves at call time,
 * which is after the module's top-level evaluation, so the export is in scope.
 */
const _analyzerDeps: AnalyzerDeps = {
  get analyzeEffectExpression() {
    return analyzeEffectExpression;
  },
};

const analyzeStreamCall: OmitFirst<typeof _analyzeStreamCall> = (...args) =>
  _analyzeStreamCall(_analyzerDeps, ...args);
const analyzeChannelCall: OmitFirst<typeof _analyzeChannelCall> = (...args) =>
  _analyzeChannelCall(_analyzerDeps, ...args);
const analyzeSinkCall: OmitFirst<typeof _analyzeSinkCall> = (...args) =>
  _analyzeSinkCall(_analyzerDeps, ...args);

import {
  analyzeRetryCall as _analyzeRetryCall,
  analyzeTimeoutCall as _analyzeTimeoutCall,
  analyzeScheduleCall,
} from './retry-timeout-analyzers';

const analyzeRetryCall: OmitFirst<typeof _analyzeRetryCall> = (...args) =>
  _analyzeRetryCall(_analyzerDeps, ...args);
const analyzeTimeoutCall: OmitFirst<typeof _analyzeTimeoutCall> = (...args) =>
  _analyzeTimeoutCall(_analyzerDeps, ...args);

import {
  analyzeConcurrencyPrimitiveCall,
  analyzeFiberCall as _analyzeFiberCall,
  analyzeInterruptionCall as _analyzeInterruptionCall,
} from './concurrency-fiber-analyzers';

const analyzeFiberCall: OmitFirst<typeof _analyzeFiberCall> = (...args) =>
  _analyzeFiberCall(_analyzerDeps, ...args);
const analyzeInterruptionCall: OmitFirst<typeof _analyzeInterruptionCall> = (
  ...args
) => _analyzeInterruptionCall(_analyzerDeps, ...args);

import {
  analyzeParallelCall as _analyzeParallelCall,
  analyzeRaceCall as _analyzeRaceCall,
} from './parallel-race-analyzers';

const analyzeParallelCall: OmitFirst<typeof _analyzeParallelCall> = (...args) =>
  _analyzeParallelCall(_analyzerDeps, ...args);
const analyzeRaceCall: OmitFirst<typeof _analyzeRaceCall> = (...args) =>
  _analyzeRaceCall(_analyzerDeps, ...args);

import { analyzeErrorHandlerCall as _analyzeErrorHandlerCall } from './error-handler-analyzer';
const analyzeErrorHandlerCall: OmitFirst<typeof _analyzeErrorHandlerCall> = (
  ...args
) => _analyzeErrorHandlerCall(_analyzerDeps, ...args);

import { analyzeResourceCall as _analyzeResourceCall } from './resource-analyzer';
const analyzeResourceCall: OmitFirst<typeof _analyzeResourceCall> = (...args) =>
  _analyzeResourceCall(_analyzerDeps, ...args);

import {
  analyzeConditionalCall as _analyzeConditionalCall,
  analyzeLoopCall as _analyzeLoopCall,
  analyzeMatchCall,
  analyzeCauseCall as _analyzeCauseCall,
  analyzeExitCall,
  analyzeTransformCall as _analyzeTransformCall,
} from './control-flow-analyzers';
const analyzeConditionalCall: OmitFirst<typeof _analyzeConditionalCall> = (
  ...args
) => _analyzeConditionalCall(_analyzerDeps, ...args);
const analyzeLoopCall: OmitFirst<typeof _analyzeLoopCall> = (...args) =>
  _analyzeLoopCall(_analyzerDeps, ...args);
const analyzeCauseCall: OmitFirst<typeof _analyzeCauseCall> = (...args) =>
  _analyzeCauseCall(_analyzerDeps, ...args);
const analyzeTransformCall: OmitFirst<typeof _analyzeTransformCall> = (
  ...args
) => _analyzeTransformCall(_analyzerDeps, ...args);

type OmitFirst<F> = F extends (first: AnalyzerDeps, ...rest: infer R) => infer Out
  ? (...args: R) => Out
  : never;

// Schema decode/encode operations are NOT collection operations.
const SCHEMA_OPS = [
  'Schema.decode',
  'Schema.decodeUnknown',
  'Schema.encode',
  'Schema.validate',
  'Schema.decodeOption',
  'Schema.decodeEither',
  'Schema.encodeUnknown',
  'Schema.decodeSync',
  'Schema.encodeSync',
  'Schema.decodeUnknownSync',
  'Schema.decodeUnknownOption',
  'Schema.decodeUnknownEither',
  'Schema.decodePromise',
  'Schema.encodePromise',
  'Schema.decodeUnknownPromise',
];


/**
 * Heuristic: does this `.pipe(...)` call apply Effect-level operations?
 *
 * Used to route pipe calls whose base is not literally `Effect.*` but whose
 * transformations are (e.g. `service.doThing().pipe(Effect.retry(...))`).
 * Matches the textual prefix of each arg against the Effect module's common
 * combinators — cheap, no type-checker needed.
 */
const EFFECT_PIPE_OP_REGEX =
  /^Effect\.(retry|retryOrElse|retryN|timeout(?:Fail|FailCause|Option|To)?|catchAll|catchAllCause|catchTag|catchTags|catchSome|catchSomeCause|catchSomeDefect|orElse|orElseSucceed|orElseFail|orElseFailWith|orDie|orDieWith|tap|tapBoth|tapDefect|tapError|tapErrorCause|tapErrorTag|mapError|mapBoth|withSpan|annotateLogs|annotateSpans|ensuring|ensuringWith|delay|repeat|repeatN|repeatOrElse|zip|zipLeft|zipRight|matchEffect|match)\s*\(/;

const pipeArgsIncludeEffectOp = (call: CallExpression): boolean => {
  for (const arg of call.getArguments()) {
    if (EFFECT_PIPE_OP_REGEX.test(arg.getText())) return true;
  }
  return false;
};

export const analyzePipeChain = (
  node: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  serviceScope?: Map<string, string>,
): Effect.Effect<readonly StaticFlowNode[], AnalysisError> =>
  Effect.gen(function* () {
    const { SyntaxKind } = loadTsMorph();
    const args = node.getArguments();
    const expr = node.getExpression();
    const isMethodPipe =
      expr.getKind() === SyntaxKind.PropertyAccessExpression &&
      (expr as PropertyAccessExpression).getName() === 'pipe';
    const baseExpr = isMethodPipe
      ? (expr as PropertyAccessExpression).getExpression()
      : args[0];
    const transformArgs = isMethodPipe ? args : args.slice(1);
    if (!baseExpr) return [];

    // GAP: pipe-chain when base is a variable — resolve to Layer initializer (same- or cross-file)
    const baseNode = resolveIdentifierToLayerInitializer(baseExpr);
    let baseSourceFile = baseNode.getSourceFile();
    const basePath = baseSourceFile.getFilePath();
    const project = sourceFile.getProject();
    // Ensure the resolved file is in the project so alias resolution (e.g. L→Layer) works
    if (!project.getSourceFile(basePath)) {
      const added = project.addSourceFileAtPath(basePath);
      if (added) baseSourceFile = added;
    } else {
      const inProject = project.getSourceFile(basePath);
      if (inProject) baseSourceFile = inProject;
    }
    const initial = yield* analyzeEffectExpression(
      baseNode,
      baseSourceFile,
      baseSourceFile.getFilePath(),
      opts,
      warnings,
      stats,
      serviceScope,
    );

    const transformations: StaticFlowNode[] = [];
    for (const arg of transformArgs) {
      if (arg) {
        const analyzed = yield* analyzeEffectExpression(
          arg,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
          serviceScope,
        );
        transformations.push(analyzed);
      }
    }

    // Detect Effect.withSpan in transformations and merge as annotation
    let spanName: string | undefined;
    const filteredTransformations = transformations.filter((t) => {
      if (t.type === 'effect' && t.callee.includes('withSpan')) {
        return false; // Remove withSpan from transformations list
      }
      return true;
    });

    // Extract span name from the AST transform arguments
    if (!spanName) {
      for (const arg of transformArgs) {
        if (arg) {
          const argText = arg.getText();
          if (argText.includes('withSpan')) {
            const match = /withSpan\s*\(\s*["']([^"']+)["']/.exec(argText);
            if (match?.[1]) {
              spanName = match[1];
            }
          }
        }
      }
    }

    // Extract type flow through pipe chain
    let typeFlow: EffectTypeSignature[] | undefined;
    try {
      const typeChecker = sourceFile.getProject().getTypeChecker();
      const flow: EffectTypeSignature[] = [];
      // Extract initial type
      const initialSig = extractEffectTypeSignature(baseExpr, typeChecker);
      if (initialSig) flow.push(initialSig);
      // Extract type at each transform step
      for (const argNode of transformArgs) {
        if (argNode) {
          const sig = extractEffectTypeSignature(argNode, typeChecker);
          if (sig) flow.push(sig);
        }
      }
      if (flow.length > 0) typeFlow = flow;
    } catch {
      // Type extraction can fail; skip type flow
    }

    const pipeNode: StaticPipeNode = {
      id: generateId(),
      type: 'pipe',
      initial,
      transformations: filteredTransformations,
      ...(typeFlow ? { typeFlow } : {}),
      ...(spanName ? { spanName } : {}),
    };
    const enrichedPipeNode: StaticPipeNode = {
      ...pipeNode,
      displayName: computeDisplayName(pipeNode),
      semanticRole: computeSemanticRole(pipeNode),
    };

    return [enrichedPipeNode];
  });

// =============================================================================
// Effect Expression Analysis
// =============================================================================

export const analyzeEffectExpression = (
  node: Node,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  serviceScope?: Map<string, string>,
): Effect.Effect<StaticFlowNode, AnalysisError> =>
  Effect.gen(function* () {
    const { SyntaxKind } = loadTsMorph();

    // Handle function wrappers that return an Effect (common in workflow APIs)
    if (
      node.getKind() === SyntaxKind.ArrowFunction ||
      node.getKind() === SyntaxKind.FunctionExpression
    ) {
      const fnNode = node as ArrowFunction | FunctionExpression;
      const body = fnNode.getBody();

      if (!body) {
        const unknownNode: StaticUnknownNode = {
          id: generateId(),
          type: 'unknown',
          reason: 'Function has no body',
          sourceCode: node.getText().slice(0, 100),
          location: extractLocation(
            node,
            filePath,
            opts.includeLocations ?? false,
          ),
        };
        stats.unknownCount++;
        return unknownNode;
      }

      if (body.getKind() === SyntaxKind.Block) {
        const statements = (
          body as Block
        ).getStatements();
        const returnStmt = statements.find(
          (stmt) => stmt.getKind() === SyntaxKind.ReturnStatement,
        ) as ReturnStatement | undefined;

        const returnedExpr = returnStmt?.getExpression();
        if (returnedExpr) {
          return yield* analyzeEffectExpression(
            returnedExpr,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
            serviceScope,
          );
        }
      } else {
        return yield* analyzeEffectExpression(
          body,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
          serviceScope,
        );
      }

      const opaqueNode = {
        id: generateId(),
        type: 'opaque' as const,
        reason: 'Function body is a non-Effect callback',
        sourceText: node.getText().slice(0, 100),
        location: extractLocation(node, filePath, opts.includeLocations ?? false),
      };
      return opaqueNode;
    }

    // Handle call expressions
    if (node.getKind() === SyntaxKind.CallExpression) {
      return yield* analyzeEffectCall(
        node as CallExpression,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
        serviceScope,
      );
    }

    // Handle property access chains (Effect.succeed(...))
    if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
      const text = node.getText();
      // Fiber.roots / Fiber.getCurrentFiber — property access that yields an Effect (GAP 5)
      if (text === 'Fiber.roots' || text === 'Fiber.getCurrentFiber') {
        const operation: StaticFiberNode['operation'] =
          text === 'Fiber.roots' ? 'roots' : 'getCurrentFiber';
        return {
          id: generateId(),
          type: 'fiber',
          operation,
          isScoped: false,
          isDaemon: false,
          location: extractLocation(
            node,
            filePath,
            opts.includeLocations ?? false,
          ),
        };
      }
      const objectText = (node as PropertyAccessExpression).getExpression().getText();
      const propertyName = (node as PropertyAccessExpression).getName();
      const serviceId = serviceScope?.get(objectText);
      if (serviceId) {
        const serviceEffectNode: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee: text,
          description: 'service-call',
          requiredServices: [
            {
              serviceId,
              serviceType: serviceId,
              requiredAt: extractLocation(
                node,
                filePath,
                opts.includeLocations ?? false,
              ) ?? {
                filePath,
                line: 1,
                column: 0,
              },
            },
          ],
          serviceCall: {
            serviceType: serviceId,
            methodName: propertyName,
            objectName: objectText,
          },
          location: extractLocation(
            node,
            filePath,
            opts.includeLocations ?? false,
          ),
        };
        stats.totalEffects++;
        if (isLikelyServiceStreamProperty(propertyName)) {
          const streamNode: StaticStreamNode = {
            id: generateId(),
            type: 'stream',
            source: {
              ...serviceEffectNode,
              displayName: computeDisplayName(serviceEffectNode),
              semanticRole: computeSemanticRole(serviceEffectNode),
            },
            pipeline: [],
            constructorType: 'other',
            location: extractLocation(
              node,
              filePath,
              opts.includeLocations ?? false,
            ),
          };
          return {
            ...streamNode,
            displayName: computeDisplayName(streamNode),
            semanticRole: computeSemanticRole(streamNode),
          };
        }
        return {
          ...serviceEffectNode,
          displayName: computeDisplayName(serviceEffectNode),
          semanticRole: computeSemanticRole(serviceEffectNode),
        };
      }

      const inferredServiceCall = tryResolveServicePropertyAccess(
        node as PropertyAccessExpression,
      );
      if (inferredServiceCall) {
        const serviceEffectNode: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee: text,
          description: 'service-call',
          requiredServices: [
            {
              serviceId: inferredServiceCall.serviceType,
              serviceType: inferredServiceCall.serviceType,
              requiredAt: extractLocation(
                node,
                filePath,
                opts.includeLocations ?? false,
              ) ?? {
                filePath,
                line: 1,
                column: 0,
              },
            },
          ],
          serviceCall: inferredServiceCall,
          serviceMethod: {
            serviceId: inferredServiceCall.serviceType,
            methodName: inferredServiceCall.methodName,
          },
          location: extractLocation(
            node,
            filePath,
            opts.includeLocations ?? false,
          ),
        };
        stats.totalEffects++;
        if (isLikelyServiceStreamProperty(propertyName)) {
          const streamNode: StaticStreamNode = {
            id: generateId(),
            type: 'stream',
            source: {
              ...serviceEffectNode,
              displayName: computeDisplayName(serviceEffectNode),
              semanticRole: computeSemanticRole(serviceEffectNode),
            },
            pipeline: [],
            constructorType: 'other',
            location: extractLocation(
              node,
              filePath,
              opts.includeLocations ?? false,
            ),
          };
          return {
            ...streamNode,
            displayName: computeDisplayName(streamNode),
            semanticRole: computeSemanticRole(streamNode),
          };
        }
        return {
          ...serviceEffectNode,
          displayName: computeDisplayName(serviceEffectNode),
          semanticRole: computeSemanticRole(serviceEffectNode),
        };
      }

      if (isEffectCallee(text, getAliasesForFile(sourceFile), sourceFile)) {
        const effectNode: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee: normalizeEffectCallee(text, sourceFile),
          location: extractLocation(
            node,
            filePath,
            opts.includeLocations ?? false,
          ),
        };
        stats.totalEffects++;
        return effectNode;
      }
    }

    // Handle identifier references
    if (node.getKind() === SyntaxKind.Identifier) {
      const effectNode: StaticEffectNode = {
        id: generateId(),
        type: 'effect',
        callee: node.getText(),
        location: extractLocation(
          node,
          filePath,
          opts.includeLocations ?? false,
        ),
      };
      stats.totalEffects++;
      return effectNode;
    }

    // Handle object literal with known Effect handler properties (match-style APIs)
    if (node.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const objLit = node as ObjectLiteralExpression;
      const HANDLER_PROPS = new Set(['onNone', 'onSome', 'onFailure', 'onSuccess', 'onLeft', 'onRight']);
      const props = objLit.getProperties();
      const handlerEntries: StaticFlowNode[] = [];
      let hasKnownHandler = false;

      for (const prop of props) {
        if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
        const assignment = prop as PropertyAssignment;
        const propName = assignment.getName();
        if (!HANDLER_PROPS.has(propName)) continue;
        hasKnownHandler = true;
        const initializer = assignment.getInitializer();
        if (initializer) {
          const analyzed = yield* analyzeEffectExpression(
            initializer,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
            serviceScope,
          );
          handlerEntries.push(analyzed);
        }
      }

      if (hasKnownHandler && handlerEntries.length > 0) {
        return handlerEntries.length === 1 ? handlerEntries[0]! : {
          id: generateId(),
          type: 'parallel',
          callee: 'match-handlers',
          mode: 'sequential' as const,
          children: handlerEntries,
          location: extractLocation(node, filePath, opts.includeLocations ?? false),
        };
      }
    }

    // Handle tagged template expressions (e.g. sql`CREATE TABLE...`)
    // These are commonly used in Effect SQL clients and return Effects
    if (node.getKind() === SyntaxKind.TaggedTemplateExpression) {
      const taggedTemplate = node as TaggedTemplateExpression;
      const tagText = taggedTemplate.getTag().getText();
      const effectNode: StaticEffectNode = {
        id: generateId(),
        type: 'effect',
        callee: tagText,
        description: 'side-effect',
        location: extractLocation(node, filePath, opts.includeLocations ?? false),
      };
      stats.totalEffects++;
      return {
        ...effectNode,
        displayName: computeDisplayName(effectNode),
        semanticRole: 'side-effect' as const,
      };
    }

    // Handle yielded error instances: `yield* new SomeTaggedError(...)`
    // Common in Effect codebases where TaggedError is yieldable.
    if (node.getKind() === SyntaxKind.NewExpression) {
      const newExpr = node as NewExpression;
      const ctorText = newExpr.getExpression().getText();
      const ctorName = ctorText.split('.').pop() ?? ctorText;
      const typeText = newExpr.getType().getText();
      const isErrorLike =
        ctorName.endsWith("Error") ||
        typeText.includes('YieldableError') ||
        typeText.includes('TaggedError');
      if (isErrorLike) {
        const effectNode: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee: 'Effect.fail',
          errorType: ctorName,
          description: 'error-handling',
          location: extractLocation(node, filePath, opts.includeLocations ?? false),
        };
        stats.totalEffects++;
        return {
          ...effectNode,
          displayName: computeDisplayName(effectNode),
          semanticRole: computeSemanticRole(effectNode),
        };
      }
    }

    // Default: unknown
    const unknownNode: StaticUnknownNode = {
      id: generateId(),
      type: 'unknown',
      reason: 'Could not determine effect type',
      sourceCode: node.getText().slice(0, 100),
      location: extractLocation(node, filePath, opts.includeLocations ?? false),
    };
    stats.unknownCount++;
    return unknownNode;
  });

export const analyzeEffectCall = (
  call: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  serviceScope?: Map<string, string>,
): Effect.Effect<StaticFlowNode, AnalysisError> =>
  Effect.gen(function* () {
    const { SyntaxKind } = loadTsMorph();
    const callee = call.getExpression().getText();
    const normalizedCallee = normalizeEffectCallee(callee, sourceFile);
    const calleeOperation =
      (/([A-Za-z_$][\w$]*)$/.exec(normalizedCallee))?.[1] ?? normalizedCallee;
    const location = extractLocation(
      call,
      filePath,
      opts.includeLocations ?? false,
    );

    // pipe(base, ...fns) or <base>.pipe(...fns) inside generator → analyze as pipe chain so transformations (e.g. RcRef.update) are classified
    // For method-style .pipe(), route Effect-based pipes, plus any pipe whose
    // transformations include explicit Effect.* operations (e.g. retry, timeout, catchAll)
    // on a non-Effect-prefixed base like `serviceCall().pipe(Effect.retry(...))`.
    const isEffectMethodPipe =
      callee.endsWith('.pipe') &&
      callee !== 'pipe' &&
      (callee.startsWith('Effect.') || pipeArgsIncludeEffectOp(call));
    if (
      (callee === 'pipe' || isEffectMethodPipe) &&
      call.getArguments().length >= 1
    ) {
      const nodes = yield* analyzePipeChain(
        call,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
        serviceScope,
      );
      if (nodes.length > 0 && nodes[0]) return nodes[0];
    }

    const isMethodPipe =
      call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression &&
      (call.getExpression() as PropertyAccessExpression).getName() === 'pipe';
    if (isMethodPipe) {
      const baseExpr = (call.getExpression() as PropertyAccessExpression).getExpression();
      const baseCallText =
        baseExpr.getKind() === SyntaxKind.CallExpression
          ? (baseExpr as CallExpression).getExpression().getText()
          : '';
      if (/\blayerProtocol[A-Za-z0-9_]*$/.test(baseCallText)) {
        const nodes = yield* analyzePipeChain(
          call,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
          serviceScope,
        );
        if (nodes.length > 0 && nodes[0]) return nodes[0];
      }
      const baseText = baseExpr.getText();
      const baseCallOrExprText = baseCallText || baseText;
      if (baseText.startsWith('Stream.') || baseCallOrExprText.startsWith('Stream.')) {
        return yield* analyzeStreamCall(
          call,
          'Stream.pipe',
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
          serviceScope,
        );
      }
    }

    // Context.pick / Context.omit are pure operations (not Effects) but are useful
    // to preserve context-shaping steps inside Effect.gen bodies.
    if (
      normalizedCallee === 'Context.pick' ||
      normalizedCallee === 'Context.omit'
    ) {
      const effectNode: StaticEffectNode = {
        id: generateId(),
        type: 'effect',
        callee: normalizedCallee,
        description: 'context',
        location,
      };
      stats.totalEffects++;
      return {
        ...effectNode,
        displayName: computeDisplayName(effectNode),
        semanticRole: computeSemanticRole(effectNode),
      };
    }

    if (normalizedCallee.startsWith('Layer.')) {
      return yield* analyzeLayerCall(
        call,
        normalizedCallee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    // Protocol client factories often return layers that are then composed via Layer.provide(...)
    // e.g. RpcClient.layerProtocolHttp(...).pipe(Layer.provide([...])).
    if (/\blayerProtocol[A-Za-z0-9_]*$/.test(normalizedCallee)) {
      const layerNode: StaticLayerNode = {
        id: generateId(),
        type: 'layer',
        name: normalizedCallee,
        operations: [],
        isMerged: false,
        location,
      };
      return {
        ...layerNode,
        displayName: computeDisplayName(layerNode),
        semanticRole: computeSemanticRole(layerNode),
      };
    }

    if (normalizedCallee.startsWith('Stream.')) {
      return yield* analyzeStreamCall(
        call,
        normalizedCallee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
        serviceScope,
      );
    }

    if (normalizedCallee.startsWith('Channel.')) {
      return yield* analyzeChannelCall(
        call,
        normalizedCallee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (callee.startsWith('Sink.')) {
      return yield* analyzeSinkCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    const isConcurrencyPrimitiveCallee =
      callee.startsWith('Queue.') ||
      callee.startsWith('PubSub.') ||
      callee.startsWith('Deferred.') ||
      callee.startsWith('Semaphore.') ||
      callee.startsWith('Mailbox.') ||
      callee.startsWith('SubscriptionRef.') ||
      callee.startsWith('RateLimiter.') ||
      callee.startsWith('PartitionedSemaphore.') ||
      callee.startsWith('FiberHandle.') ||
      callee.startsWith('FiberSet.') ||
      callee.startsWith('FiberMap.') ||
      callee.startsWith('Cache.') ||
      callee.startsWith('ScopedCache.') ||
      callee.startsWith('RcRef.') ||
      callee.includes('.RcRef.') ||
      callee.startsWith('RcMap.') ||
      callee.includes('.RcMap.') ||
      callee.startsWith('Reloadable.') ||
      callee.includes('.Reloadable.') ||
      callee.includes('makeLatch') ||
      callee.includes('Latch.');
    if (isConcurrencyPrimitiveCallee) {
      return yield* analyzeConcurrencyPrimitiveCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (FIBER_PATTERNS.some((p) => callee.includes(p) || callee.startsWith(p))) {
      return yield* analyzeFiberCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (INTERRUPTION_PATTERNS.some((p) => callee.includes(p))) {
      return yield* analyzeInterruptionCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    // Handle different Effect patterns
    if (callee.includes('.all') || callee === 'all') {
      return yield* analyzeParallelCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
        serviceScope,
      );
    }

    if (callee.includes('.race') || callee === 'race') {
      return yield* analyzeRaceCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (ERROR_HANDLER_PATTERNS.some((pattern) => callee.includes(pattern))) {
      return yield* analyzeErrorHandlerCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (callee.includes('.retry')) {
      return yield* analyzeRetryCall(
        call,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (callee.includes('.timeout')) {
      return yield* analyzeTimeoutCall(
        call,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    const resourceOps = new Set([
      'acquireRelease',
      'acquireUseRelease',
      'ensuring',
      'addFinalizer',
      'onExit',
      'onError',
      'parallelFinalizers',
      'sequentialFinalizers',
      'finalizersMask',
      'using',
      'withEarlyRelease',
    ]);
    const resourceOpPrefixes = ['acquireRelease', 'acquireUseRelease'] as const;
    const isResourceOp = (op: string) =>
      resourceOps.has(op) || resourceOpPrefixes.some((p) => op.startsWith(p));
    if (calleeOperation === 'pipe' && call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression) {
      const propAccess = call.getExpression() as PropertyAccessExpression;
      const baseExpr = propAccess.getExpression();
      if (baseExpr.getKind() === SyntaxKind.CallExpression) {
        const baseCall = baseExpr as CallExpression;
        const baseCallee = baseCall.getExpression().getText();
        const baseOperation = (/([A-Za-z_$][\w$]*)$/.exec(baseCallee))?.[1] ?? baseCallee;
        if (isResourceOp(baseOperation)) {
          return yield* analyzeResourceCall(
            baseCall,
            baseOperation,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
        }
      }
    }
    if (isResourceOp(calleeOperation)) {
      return yield* analyzeResourceCall(
        call,
        calleeOperation,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    // Match CONDITIONAL_PATTERNS against the final method name, not the full callee text
    const conditionalOp = `.${calleeOperation}`;
    if (CONDITIONAL_PATTERNS.some((pattern) => conditionalOp === pattern || callee.endsWith(pattern))) {
      return yield* analyzeConditionalCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    const isSchemaOp = SCHEMA_OPS.some((op) => callee.startsWith(op) || normalizedCallee.startsWith(op));

    // Match COLLECTION_PATTERNS against the final method name (calleeOperation), not
    // the full callee text which can contain arbitrary source code from curried functions.
    const collectionOp = `.${calleeOperation}`;
    if (!isSchemaOp && COLLECTION_PATTERNS.some((pattern) => collectionOp === pattern || callee.endsWith(pattern))) {
      return yield* analyzeLoopCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (isTransformCall(callee)) {
      return yield* analyzeTransformCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (isMatchCall(callee)) {
      return analyzeMatchCall(call, callee, filePath, opts);
    }

    if (isCauseCall(callee)) {
      return yield* analyzeCauseCall(
        call,
        callee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    }

    if (isExitCall(callee)) {
      return analyzeExitCall(call, callee, filePath, opts);
    }

    if (isScheduleCall(callee)) {
      return yield* analyzeScheduleCall(call, callee, filePath, opts);
    }

    // Default effect node
    stats.totalEffects++;

    // Effect.sync/promise/async callback body (one level only)
    let callbackBody: readonly StaticFlowNode[] | undefined;
    let usePattern: StaticEffectNode['usePattern'];
    const CONSTRUCTOR_CALLBACK_CALLEES = [
      'Effect.sync',
      'Effect.promise',
      'Effect.async',
      'Effect.asyncEffect',
      'Effect.callback',
      'Effect.tryPromise',
      'Effect.suspend',
    ];
    const isConstructorWithCallback =
      CONSTRUCTOR_CALLBACK_CALLEES.some((c) => callee.includes(c)) &&
      call.getArguments().length > 0 &&
      call.getArguments()[0];
    let asyncCallback: StaticEffectNode['asyncCallback'];
    if (isConstructorWithCallback) {
      const firstArg = call.getArguments()[0]!;
      const { SyntaxKind } = loadTsMorph();
      const isFn =
        firstArg.getKind() === SyntaxKind.ArrowFunction ||
        firstArg.getKind() === SyntaxKind.FunctionExpression;
      if (isFn) {
        const fn = firstArg as
          | ArrowFunction
          | FunctionExpression;
        const body = fn.getBody();
        const innerNodes: StaticFlowNode[] = [];
        if (body) {
          if (body.getKind() === SyntaxKind.Block) {
            const block = body as Block;
            for (const stmt of block.getStatements()) {
              if (stmt.getKind() === SyntaxKind.ReturnStatement) {
                const retExpr = (stmt as ReturnStatement).getExpression();
                if (retExpr && isEffectCallee(retExpr.getText(), getAliasesForFile(sourceFile), sourceFile)) {
                  const analyzed = yield* analyzeEffectExpression(
                    retExpr,
                    sourceFile,
                    filePath,
                    opts,
                    warnings,
                    stats,
                    undefined,
                  );
                  innerNodes.push(analyzed);
                }
              } else if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
                const expr = (stmt as ExpressionStatement).getExpression();
                if (
                  expr.getKind() === SyntaxKind.CallExpression &&
                  isEffectLikeCallExpression(expr as CallExpression, sourceFile, getAliasesForFile(sourceFile), opts.knownEffectInternalsRoot)
                ) {
                  const analyzed = yield* analyzeEffectExpression(
                    expr,
                    sourceFile,
                    filePath,
                    opts,
                    warnings,
                    stats,
                    undefined,
                  );
                  innerNodes.push(analyzed);
                }
              }
            }
          } else {
            if (isEffectCallee(body.getText(), getAliasesForFile(sourceFile), sourceFile)) {
              const analyzed = yield* analyzeEffectExpression(
                body,
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
                undefined,
              );
              innerNodes.push(analyzed);
            }
          }
        }
        if (innerNodes.length > 0) callbackBody = innerNodes;

        // Effect.async/asyncEffect: resume/canceller patterns (GAP async callback interop)
        if (
          callee.includes('Effect.async') ||
          callee.includes('Effect.asyncEffect') ||
          callee.includes('Effect.callback')
        ) {
          const resumeParamName =
            fn.getParameters()[0]?.getName?.() ?? 'resume';
          let resumeCallCount = 0;
          const visit = (node: Node) => {
            if (node.getKind() === SyntaxKind.CallExpression) {
              const callNode = node as CallExpression;
              const expr = callNode.getExpression();
              if (
                expr.getKind() === SyntaxKind.Identifier &&
                (expr as Identifier).getText() === resumeParamName
              ) {
                resumeCallCount++;
              }
            }
            node.getChildren().forEach(visit);
          };
          if (body) visit(body);
          let returnsCanceller = false;
          if (body?.getKind() === SyntaxKind.Block) {
            const block = body as Block;
            for (const stmt of block.getStatements()) {
              if (stmt.getKind() === SyntaxKind.ReturnStatement) {
                const retExpr = (stmt as ReturnStatement).getExpression();
                if (retExpr) {
                  const k = retExpr.getKind();
                  if (
                    k === SyntaxKind.ArrowFunction ||
                    k === SyntaxKind.FunctionExpression
                  ) {
                    returnsCanceller = true;
                    break;
                  }
                }
              }
            }
          } else if (
            body &&
            (body.getKind() === SyntaxKind.ArrowFunction ||
              body.getKind() === SyntaxKind.FunctionExpression)
          ) {
            returnsCanceller = true;
          }
          asyncCallback = {
            resumeParamName,
            resumeCallCount,
            returnsCanceller,
          };

          if (callee.includes('Effect.callback')) {
            const handlerSummaries = yield* summarizeNamedCallbackHandlers(
              fn,
              sourceFile,
              filePath,
              opts,
              warnings,
              stats,
              resumeParamName,
            );
            if (handlerSummaries && handlerSummaries.length > 0) {
              callbackBody = handlerSummaries;
            }
          }
        }
      }
    }

    if (call.getExpression().getKind() === SyntaxKind.PropertyAccessExpression) {
      const propAccess = call.getExpression() as PropertyAccessExpression;
      if (propAccess.getName() === 'use') {
        const callbackArg = call.getArguments().find(
          (arg) =>
            arg.getKind() === SyntaxKind.ArrowFunction ||
            arg.getKind() === SyntaxKind.FunctionExpression,
        );
        if (callbackArg) {
          const callbackFn = callbackArg as ArrowFunction | FunctionExpression;
          const callbackNodes = buildCallbackSummaryNodes(
            callbackFn,
            filePath,
            opts.includeLocations ?? false,
          );
          if (callbackNodes) {
            callbackBody = [...(callbackBody ?? []), ...callbackNodes];
          }
          const wrapperExpr = propAccess.getExpression().getText();
          usePattern = {
            wrapperName: serviceScope?.get(wrapperExpr) ?? wrapperExpr,
            callbackKind: classifyUseCallbackKind(callbackFn),
          };
        }
      }
    }

    // Extract JSDoc from the call statement
    const effectJSDoc = extractJSDocDescription(call);

    // Extract type signature and service requirements
    const typeChecker = sourceFile.getProject().getTypeChecker();
    const typeSignature = extractEffectTypeSignature(call, typeChecker);
    const requiredServices = extractServiceRequirements(call, typeChecker);

    // Try to identify service method calls
    const serviceCall = tryResolveServiceCall(call, sourceFile);

    // Resolve serviceMethod from generator scope or requiredServices fallback
    let serviceMethod: StaticEffectNode['serviceMethod'];
    const expr = call.getExpression();
    if (expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression) {
      const propAccess = expr as PropertyAccessExpression;
      const objectText = propAccess.getExpression().getText();
      const methodName = propAccess.getName();
      if (serviceScope) {
        const serviceId = serviceScope.get(objectText);
        if (serviceId) serviceMethod = { serviceId, methodName };
      }
      if (!serviceMethod && requiredServices?.length === 1 && requiredServices[0]) {
        serviceMethod = { serviceId: requiredServices[0].serviceId, methodName };
      }
    }

    // Effect.provide: infer provideKind from context arg (GAP 6: Runtime vs Layer/Context)
    // Two forms: Effect.provide(effect, layer) → 2 args, layer is args[1]; pipe(effect, Effect.provide(layer)) → 1 arg, layer is args[0]
    let provideKind: StaticEffectNode['provideKind'];
    if (
      callee === 'Effect.provide' ||
      (callee.startsWith('Effect.') && callee.includes('.provide') && !callee.includes('provideService'))
    ) {
      const args = call.getArguments();
      const contextArgText = (args.length >= 2 ? args[1] : args[0])?.getText() ?? '';
      if (
        /Runtime\.|defaultRuntime|\.runSync|\.runPromise|\.runFork|\.runCallback/.test(contextArgText) ||
        /^\s*runtime\s*$|^\s*rt\s*$/i.test(contextArgText.trim())
      ) {
        provideKind = 'runtime';
      } else if (contextArgText.includes('Layer.')) {
        provideKind = 'layer';
      } else {
        provideKind = 'context';
      }
    }

    // Determine constructorKind
    let constructorKind: StaticEffectNode['constructorKind'];
    if (callee.endsWith('.sync') || callee.endsWith('.succeed') || callee.endsWith('.fail') || callee.endsWith('.try') || callee.endsWith('.suspend')) constructorKind = 'sync';
    else if (callee.endsWith('.promise')) constructorKind = 'promise';
    else if (callee.endsWith('.async') || callee.endsWith('.asyncEffect')) constructorKind = 'async';
    else if (callee.endsWith('.callback')) constructorKind = 'callback';
    else if (callee.endsWith('.never')) constructorKind = 'never';
    else if (callee.endsWith('.void')) constructorKind = 'void';
    else if (callee.endsWith('.fromNullable')) constructorKind = 'fromNullable';
    else if (callee.endsWith('.fn')) constructorKind = 'fn';
    else if (callee.endsWith('.fnUntraced')) constructorKind = 'fnUntraced';

    // Extract FiberRef built-in name
    let fiberRefName: string | undefined;
    const KNOWN_FIBER_REFS = ['currentConcurrency', 'currentLogLevel', 'currentScheduler', 'currentTracerEnabled', 'currentLogSpan', 'currentLogAnnotations', 'currentContext', 'currentRequestBatching', 'currentMaxOpsBeforeYield', 'currentSupervisor', 'currentMetricLabels', 'interruptedCause', 'unhandledLogLevel'] as const;
    for (const refName of KNOWN_FIBER_REFS) {
      if (callee.includes(refName)) { fiberRefName = refName; break; }
    }

    // Extract Effect.fn traced name
    let tracedName: string | undefined;
    if (constructorKind === 'fn' || constructorKind === 'fnUntraced') {
      const args = call.getArguments();
      if (args.length > 0) {
        const firstArg = args[0]!.getText();
        const strMatch = /^["'`](.+?)["'`]$/.exec(firstArg);
        if (strMatch) tracedName = strMatch[1];
      }
    }

    if (
      constructorKind === undefined &&
      call.getExpression().getKind() === loadTsMorph().SyntaxKind.CallExpression
    ) {
      const innerCall = call.getExpression() as CallExpression;
      const innerCallee = innerCall.getExpression().getText();
      if (innerCallee.endsWith('.fn') || innerCallee.endsWith('.fnUntraced')) {
        constructorKind = innerCallee.endsWith('.fnUntraced') ? 'fnUntraced' : 'fn';
        const fnArgs = innerCall.getArguments();
        if (fnArgs.length > 0) {
          const firstArg = fnArgs[0]!.getText();
          const strMatch = /^["'`](.+?)["'`]$/.exec(firstArg);
          if (strMatch) tracedName = strMatch[1];
        }
      }
    }

    const filteredRequiredServices = requiredServices?.filter(
      (service) => !isEffectRuntimePrimitive(service.serviceId),
    );

    const effectNode: StaticEffectNode = {
      id: generateId(),
      type: 'effect',
      callee: normalizedCallee,
      description: usePattern
        ? `use-pattern (${usePattern.callbackKind})`
        : serviceCall
          ? 'service-call'
          : getSemanticDescriptionWithAliases(normalizedCallee, getAliasesForFile(sourceFile)),
      location,
      jsdocDescription: effectJSDoc,
      jsdocTags: extractJSDocTags(call),
      typeSignature,
      requiredServices: filteredRequiredServices,
      serviceCall,
      serviceMethod,
      ...(usePattern ? { usePattern } : {}),
      callbackBody,
      ...(asyncCallback ? { asyncCallback } : {}),
      ...(provideKind ? { provideKind } : {}),
      ...(constructorKind ? { constructorKind } : {}),
      ...(fiberRefName ? { fiberRefName } : {}),
      ...(tracedName ? { tracedName } : {}),
    };
    const enrichedEffectNode: StaticEffectNode = {
      ...effectNode,
      displayName: computeDisplayName(effectNode),
      semanticRole: computeSemanticRole(effectNode),
    };
    return enrichedEffectNode;
  });

/**
 * Try to resolve a service method call from a CallExpression.
 * Returns metadata if the callee is `obj.method()` where `obj` has a
 * known, non-built-in type — indicating a yielded service method call.
 */
const tryResolveServiceCall = (
  call: CallExpression,
  sourceFile: SourceFile,
): StaticEffectNode['serviceCall'] => {
  const { SyntaxKind } = loadTsMorph();
  const expr = call.getExpression();

  // Must be a property access (obj.method form)
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return undefined;

  const propAccess = expr as PropertyAccessExpression;
  const objExpr = propAccess.getExpression();
  const methodName = propAccess.getName();
  const objectName = objExpr.getText();

  // Skip if first segment is a known Effect/JS namespace (resolve aliases first)
  const firstSegment = objectName.split('.')[0] ?? objectName;
  if (KNOWN_EFFECT_NAMESPACES.has(firstSegment)) return undefined;
  // Resolve aliases: e.g. "M" -> "Match", "S" -> "Schema"
  const normalized = normalizeEffectCallee(objectName, sourceFile);
  const normalizedFirstSegment = normalized.split('.')[0] ?? normalized;
  if (KNOWN_EFFECT_NAMESPACES.has(normalizedFirstSegment)) return undefined;

  try {
    const type = objExpr.getType();
    const symbol = type.getSymbol() ?? type.getAliasSymbol();
    if (!symbol) return undefined;

    const typeName = symbol.getName();
    // Skip anonymous structural types, built-ins, and error sentinels
    if (
      !typeName ||
      typeName === '__type' ||
      typeName === 'unknown' ||
      typeName === 'any' ||
      BUILT_IN_TYPE_NAMES.has(typeName)
    ) {
      return undefined;
    }

    return { serviceType: typeName, methodName, objectName };
  } catch {
    return undefined;
  }
};

// =============================================================================
// Specific Pattern Analysis
// =============================================================================


const analyzeLayerCall = (
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticLayerNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    const operations: StaticFlowNode[] = [];
    const { SyntaxKind } = loadTsMorph();

    if (args.length > 0 && args[0]) {
      const firstArg = args[0];
      const isMergeAll =
        callee.includes('mergeAll') &&
        firstArg.getKind() === SyntaxKind.ArrayLiteralExpression;

      if (isMergeAll) {
        const elements = (
          firstArg as ArrayLiteralExpression
        ).getElements();
        for (const elem of elements) {
          const analyzed = yield* analyzeEffectExpression(
            elem,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
          operations.push(analyzed);
        }
      } else {
        for (const arg of args) {
          if (!arg) continue;
          const toAnalyze = resolveIdentifierToLayerInitializer(arg);
          const argSourceFile = toAnalyze.getSourceFile();
          const analyzed = yield* analyzeEffectExpression(
            toAnalyze,
            argSourceFile,
            argSourceFile.getFilePath(),
            opts,
            warnings,
            stats,
          );
          operations.push(analyzed);
        }
      }
    }

    const isMerged =
      callee.includes('merge') || callee.includes('mergeAll');

    let lifecycle: LayerLifecycle | undefined;
    if (callee.includes('fresh')) lifecycle = 'fresh';
    else if (callee.includes('memoize')) lifecycle = 'memoized';
    else if (callee.includes('scoped')) lifecycle = 'scoped';
    else lifecycle = 'default';

    // Layer error-handling / utility ops — track as semantic description on the node
    // These don't change the primitive provides/requires but are important to detect:
    // catchAll, orDie, orElse, retry, tap, mapError, build, launch, toRuntime,
    // passthrough, project, flatMap, flatten, annotateLogs, annotateSpans,
    // setConfigProvider, setClock, setTracer, locally, withSpan

    const provides: string[] = [];
    // Helper: extract one or more tag names from an arg.
    const extractTagNames = (node: Node): string[] => {
      if (node.getKind() === SyntaxKind.ArrayLiteralExpression) {
        const items = (node as ArrayLiteralExpression).getElements();
        return items.flatMap((item) => extractTagNames(item));
      }
      if (node.getKind() === SyntaxKind.CallExpression) {
        const callNode = node as CallExpression;
        const callExpr = callNode.getExpression().getText();
        if (callExpr.startsWith('Layer.') && callNode.getArguments().length > 0) {
          const first = callNode.getArguments()[0];
          if (first) return extractTagNames(first);
        }
      }
      if (node.getKind() === SyntaxKind.Identifier) {
        return [(node as Identifier).getText()];
      }
      if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
        // e.g. SomeService.Default → 'SomeService'
        const pae = node as PropertyAccessExpression;
        const obj = pae.getExpression();
        if (obj.getKind() === SyntaxKind.Identifier) {
          return [(obj as Identifier).getText()];
        }
        return [pae.getText().split('.')[0] ?? pae.getText()];
      }
      return [];
    };

    // Layer.succeed(Tag, value) / Layer.sync(Tag, fn) / Layer.effect(Tag, eff) / Layer.scoped(Tag, eff)
    if (
      (callee.includes('succeed') || callee.includes('sync') ||
       callee.includes('effect') || callee.includes('scoped') ||
       callee.includes('scopedDiscard') || callee.includes('effectDiscard')) &&
      args.length > 0 && args[0]
    ) {
      provides.push(...extractTagNames(args[0]));
    }
    // Layer.provide / Layer.provideMerge — method call: outerLayer.pipe(Layer.provide(innerLayer))
    // In this case, callee is Layer.provide or Layer.provideMerge
    // The first arg is the layer being provided (i.e., the dependency)
    const isProvideCall = callee.includes('provide') && !callee.includes('provideService');

    const requiresSet = new Set<string>();
    // If this is Layer.provide(dep) [1-arg curried], dep's tag is what we're injecting
    if (isProvideCall && args.length >= 1 && args[0]) {
      for (const depName of extractTagNames(args[0])) {
        requiresSet.add(depName);
      }
    }
    // If this is Layer.provide(base, dep) [2-arg], dep is injected into base
    if (isProvideCall && args.length >= 2 && args[1]) {
      for (const depName of extractTagNames(args[1])) {
        requiresSet.add(depName);
      }
      // The provides of the composed layer come from base (args[0])
      const baseArg = args[0];
      if (baseArg) provides.push(...extractTagNames(baseArg));
    }
    // Layer.provideService(tag, value) — provides a service inline
    if (callee.includes('provideService') && args.length > 0 && args[0]) {
      provides.push(...extractTagNames(args[0]));
    }
    const collectRequires = (node: StaticFlowNode): void => {
      if (node.type === 'effect') {
        const eff = node;
        for (const req of eff.requiredServices ?? []) {
          requiresSet.add(req.serviceId);
        }
        const calleeText = eff.callee ?? '';
        if (
          /^[A-Z][A-Za-z0-9_]*(Service|Tag)$/.test(calleeText) ||
          calleeText.endsWith('.Tag')
        ) {
          requiresSet.add(calleeText);
        }
      } else if (node.type === 'layer') {
        const layer = node;
        for (const r of layer.requires ?? []) {
          requiresSet.add(r);
        }
      }
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      children.forEach(collectRequires);
    };
    operations.forEach(collectRequires);

    // Fallback: Layer type RIn extraction when requires is empty (GAP Layer requires)
    if (requiresSet.size === 0) {
      try {
        const layerSig = extractLayerTypeSignature(call);
        if (layerSig?.requiredType && layerSig.requiredType !== 'never') {
          const ids = parseServiceIdsFromContextType(layerSig.requiredType);
          ids.forEach((id) => requiresSet.add(id));
        }
      } catch {
        // type extraction can fail
      }
    }

    // Extract a semantic name for utility Layer ops
    const layerOpName = callee.replace(/^Layer\./, '').replace(/^[a-zA-Z]+\./, '');
    const UTILITY_LAYER_OPS = new Set([
      'catchAll', 'catchAllCause', 'orDie', 'orElse', 'retry', 'tap',
      'mapError', 'mapErrorCause', 'build', 'launch', 'toRuntime',
      'passthrough', 'project', 'flatMap', 'flatten', 'annotateLogs',
      'annotateSpans', 'setConfigProvider', 'setClock', 'setTracer',
      'locally', 'withSpan', 'withLogger', 'withTracer', 'withClock',
      'mock', 'suspend', 'unwrapEffect', 'unwrapScoped',
    ]);
    let layerName = UTILITY_LAYER_OPS.has(layerOpName) ? `Layer.${layerOpName}` : undefined;
    if (layerOpName === 'unwrapEffect' && operations.some((op) => op.type === 'generator')) {
      layerName = 'Layer.unwrapEffect(gen)';
    }

    // GAP Layer.MemoMap: dedicated memo-map analysis
    const isMemoMap =
      callee.includes('MemoMap') ||
      operations.some(
        (op) => op.type === 'layer' && (op).isMemoMap === true,
      );

    const layerNode: StaticLayerNode = {
      id: generateId(),
      type: 'layer',
      name: layerName,
      operations,
      isMerged,
      provides: provides.length > 0 ? provides : undefined,
      requires: requiresSet.size > 0 ? Array.from(requiresSet).sort() : undefined,
      lifecycle,
      ...(isMemoMap ? { isMemoMap: true } : {}),
      location: extractLocation(
        call,
        filePath,
        opts.includeLocations ?? false,
      ),
    };
    return {
      ...layerNode,
      displayName: computeDisplayName(layerNode),
      semanticRole: computeSemanticRole(layerNode),
    };
  });



