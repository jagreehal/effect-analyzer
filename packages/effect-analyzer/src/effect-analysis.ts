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
  VariableDeclaration,
  ArrayLiteralExpression,
  NumericLiteral,
  StringLiteral,
  MethodDeclaration,
  ImportSpecifier,
  VariableStatement,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type { AnalysisError, AnalyzerOptions, AnalysisWarning, AnalysisStats } from './types';
import type {
  StaticFlowNode,
  StaticEffectNode,
  StaticPipeNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticErrorHandlerNode,
  StaticRetryNode,
  StaticTimeoutNode,
  StaticResourceNode,
  StaticConditionalNode,
  StaticLoopNode,
  StaticMatchNode,
  StaticCauseNode,
  StaticExitNode,
  StaticScheduleNode,
  StaticTransformNode,
  StaticLayerNode,
  StaticStreamNode,
  StaticChannelNode,
  StaticSinkNode,
  StaticConcurrencyPrimitiveNode,
  StaticFiberNode,
  StaticInterruptionNode,
  StaticUnknownNode,
  ConcurrencyMode,
  LayerLifecycle,
  StreamOperatorInfo,
  ChannelOperatorInfo,
  SinkOperatorInfo,
  ScheduleInfo,
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
  getNodeText,
  computeDisplayName,
  computeSemanticRole,
} from './analysis-utils';
import {
  ERROR_HANDLER_PATTERNS,
  CONDITIONAL_PATTERNS,
  COLLECTION_PATTERNS,
  FIBER_PATTERNS,
  INTERRUPTION_PATTERNS,
  TRANSFORM_OPS,
  EFFECTFUL_TRANSFORMS,
  isTransformCall,
  MATCH_OP_MAP,
  EXHAUSTIVE_OPS,
  isMatchCall,
  CAUSE_OP_MAP,
  CAUSE_CONSTRUCTORS,
  isCauseCall,
  EXIT_OP_MAP,
  EXIT_CONSTRUCTORS,
  isExitCall,
  SCHEDULE_OP_MAP,
  isScheduleCall,
  getSemanticDescriptionWithAliases,
  parseServiceIdsFromContextType,
  getNumericLiteralFromNode,
  BUILT_IN_TYPE_NAMES,
  KNOWN_EFFECT_NAMESPACES,
} from './analysis-patterns';
import {
  getAliasesForFile,
  isEffectCallee,
  isEffectLikeCallExpression,
  normalizeEffectCallee,
  resolveBarrelSourceFile,
  resolveModulePath,
} from './alias-resolution';
export const analyzePipeChain = (
  node: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
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
        );
        transformations.push(analyzed);
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
      transformations,
      ...(typeFlow ? { typeFlow } : {}),
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

      const unknownNode: StaticUnknownNode = {
        id: generateId(),
        type: 'unknown',
        reason: 'Function does not return an Effect expression',
        sourceCode: node.getText().slice(0, 100),
        location: extractLocation(node, filePath, opts.includeLocations ?? false),
      };
      stats.unknownCount++;
      return unknownNode;
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
      if (isEffectCallee(text, getAliasesForFile(sourceFile), sourceFile)) {
        const effectNode: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee: text,
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

    // pipe(base, ...fns) inside generator → analyze as pipe chain so transformations (e.g. RcRef.update) are classified
    if (callee === 'pipe' && call.getArguments().length >= 1) {
      const nodes = yield* analyzePipeChain(
        call,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
      if (nodes.length > 0 && nodes[0]) return nodes[0];
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

    if (normalizedCallee.startsWith('Stream.')) {
      return yield* analyzeStreamCall(
        call,
        normalizedCallee,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
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

    if (CONDITIONAL_PATTERNS.some((pattern) => callee.includes(pattern))) {
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

    if (COLLECTION_PATTERNS.some((pattern) => callee.includes(pattern))) {
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
    const CONSTRUCTOR_CALLBACK_CALLEES = [
      'Effect.sync',
      'Effect.promise',
      'Effect.async',
      'Effect.asyncEffect',
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
        if (callee.includes('Effect.async') || callee.includes('Effect.asyncEffect')) {
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

    const effectNode: StaticEffectNode = {
      id: generateId(),
      type: 'effect',
      callee,
      description: serviceCall ? 'service-call' : getSemanticDescriptionWithAliases(callee, getAliasesForFile(sourceFile)),
      location,
      jsdocDescription: effectJSDoc,
      jsdocTags: extractJSDocTags(call),
      typeSignature,
      requiredServices,
      serviceCall,
      serviceMethod,
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
  _sourceFile: SourceFile,
): StaticEffectNode['serviceCall'] => {
  const { SyntaxKind } = loadTsMorph();
  const expr = call.getExpression();

  // Must be a property access (obj.method form)
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return undefined;

  const propAccess = expr as PropertyAccessExpression;
  const objExpr = propAccess.getExpression();
  const methodName = propAccess.getName();
  const objectName = objExpr.getText();

  // Skip if first segment is a known Effect/JS namespace
  const firstSegment = objectName.split('.')[0] ?? objectName;
  if (KNOWN_EFFECT_NAMESPACES.has(firstSegment)) return undefined;

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

/** Return true if the call expression text (e.g. "Layer.succeed" or "L.succeed") is a Layer or Effect initializer. */
function isLayerOrEffectInitializerCallee(initCall: CallExpression): boolean {
  const initText = initCall.getExpression().getText();
  const srcFile = initCall.getSourceFile();
  const normalized = normalizeEffectCallee(initText, srcFile);
  return (
    normalized.startsWith('Layer.') ||
    normalized.startsWith('Effect.') ||
    initText === 'pipe' ||
    initText.endsWith('.pipe')
  );
}

/**
 * Resolve a Layer initializer from a cross-file import by resolving the target module
 * and looking up the exported declaration. Used when symbol alias resolution doesn't
 * yield a VariableDeclaration (e.g. project created without tsconfig).
 */
function resolveLayerInitializerFromImport(
  ident: Identifier,
  importSpec: ImportSpecifier,
  isLayerInit: (call: CallExpression) => boolean,
): CallExpression | undefined {
  const { SyntaxKind } = loadTsMorph();
  const sourceFile = ident.getSourceFile();
  const project = sourceFile.getProject();
  const currentPath = sourceFile.getFilePath();
  const importDecl = importSpec.getImportDeclaration();
  const specifier = importDecl.getModuleSpecifierValue();
  if (!specifier?.startsWith('.')) return undefined;
  let targetFile = resolveBarrelSourceFile(project, currentPath, specifier);
  if (!targetFile) {
    const resolvedPath = resolveModulePath(currentPath, specifier);
    if (resolvedPath) {
      const added = project.addSourceFileAtPath(resolvedPath);
      if (added) targetFile = added;
    }
  }
  if (!targetFile) return undefined;
  // Ensure we use the project’s instance so alias resolution sees the same file
  targetFile = project.getSourceFile(targetFile.getFilePath()) ?? targetFile;
  const tryDecl = (d: Node): CallExpression | undefined => {
    if (d.getKind() === SyntaxKind.VariableDeclaration) {
      const v = d as VariableDeclaration;
      const init = v.getInitializer();
      if (init?.getKind() === SyntaxKind.CallExpression && isLayerInit(init as CallExpression)) {
        return init as CallExpression;
      }
    }
    if (d.getKind() === SyntaxKind.VariableStatement) {
      const list = (d as VariableStatement).getDeclarationList();
      for (const v of list.getDeclarations()) {
        const init = v.getInitializer();
        if (init?.getKind() === SyntaxKind.CallExpression && isLayerInit(init as CallExpression)) {
          return init as CallExpression;
        }
      }
    }
    return undefined;
  };
  const exportName = importSpec.getName();
  const exported = targetFile.getExportedDeclarations();
  const decls = exported.get(exportName) ?? [];
  for (const d of decls) {
    const init = tryDecl(d);
    if (init) return init;
  }
  const targetName = (importSpec as { getTargetName?: () => string }).getTargetName?.();
  if (targetName && targetName !== exportName) {
    for (const d of exported.get(targetName) ?? []) {
      const init = tryDecl(d);
      if (init) return init;
    }
  }
  // Fallback: scan all exports (key may differ from import name in some ts-morph versions)
  for (const [, declList] of exported) {
    for (const d of declList) {
      const init = tryDecl(d);
      if (init) return init;
    }
  }
  return undefined;
}

function resolveLayerInitializerFromDefaultImport(
  ident: Identifier,
  importDecl: { getModuleSpecifierValue: () => string },
  isLayerInit: (call: CallExpression) => boolean,
): CallExpression | undefined {
  const { SyntaxKind } = loadTsMorph();
  const sourceFile = ident.getSourceFile();
  const project = sourceFile.getProject();
  const currentPath = sourceFile.getFilePath();
  const specifier = importDecl.getModuleSpecifierValue();
  if (!specifier?.startsWith('.')) return undefined;
  let targetFile = resolveBarrelSourceFile(project, currentPath, specifier);
  if (!targetFile) {
    const resolvedPath = resolveModulePath(currentPath, specifier);
    if (resolvedPath) {
      const added = project.addSourceFileAtPath(resolvedPath);
      if (added) targetFile = added;
    }
  }
  if (!targetFile) return undefined;
  targetFile = project.getSourceFile(targetFile.getFilePath()) ?? targetFile;
  const tryDecl = (d: Node): CallExpression | undefined => {
    if (d.getKind() === SyntaxKind.VariableDeclaration) {
      const v = d as VariableDeclaration;
      const init = v.getInitializer();
      if (init?.getKind() === SyntaxKind.CallExpression && isLayerInit(init as CallExpression)) {
        return init as CallExpression;
      }
    }
    if (d.getKind() === SyntaxKind.VariableStatement) {
      const list = (d as VariableStatement).getDeclarationList();
      for (const v of list.getDeclarations()) {
        const init = v.getInitializer();
        if (init?.getKind() === SyntaxKind.CallExpression && isLayerInit(init as CallExpression)) {
          return init as CallExpression;
        }
      }
    }
    return undefined;
  };
  for (const d of targetFile.getDefaultExportSymbol()?.getDeclarations() ?? []) {
    const init = tryDecl(d);
    if (init) return init;
  }
  for (const d of targetFile.getExportedDeclarations().get('default') ?? []) {
    const init = tryDecl(d);
    if (init) return init;
  }
  return undefined;
}

/** If node is an Identifier bound to a variable whose initializer is a Layer.* call, return that initializer; else return node. (GAP: pipe-chain base variable + cross-file.) */
function resolveIdentifierToLayerInitializer(node: Node): Node {
  const { SyntaxKind } = loadTsMorph();
  if (node.getKind() !== SyntaxKind.Identifier) return node;
  const ident = node as Identifier;
  const name = ident.getText();
  let sym = ident.getSymbol();
  let decl = sym?.getValueDeclaration();
  let importSpec: ImportSpecifier | undefined =
    decl?.getKind() === SyntaxKind.ImportSpecifier ? (decl as ImportSpecifier) : undefined;
  if (!importSpec && sym) {
    const fromDecls = sym.getDeclarations().find((d) => d.getKind() === SyntaxKind.ImportSpecifier);
    if (fromDecls) importSpec = fromDecls as ImportSpecifier;
  }
  if (!importSpec) {
    const sf = ident.getSourceFile();
    for (const id of sf.getImportDeclarations()) {
      const defaultImport = id.getDefaultImport()?.getText();
      if (defaultImport === name) {
        const fromDefault = resolveLayerInitializerFromDefaultImport(
          ident,
          id,
          isLayerOrEffectInitializerCallee,
        );
        if (fromDefault) return fromDefault;
      }
      const spec = id
        .getNamedImports()
        .find((n) => n.getName() === name || n.getAliasNode()?.getText() === name);
      if (spec) {
        importSpec = spec;
        break;
      }
    }
  }
  // Cross-file: when the binding is an import, resolve via the target module first so we get
  // a node in the target file (alias resolution for L→Layer needs that file’s SourceFile).
  if (importSpec) {
    const fromImport = resolveLayerInitializerFromImport(
      ident,
      importSpec,
      isLayerOrEffectInitializerCallee,
    );
    if (fromImport) return fromImport;
    sym = sym?.getImmediatelyAliasedSymbol() ?? sym?.getAliasedSymbol();
    decl = sym?.getValueDeclaration();
  }
  // Also follow alias if valueDeclaration is an export specifier (re-export)
  if (decl?.getKind() === SyntaxKind.ExportSpecifier) {
    sym = sym?.getImmediatelyAliasedSymbol() ?? sym?.getAliasedSymbol();
    decl = sym?.getValueDeclaration();
  }
  // Fallback: search all declarations for a VariableDeclaration with Layer initializer (cross-module)
  if (sym && decl?.getKind() !== SyntaxKind.VariableDeclaration) {
    for (const d of sym.getDeclarations()) {
      if (d.getKind() === SyntaxKind.VariableDeclaration) {
        const v = d as VariableDeclaration;
        const init = v.getInitializer();
        if (init?.getKind() === SyntaxKind.CallExpression) {
          if (isLayerOrEffectInitializerCallee(init as CallExpression)) {
            return init;
          }
        }
      }
    }
  }
  if (decl?.getKind() === SyntaxKind.VariableDeclaration) {
    const vd = decl as VariableDeclaration;
    const init = vd.getInitializer();
    if (init?.getKind() === SyntaxKind.CallExpression) {
      if (isLayerOrEffectInitializerCallee(init as CallExpression)) {
        return init;
      }
    }
  }
  return node;
}

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
    // Helper: extract a tag name from an arg (Identifier or PropertyAccessExpression)
    const extractTagName = (node: Node): string | undefined => {
      if (node.getKind() === SyntaxKind.Identifier) {
        return (node as Identifier).getText();
      }
      if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
        // e.g. SomeService.Default → 'SomeService'
        const pae = node as PropertyAccessExpression;
        const obj = pae.getExpression();
        if (obj.getKind() === SyntaxKind.Identifier) {
          return (obj as Identifier).getText();
        }
        return pae.getText().split('.')[0];
      }
      return undefined;
    };

    // Layer.succeed(Tag, value) / Layer.sync(Tag, fn) / Layer.effect(Tag, eff) / Layer.scoped(Tag, eff)
    if (
      (callee.includes('succeed') || callee.includes('sync') ||
       callee.includes('effect') || callee.includes('scoped') ||
       callee.includes('scopedDiscard') || callee.includes('effectDiscard')) &&
      args.length > 0 && args[0]
    ) {
      const tag = extractTagName(args[0]);
      if (tag) provides.push(tag);
    }
    // Layer.provide / Layer.provideMerge — method call: outerLayer.pipe(Layer.provide(innerLayer))
    // In this case, callee is Layer.provide or Layer.provideMerge
    // The first arg is the layer being provided (i.e., the dependency)
    const isProvideCall = callee.includes('provide') && !callee.includes('provideService');

    const requiresSet = new Set<string>();
    // If this is Layer.provide(dep) [1-arg curried], dep's tag is what we're injecting
    if (isProvideCall && args.length >= 1 && args[0]) {
      const depName = extractTagName(args[0]);
      if (depName) requiresSet.add(depName);
    }
    // If this is Layer.provide(base, dep) [2-arg], dep is injected into base
    if (isProvideCall && args.length >= 2 && args[1]) {
      const depName = extractTagName(args[1]);
      if (depName) requiresSet.add(depName);
      // The provides of the composed layer come from base (args[0])
      const baseName = extractTagName(args[0]!);
      if (baseName) provides.push(baseName);
    }
    // Layer.provideService(tag, value) — provides a service inline
    if (callee.includes('provideService') && args.length > 0 && args[0]) {
      const tag = extractTagName(args[0]);
      if (tag) provides.push(tag);
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
    const layerName = UTILITY_LAYER_OPS.has(layerOpName) ? `Layer.${layerOpName}` : undefined;

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

/** Parse Stream.* call into StaticStreamNode (GAP 5). */
function analyzeStreamCall(
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticStreamNode, AnalysisError> {
  return Effect.gen(function* () {
    const args = call.getArguments();
    let source: StaticFlowNode;
    if (args.length > 0 && args[0]) {
      source = yield* analyzeEffectExpression(
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

/** Classify Channel.* operation (improve.md §8). */
function channelOpCategory(op: string): ChannelOperatorInfo['category'] {
  if (op === 'fromReadableStream' || op === 'fromWritableStream' || op === 'fromDuplexStream' || op === 'make' || op === 'succeed' || op === 'fail' || op === 'empty' || op === 'never') return 'constructor';
  if (op.includes('map') || op.includes('flatMap') || op.includes('filter') || op.includes('concat') || op.includes('zip')) return 'transform';
  if (op.includes('pipe') || op === 'pipeTo' || op === 'pipeThrough') return 'pipe';
  return 'other';
}

/** Parse Channel.* call into StaticChannelNode (improve.md §8). */
function analyzeChannelCall(
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
      source = yield* analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats);
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

/** Classify Sink.* operation (improve.md §8). */
function sinkOpCategory(op: string): SinkOperatorInfo['category'] {
  if (op === 'forEach' || op === 'forEachWhile' || op === 'run' || op === 'runDrain' || op === 'runFor' || op === 'make' || op === 'fromEffect' || op === 'fromQueue') return 'constructor';
  if (op.includes('map') || op.includes('contramap') || op.includes('filter') || op.includes('zip')) return 'transform';
  return 'other';
}

/** Parse Sink.* call into StaticSinkNode (improve.md §8). */
function analyzeSinkCall(
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
      source = yield* analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats);
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

/** Parse concurrency primitive (Queue, PubSub, Deferred, etc.) - GAP 6 */
function analyzeConcurrencyPrimitiveCall(
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
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
  if ((primitive === 'mailbox' && operation === 'toStream') ||
      (primitive === 'subscriptionRef' && operation === 'changes')) {
    const constructorType = primitive === 'mailbox' ? 'fromMailbox' as const : 'fromSubscriptionRef' as const;
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
        displayName: computeDisplayName(innerPrimNode as StaticConcurrencyPrimitiveNode),
        semanticRole: computeSemanticRole(innerPrimNode as StaticConcurrencyPrimitiveNode),
      } as StaticConcurrencyPrimitiveNode,
      pipeline: [],
      constructorType,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    } as StaticStreamNode;
    return Effect.succeed({
      ...streamNode,
      displayName: computeDisplayName(streamNode),
      semanticRole: computeSemanticRole(streamNode),
    } as StaticStreamNode);
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
function analyzeFiberCall(
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
    let operation: StaticFiberNode['operation'] = 'fork';
    let isScoped = false;
    let isDaemon = false;
    let fiberSource: StaticFlowNode | undefined;

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

    if ((operation === 'fork' || operation === 'forkScoped' || operation === 'forkDaemon' || operation === 'forkAll' || operation === 'forkIn' || operation === 'forkWithErrorHandler') && args.length > 0 && args[0]) {
      fiberSource = yield* analyzeEffectExpression(
        args[0],
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
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
function analyzeInterruptionCall(
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
      source = yield* analyzeEffectExpression(propAccess.getExpression(), sourceFile, filePath, opts, warnings, stats);
      if (args.length > 0 && args[0]) {
        handler = yield* analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats);
      }
    } else if (args.length > 0 && args[0]) {
      source = yield* analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats);
      if (args.length > 1 && args[1]) {
        handler = yield* analyzeEffectExpression(args[1], sourceFile, filePath, opts, warnings, stats);
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

/** Parse Effect.all options object: concurrency, batching, discard (GAP 18) */
function parseEffectAllOptions(
  optionsNode: ObjectLiteralExpression,
): {
  concurrency: ConcurrencyMode | undefined;
  batching: boolean | undefined;
  discard: boolean | undefined;
} {
  const { SyntaxKind } = loadTsMorph();
  let concurrency: ConcurrencyMode | undefined;
  let batching: boolean | undefined;
  let discard: boolean | undefined;
  for (const prop of optionsNode.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const name = (prop as PropertyAssignment)
      .getNameNode()
      .getText();
    const init = (prop as PropertyAssignment).getInitializer();
    if (!init) continue;
    const text = init.getText();
    if (name === 'concurrency') {
      if (text === '"unbounded"' || text === "'unbounded'") concurrency = 'unbounded';
      else if (text === '"sequential"' || text === "'sequential'") concurrency = 'sequential';
      else if (text === '"inherit"' || text === "'inherit'") concurrency = 'sequential';
      else {
        const n = Number.parseInt(text, 10);
        if (!Number.isNaN(n) && n >= 0) concurrency = n;
      }
    } else if (name === 'batching' && (text === 'true' || text === 'false')) {
      batching = text === 'true';
    } else if (name === 'discard' && (text === 'true' || text === 'false')) {
      discard = text === 'true';
    }
  }
  return { concurrency, batching, discard };
}

const analyzeParallelCall = (
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticParallelNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    const children: StaticFlowNode[] = [];
    const { SyntaxKind } = loadTsMorph();

    // First argument: array of effects or object with effect properties
    if (args.length > 0 && args[0]) {
      const firstArg = args[0];

      if (firstArg.getKind() === SyntaxKind.ArrayLiteralExpression) {
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
          children.push(analyzed);
        }
      } else if (firstArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
        const props = (
          firstArg as ObjectLiteralExpression
        ).getProperties();
        for (const prop of props) {
          if (prop.getKind() === SyntaxKind.PropertyAssignment) {
            const initializer = (
              prop as PropertyAssignment
            ).getInitializer();
            if (initializer) {
              const analyzed = yield* analyzeEffectExpression(
                initializer,
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
              );
              children.push(analyzed);
            }
          }
        }
      }
    }

    // Second argument: options { concurrency, batching, discard } (GAP 18)
    let concurrency: ConcurrencyMode | undefined;
    let batching: boolean | undefined;
    let discard: boolean | undefined;
    if (args.length > 1 && args[1]?.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const parsed = parseEffectAllOptions(
        args[1] as ObjectLiteralExpression,
      );
      concurrency = parsed.concurrency;
      batching = parsed.batching;
      discard = parsed.discard;
    }

    const mode = callee.includes('Par') ? 'parallel' : 'sequential';
    if (concurrency === undefined) {
      concurrency = mode === 'parallel' ? 'unbounded' : 'sequential';
    }

    stats.parallelCount++;

    const branchLabels = children.map((child) => computeDisplayName(child));
    const parallelNode: StaticParallelNode = {
      id: generateId(),
      type: 'parallel',
      callee,
      mode,
      children,
      concurrency,
      batching,
      discard,
      branchLabels,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...parallelNode,
      displayName: computeDisplayName(parallelNode),
      semanticRole: computeSemanticRole(parallelNode),
    };
  });

const analyzeRaceCall = (
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticRaceNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    const children: StaticFlowNode[] = [];

    for (const arg of args) {
      if (arg) {
        const analyzed = yield* analyzeEffectExpression(
          arg,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        children.push(analyzed);
      }
    }

    stats.raceCount++;

    const raceLabels = children.map((child) => computeDisplayName(child));
    const raceNode: StaticRaceNode = {
      id: generateId(),
      type: 'race',
      callee,
      children,
      raceLabels,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...raceNode,
      displayName: computeDisplayName(raceNode),
      semanticRole: computeSemanticRole(raceNode),
    };
  });

const analyzeErrorHandlerCall = (
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
      source = yield* analyzeEffectExpression(
        exprSource,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );

      // Handler is the first argument
      if (args.length > 0 && args[0]) {
        handler = yield* analyzeEffectExpression(
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
        source = yield* analyzeEffectExpression(
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
        handler = yield* analyzeEffectExpression(
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
          .filter((p) => p.getKind() === loadTsMorph().SyntaxKind.PropertyAssignment || p.getKind() === loadTsMorph().SyntaxKind.MethodDeclaration)
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
      errorEdgeLabel: errorTag ? `on ${errorTag}` : errorTags && errorTags.length > 0 ? `on ${errorTags.join(' | ')}` : 'on error',
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...handlerNode,
      displayName: computeDisplayName(handlerNode),
      semanticRole: computeSemanticRole(handlerNode),
    };
  });

const analyzeRetryCall = (
  call: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticRetryNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    let source: StaticFlowNode;
    let schedule: string | undefined;
    let scheduleNode: StaticFlowNode | undefined;
    let hasFallback: boolean;

    // Similar logic to error handlers for determining source
    const expr = call.getExpression();
    if (expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression) {
      const propAccess = expr as PropertyAccessExpression;
      const exprSource = propAccess.getExpression();
      source = yield* analyzeEffectExpression(
        exprSource,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );

      if (args.length > 0 && args[0]) {
        schedule = args[0].getText();
        scheduleNode = yield* analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      }

      hasFallback = expr.getText().includes('retryOrElse');
    } else {
      if (args.length > 0 && args[0]) {
        source = yield* analyzeEffectExpression(
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
        schedule = args[1].getText();
        scheduleNode = yield* analyzeEffectExpression(
          args[1],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      }

      hasFallback = args.length > 2;
    }

    stats.retryCount++;

    const scheduleInfo = schedule ? parseScheduleInfo(schedule) : undefined;

    const retryNode: StaticRetryNode = {
      id: generateId(),
      type: 'retry',
      source,
      schedule,
      ...(scheduleNode !== undefined ? { scheduleNode } : {}),
      hasFallback,
      scheduleInfo,
      retryEdgeLabel: schedule ? `retry: ${schedule}` : 'retry',
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...retryNode,
      displayName: computeDisplayName(retryNode),
      semanticRole: computeSemanticRole(retryNode),
    };
  });

/** Parse schedule expression text into ScheduleInfo (GAP 8). */
function parseScheduleInfo(scheduleText: string): ScheduleInfo | undefined {
  const t = scheduleText.replace(/\s+/g, ' ');
  let baseStrategy: ScheduleInfo['baseStrategy'] = 'custom';
  if (t.includes('Schedule.exponential') || t.includes('exponential(')) baseStrategy = 'exponential';
  else if (t.includes('Schedule.fibonacci') || t.includes('fibonacci(')) baseStrategy = 'fibonacci';
  else if (t.includes('Schedule.spaced') || t.includes('spaced(')) baseStrategy = 'spaced';
  else if (t.includes('Schedule.fixed') || t.includes('fixed(')) baseStrategy = 'fixed';
  else if (t.includes('Schedule.linear') || t.includes('linear(')) baseStrategy = 'linear';
  else if (t.includes('Schedule.cron') || t.includes('cron(')) baseStrategy = 'cron';
  else if (t.includes('Schedule.windowed') || t.includes('windowed(')) baseStrategy = 'windowed';
  else if (t.includes('Schedule.duration') || t.includes('duration(')) baseStrategy = 'duration';
  else if (t.includes('Schedule.elapsed') || t.includes('elapsed(')) baseStrategy = 'elapsed';
  else if (t.includes('Schedule.delays') || t.includes('delays(')) baseStrategy = 'delays';
  else if (t.includes('Schedule.once') || t.includes('once(')) baseStrategy = 'once';
  else if (t.includes('Schedule.stop') || t.includes('stop(')) baseStrategy = 'stop';
  else if (t.includes('Schedule.count') || t.includes('count(')) baseStrategy = 'count';

  let maxRetries: number | 'unlimited' | undefined;
  const recursMatch = /recurs\s*\(\s*(\d+)\s*\)/.exec(t);
  if (recursMatch) maxRetries = Number.parseInt(recursMatch[1]!, 10);
  const recurUpToMatch = /recurUpTo\s*\(\s*(\d+)\s*\)/.exec(t);
  if (recurUpToMatch) maxRetries = Number.parseInt(recurUpToMatch[1]!, 10);
  else if (t.includes('forever') || t.includes('Schedule.forever')) maxRetries = 'unlimited';

  const jittered = t.includes('jittered') || t.includes('Schedule.jittered');
  const conditions: string[] = [];
  if (t.includes('whileInput')) conditions.push('whileInput');
  if (t.includes('whileOutput')) conditions.push('whileOutput');
  if (t.includes('untilInput')) conditions.push('untilInput');
  if (t.includes('untilOutput')) conditions.push('untilOutput');
  if (t.includes('recurUntil')) conditions.push('recurUntil');
  if (t.includes('recurWhile')) conditions.push('recurWhile');
  if (t.includes('andThen')) conditions.push('andThen');
  if (t.includes('intersect')) conditions.push('intersect');
  if (t.includes('union')) conditions.push('union');
  if (t.includes('compose')) conditions.push('compose');
  if (t.includes('zipWith')) conditions.push('zipWith');
  if (t.includes('addDelay')) conditions.push('addDelay');
  if (t.includes('modifyDelay')) conditions.push('modifyDelay');
  if (t.includes('check')) conditions.push('check');
  if (t.includes('resetAfter')) conditions.push('resetAfter');
  if (t.includes('resetWhen')) conditions.push('resetWhen');
  if (t.includes('ensure')) conditions.push('ensure');
  if (t.includes('driver')) conditions.push('driver');
  if (t.includes('mapInput')) conditions.push('mapInput');

  return {
    baseStrategy,
    maxRetries,
    jittered,
    conditions,
  };
}

const analyzeTimeoutCall = (
  call: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticTimeoutNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    let source: StaticFlowNode;
    let duration: string | undefined;
    let hasFallback: boolean;

    const expr = call.getExpression();
    if (expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression) {
      const propAccess = expr as PropertyAccessExpression;
      const exprSource = propAccess.getExpression();
      source = yield* analyzeEffectExpression(
        exprSource,
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );

      if (args.length > 0 && args[0]) {
        duration = getNodeText(args[0]);
      }

      const exprText = getNodeText(expr);
      hasFallback =
        exprText.includes('timeoutFail') ||
        exprText.includes('timeoutTo');
    } else {
      if (args.length > 0 && args[0]) {
        source = yield* analyzeEffectExpression(
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
        duration = getNodeText(args[1]);
      }

      hasFallback = args.length > 2;
    }

    stats.timeoutCount++;

    const timeoutNode: StaticTimeoutNode = {
      id: generateId(),
      type: 'timeout',
      source,
      duration,
      hasFallback,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...timeoutNode,
      displayName: computeDisplayName(timeoutNode),
      semanticRole: computeSemanticRole(timeoutNode),
    };
  });

const analyzeResourceCall = (
  call: CallExpression,
  callee: string,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<StaticResourceNode, AnalysisError> =>
  Effect.gen(function* () {
    const args = call.getArguments();
    const resourceOperation = (/([A-Za-z_$][\w$]*)$/.exec(callee))?.[1] ?? callee;
    let acquire: StaticFlowNode;
    let release: StaticFlowNode;
    let useEffect: StaticFlowNode | undefined;

    if (resourceOperation.startsWith('acquireUseRelease')) {
      // acquireUseRelease / acquireUseReleaseInterruptible (acquire, use, release) — 3-arg form
      if (args.length >= 3 && args[0] && args[2]) {
        acquire = yield* analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        release = yield* analyzeEffectExpression(
          args[2],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        if (args[1]) {
          useEffect = yield* analyzeEffectExpression(
            args[1],
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
        }
      } else {
        acquire = { id: generateId(), type: 'unknown', reason: 'Missing acquire' };
        release = { id: generateId(), type: 'unknown', reason: 'Missing release' };
      }
    } else if (resourceOperation.startsWith('acquireRelease')) {
      // acquireRelease / acquireReleaseInterruptible (acquire, release) — 2-arg form
      if (args.length >= 2 && args[0] && args[1]) {
        acquire = yield* analyzeEffectExpression(
          args[0],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        release = yield* analyzeEffectExpression(
          args[1],
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      } else {
        acquire = {
          id: generateId(),
          type: 'unknown',
          reason: 'Missing acquire',
        };
        release = {
          id: generateId(),
          type: 'unknown',
          reason: 'Missing release',
        };
      }
    } else if (
      resourceOperation === 'addFinalizer' ||
      resourceOperation === 'onExit' ||
      resourceOperation === 'onError' ||
      resourceOperation === 'parallelFinalizers' ||
      resourceOperation === 'sequentialFinalizers' ||
      resourceOperation === 'finalizersMask' ||
      resourceOperation === 'using' ||
      resourceOperation === 'withEarlyRelease'
    ) {
      // Finalizer/cleanup patterns — acquire is the surrounding effect (method chain) or unknown
      const expr = call.getExpression();
      if (expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression) {
        const propAccess = expr as PropertyAccessExpression;
        acquire = yield* analyzeEffectExpression(
          propAccess.getExpression(),
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      } else {
        acquire = { id: generateId(), type: 'unknown', reason: 'Scoped acquire' };
      }
      release = args.length > 0 && args[0]
        ? yield* analyzeEffectExpression(args[0], sourceFile, filePath, opts, warnings, stats)
        : { id: generateId(), type: 'unknown', reason: 'Missing finalizer' };
    } else if (resourceOperation === 'ensuring') {
      // Effect.ensuring(effect, cleanup)
      const expr = call.getExpression();
      if (
        expr.getKind() === loadTsMorph().SyntaxKind.PropertyAccessExpression
      ) {
        const propAccess = expr as PropertyAccessExpression;
        const exprSource = propAccess.getExpression();
        acquire = yield* analyzeEffectExpression(
          exprSource,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        release =
          args.length > 0 && args[0]
            ? yield* analyzeEffectExpression(
                args[0],
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
              )
            : { id: generateId(), type: 'unknown', reason: 'Missing cleanup' };
      } else {
        acquire =
          args.length > 0 && args[0]
            ? yield* analyzeEffectExpression(
                args[0],
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
              )
            : { id: generateId(), type: 'unknown', reason: 'Missing effect' };
        release =
          args.length > 1 && args[1]
            ? yield* analyzeEffectExpression(
                args[1],
                sourceFile,
                filePath,
                opts,
                warnings,
                stats,
              )
            : { id: generateId(), type: 'unknown', reason: 'Missing cleanup' };
      }
    } else {
      acquire = {
        id: generateId(),
        type: 'unknown',
        reason: 'Unknown resource pattern',
      };
      release = {
        id: generateId(),
        type: 'unknown',
        reason: 'Unknown resource pattern',
      };
    }

    stats.resourceCount++;

    const resourceNode: StaticResourceNode = {
      id: generateId(),
      type: 'resource',
      acquire,
      release,
      use: useEffect,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...resourceNode,
      displayName: computeDisplayName(resourceNode),
      semanticRole: computeSemanticRole(resourceNode),
    };
  });

const analyzeConditionalCall = (
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
          const props = (
            secondArg as ObjectLiteralExpression
          ).getProperties();
          for (const prop of props) {
            if (prop.getKind() === SyntaxKind.PropertyAssignment) {
              const propAssign = prop as PropertyAssignment;
              const name = propAssign.getName();
              const init = propAssign.getInitializer();

              if (init) {
                if (name === 'onTrue') {
                  onTrue = yield* analyzeEffectExpression(
                    init,
                    sourceFile,
                    filePath,
                    opts,
                    warnings,
                    stats,
                  );
                } else if (name === 'onFalse') {
                  onFalse = yield* analyzeEffectExpression(
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
          onTrue = yield* analyzeEffectExpression(
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

const analyzeLoopCall = (
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

    // reduce/reduceRight/reduceEffect(iterable, initial, reducer) use body at index 2; others (forEach, filter, ...) at index 1
    const bodyArgIndex =
      loopType === 'reduce' ||
      callee.includes('reduceRight') ||
      callee.includes('reduceWhile') ||
      callee.includes('reduceEffect')
        ? 2
        : 1;

    let iterSource: string | undefined;
    let body: StaticFlowNode;

    if (args.length > 0 && args[0]) {
      iterSource = args[0].getText();
    }

    if (args.length > bodyArgIndex && args[bodyArgIndex]) {
      body = yield* analyzeEffectExpression(
        args[bodyArgIndex],
        sourceFile,
        filePath,
        opts,
        warnings,
        stats,
      );
    } else {
      body = {
        id: generateId(),
        type: 'unknown',
        reason: 'Could not determine loop body',
      };
    }

    stats.loopCount++;

    const loopNode: StaticLoopNode = {
      id: generateId(),
      type: 'loop',
      loopType,
      iterSource,
      body,
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...loopNode,
      displayName: computeDisplayName(loopNode),
      semanticRole: computeSemanticRole(loopNode),
    };
  });

/** Analyze Match.type / Match.when / Match.tag / Match.exhaustive etc. */
const analyzeMatchCall = (
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
const analyzeCauseCall = (
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
          const child = yield* analyzeEffectExpression(
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
        .map(c => c.causeKind)
        .filter((k): k is NonNullable<typeof k> => k !== undefined);
      if (childKinds.length > 0) {
        causeKind = childKinds.every(k => k === childKinds[0]) ? childKinds[0] : 'mixed';
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
const analyzeExitCall = (
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

/** Analyze Schedule.exponential / spaced / jittered / andThen / etc. (GAP 8 dedicated IR). */
const analyzeScheduleCall = (
  call: CallExpression,
  callee: string,
  filePath: string,
  opts: Required<AnalyzerOptions>,
): Effect.Effect<StaticScheduleNode, AnalysisError> =>
  Effect.sync(() => {
    const scheduleOp: StaticScheduleNode['scheduleOp'] =
      SCHEDULE_OP_MAP[callee] ?? 'other';
    const scheduleText = call.getText();
    const scheduleInfo = parseScheduleInfo(scheduleText);
    const scheduleNode: StaticScheduleNode = {
      id: generateId(),
      type: 'schedule',
      scheduleOp,
      ...(scheduleInfo ? { scheduleInfo } : {}),
      location: extractLocation(call, filePath, opts.includeLocations ?? false),
    };
    return {
      ...scheduleNode,
      displayName: computeDisplayName(scheduleNode),
      semanticRole: computeSemanticRole(scheduleNode),
    };
  });

/** Analyze Effect.map / flatMap / andThen / tap / zip / as / flatten etc. */
const analyzeTransformCall = (
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
      source = yield* analyzeEffectExpression(
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
      // Curried — single arg is the function
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
