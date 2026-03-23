/**
 * Core program analysis: analyzeProgram, analyzeProgramNode,
 * analyzeGeneratorFunction, analyzeRunEntrypointExpression.
 */

import { Effect, Option } from 'effect';
import type {
  SourceFile,
  Node,
  CallExpression,
  FunctionDeclaration,
  VariableDeclaration,
  ClassDeclaration,
  PropertyDeclaration,
  MethodDeclaration,
  GetAccessorDeclaration,
  StringLiteral,
  NumericLiteral,
  ParenthesizedExpression,
  ObjectLiteralExpression,
  PropertyAssignment,
  ArrayLiteralExpression,
  YieldExpression,
  ExpressionStatement,
  VariableStatement,
  IfStatement,
  SwitchStatement,
  CaseClause,
  ForStatement,
  ForOfStatement,
  ForInStatement,
  WhileStatement,
  DoStatement,
  TryStatement,
  ReturnStatement,
  ThrowStatement,
  LabeledStatement,
  Block,
  ConditionalExpression,
  BinaryExpression,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type {
  StaticEffectIR,
  StaticEffectProgram,
  StaticFlowNode,
  StaticEffectNode,
  StaticGeneratorNode,
  StaticDecisionNode,
  StaticSwitchNode,
  StaticSwitchCase,
  StaticTryCatchNode,
  StaticTerminalNode,
  StaticOpaqueNode,
  StaticLoopNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticRetryNode,
  AnalysisError,
  AnalyzerOptions,
  AnalysisWarning,
  AnalysisStats,
} from './types';
import {
  extractEffectTypeSignature,
  extractServiceRequirements,
} from './type-extractor';
import type { EffectProgram } from './analysis-utils';
import {
  createEmptyStats,
  generateId,
  extractLocation,
  collectDependencies,
  collectErrorTypes,
  getJSDocFromParentVariable,
  extractJSDocDescription,
  extractJSDocTags,
  extractYieldVariableName,
  computeDisplayName,
  computeSemanticRole,
} from './analysis-utils';
import { isServiceTagCallee } from './analysis-patterns';
import { getAliasesForFile, isEffectLikeCallExpression } from './alias-resolution';
import {
  extractServiceDefinitionsFromFile,
  getWorkflowBodyNodeForRunCall,
} from './program-discovery';
import {
  analyzePipeChain,
  analyzeEffectExpression,
  analyzeEffectCall,
} from './effect-analysis';

// =============================================================================
// Program Analysis
// =============================================================================

export const analyzeProgram = (
  program: EffectProgram,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  tsVersion: string,
): Effect.Effect<StaticEffectIR, AnalysisError> =>
  Effect.gen(function* () {
    const warnings: AnalysisWarning[] = [];
    const stats = createEmptyStats();

    const children = yield* analyzeProgramNode(
      program.node,
      program.type,
      sourceFile,
      filePath,
      opts,
      warnings,
      stats,
    );

    const programJSDoc = getJSDocFromParentVariable(program.node);

    const typeChecker = sourceFile.getProject().getTypeChecker();
    const typeSignature = extractEffectTypeSignature(program.node, typeChecker);
    const requiredServices = extractServiceRequirements(program.node, typeChecker);

    const root: StaticEffectProgram = {
      id: generateId(),
      type: 'program',
      programName: program.name,
      source: program.type,
      ...(program.discoveryConfidence
        ? { discoveryConfidence: program.discoveryConfidence }
        : {}),
      ...(program.discoveryReason ? { discoveryReason: program.discoveryReason } : {}),
      children,
      dependencies: collectDependencies(children),
      errorTypes: collectErrorTypes(children),
      typeSignature,
      requiredServices,
      location: extractLocation(
        program.node,
        filePath,
        opts.includeLocations ?? false,
      ),
      jsdocDescription: programJSDoc,
      jsdocTags: extractJSDocTags(program.node),
    };

    const serviceDefinitions = extractServiceDefinitionsFromFile(sourceFile);
    return {
      root,
      metadata: {
        analyzedAt: Date.now(),
        filePath,
        tsVersion,
        warnings,
        stats,
        ...(serviceDefinitions.length > 0 ? { serviceDefinitions } : {}),
      },
      references: new Map(),
    };
  });

// =============================================================================
// Node Analysis
// =============================================================================

export const analyzeProgramNode = (
  node: Node,
  programType: EffectProgram['type'],
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<readonly StaticFlowNode[], AnalysisError> =>
  Effect.gen(function* () {
    switch (programType) {
      case 'generator': {
        const args = (node as CallExpression).getArguments();
        if (args.length > 0 && args[0]) {
          const genFn = args[0];
          return yield* analyzeGeneratorFunction(
            genFn,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
        }
        return [];
      }

      case 'pipe': {
        return yield* analyzePipeChain(
          node as CallExpression,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
      }

      case 'run': {
        const call = node as CallExpression;
        const { SyntaxKind } = loadTsMorph();
        const pipeResult = yield* analyzeRunEntrypointExpression(
          call,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
        );
        if (Option.isSome(pipeResult)) {
          return pipeResult.value;
        }

        const args = call.getArguments();
        const callbackInArgs = args.find(
          (arg) =>
            arg.getKind() === SyntaxKind.ArrowFunction ||
            arg.getKind() === SyntaxKind.FunctionExpression,
        );
        const workflowBody =
          opts.enableEffectWorkflow &&
          callbackInArgs === undefined &&
          args.length === 1
            ? getWorkflowBodyNodeForRunCall(call, sourceFile)
            : null;
        const effect = callbackInArgs ?? workflowBody ?? args[0];
        if (effect) {
          const analyzed = yield* analyzeEffectExpression(
            effect,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
          return [analyzed];
        }
        return [];
      }

      case 'workflow-execute': {
        const call = node as CallExpression;
        const exprText = call.getExpression().getText();
        const syntheticNode: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee: exprText,
          name: exprText,
          semanticRole: 'side-effect',
          location: extractLocation(call, filePath, opts.includeLocations ?? false),
        };
        return [syntheticNode];
      }

      case 'direct': {
        const initializer = (node as VariableDeclaration).getInitializer();
        if (initializer) {
          // Detect Effect.fn("name")(function* () { ... }) curried call pattern
          const { SyntaxKind: SK } = loadTsMorph();
          if (initializer.getKind() === SK.CallExpression) {
            const outerCall = initializer as CallExpression;
            const outerExpr = outerCall.getExpression();
            // Check if the outer expression is itself a call to Effect.fn/Effect.fnUntraced
            if (outerExpr.getKind() === SK.CallExpression) {
              const innerCall = outerExpr as CallExpression;
              const innerCallee = innerCall.getExpression().getText();
              if (innerCallee.endsWith('.fn') || innerCallee.endsWith('.fnUntraced')) {
                // The generator function is the first argument of the outer call
                const outerArgs = outerCall.getArguments();
                const genArg = outerArgs.find(
                  (arg) =>
                    arg.getKind() === SK.FunctionExpression ||
                    arg.getKind() === SK.ArrowFunction,
                );
                if (genArg) {
                  // Extract traced name from Effect.fn("name")
                  const fnArgs = innerCall.getArguments();
                  let tracedName: string | undefined;
                  if (fnArgs.length > 0) {
                    const firstArg = fnArgs[0]?.getText() ?? '';
                    const strMatch = /^["'`](.+?)["'`]$/.exec(firstArg);
                    if (strMatch) tracedName = strMatch[1];
                  }
                  const constructorKind = innerCallee.endsWith('.fnUntraced') ? 'fnUntraced' as const : 'fn' as const;

                  // Create Effect.fn metadata node preserving constructor info
                  const fnMetaNode: StaticEffectNode = {
                    id: generateId(),
                    type: 'effect',
                    callee: innerCallee,
                    location: extractLocation(innerCall, filePath, opts.includeLocations ?? false),
                    constructorKind,
                    ...(tracedName ? { tracedName } : {}),
                  };
                  stats.totalEffects++;
                  const enrichedFnNode: StaticEffectNode = {
                    ...fnMetaNode,
                    displayName: computeDisplayName(fnMetaNode),
                    semanticRole: computeSemanticRole(fnMetaNode),
                  };

                  // Analyze the generator body
                  const genChildren = yield* analyzeGeneratorFunction(
                    genArg,
                    sourceFile,
                    filePath,
                    opts,
                    warnings,
                    stats,
                  );

                  return [enrichedFnNode, ...genChildren];
                }
              }
            }
          }
          const analyzed = yield* analyzeEffectExpression(
            initializer,
            sourceFile,
            filePath,
            opts,
            warnings,
            stats,
          );
          return [analyzed];
        }
        return [];
      }

      case 'class': {
        const classDecl = node as ClassDeclaration;
        let callee = 'Data.Class';
        for (const clause of classDecl.getHeritageClauses()) {
          const clauseText = clause.getText();
          if (clauseText.includes('Data.TaggedError')) { callee = 'Data.TaggedError'; break; }
          if (clauseText.includes('Data.TaggedClass')) { callee = 'Data.TaggedClass'; break; }
          if (clauseText.includes('Data.Error')) { callee = 'Data.Error'; break; }
          if (clauseText.includes('Schema.TaggedRequest')) { callee = 'Schema.TaggedRequest'; break; }
          if (clauseText.includes('Schema.TaggedError')) { callee = 'Schema.TaggedError'; break; }
          if (clauseText.includes('Schema.TaggedClass')) { callee = 'Schema.TaggedClass'; break; }
          if (clauseText.includes('Schema.Class')) { callee = 'Schema.Class'; break; }
          if (clauseText.includes('Context.Tag')) { callee = 'Context.Tag'; break; }
          if (clauseText.includes('Context.Reference')) { callee = 'Context.Reference'; break; }
          if (clauseText.includes('Effect.Service')) { callee = 'Effect.Service'; break; }
        }
        const description =
          callee.includes('Error') ? 'error-type' :
          callee.includes('Schema') ? 'schema' :
          callee === 'Context.Tag' || callee === 'Context.Reference' || callee === 'Effect.Service' ? 'service-tag' :
          'data';
        const classEffectNode: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee,
          description,
          location: extractLocation(node, filePath, opts.includeLocations ?? false),
          jsdocDescription: extractJSDocDescription(classDecl),
          jsdocTags: extractJSDocTags(classDecl),
        };
        stats.totalEffects++;
        return [classEffectNode];
      }

      case 'classProperty': {
        const prop = node as PropertyDeclaration;
        const initializer = prop.getInitializer();
        if (initializer) {
          const result = yield* analyzeEffectExpression(
            initializer, sourceFile, filePath, opts, warnings, stats,
          );
          return [result];
        }
        return [];
      }

      case 'classMethod': {
        const method = node as MethodDeclaration | GetAccessorDeclaration;
        const body = method.getBody();
        if (!body) return [];

        const { SyntaxKind: SK } = loadTsMorph();
        const returnStatements = body.getDescendantsOfKind(SK.ReturnStatement);
        const children: StaticFlowNode[] = [];
        for (const ret of returnStatements) {
          const expr = (ret).getExpression();
          if (expr) {
            const result = yield* analyzeEffectExpression(
              expr, sourceFile, filePath, opts, warnings, stats,
            );
            children.push(result);
          }
        }
        return children;
      }

      case 'functionDeclaration': {
        const fnDecl = node as FunctionDeclaration;
        const body = fnDecl.getBody();
        if (!body) return [];

        const { SyntaxKind: SK2 } = loadTsMorph();
        const returnStatements = body.getDescendantsOfKind(SK2.ReturnStatement);
        const children: StaticFlowNode[] = [];
        for (const ret of returnStatements) {
          const expr = (ret).getExpression();
          if (expr) {
            const result = yield* analyzeEffectExpression(
              expr, sourceFile, filePath, opts, warnings, stats,
            );
            children.push(result);
          }
        }
        return children;
      }

      default:
        return [];
    }
  });

// =============================================================================
// Statement-Level Walker Helpers
// =============================================================================

/**
 * Check if a node is a function boundary that should NOT be descended into
 * when searching for generator yields.
 */
function isFunctionBoundary(node: Node): boolean {
  const { SyntaxKind } = loadTsMorph();
  const kind = node.getKind();
  return (
    kind === SyntaxKind.FunctionDeclaration ||
    kind === SyntaxKind.FunctionExpression ||
    kind === SyntaxKind.ArrowFunction ||
    kind === SyntaxKind.MethodDeclaration ||
    kind === SyntaxKind.ClassDeclaration ||
    kind === SyntaxKind.ClassExpression ||
    kind === SyntaxKind.Constructor
  );
}

/**
 * Boundary-aware check: does `node` contain (or is itself) a YieldExpression
 * without crossing into nested function/class bodies?
 */
function containsGeneratorYield(node: Node): boolean {
  const { SyntaxKind } = loadTsMorph();
  // Check the node itself first
  if (node.getKind() === SyntaxKind.YieldExpression) return true;
  let found = false;
  node.forEachChild((child) => {
    if (found) return;
    if (isFunctionBoundary(child)) return; // SKIP nested functions
    if (child.getKind() === SyntaxKind.YieldExpression) {
      found = true;
      return;
    }
    if (containsGeneratorYield(child)) {
      found = true;
      return;
    }
  });
  return found;
}

/**
 * Extract a literal value from an expression node if it's a simple literal.
 * Returns the string representation or undefined if not a literal.
 */
function extractLiteralValue(expr: Node): string | undefined {
  const { SyntaxKind } = loadTsMorph();
  const kind = expr.getKind();
  switch (kind) {
    case SyntaxKind.StringLiteral:
      return (expr as StringLiteral).getLiteralValue();
    case SyntaxKind.NumericLiteral:
      return (expr as NumericLiteral).getLiteralValue().toString();
    case SyntaxKind.TrueKeyword:
      return 'true';
    case SyntaxKind.FalseKeyword:
      return 'false';
    case SyntaxKind.NullKeyword:
      return 'null';
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return expr.getText().replace(/^`|`$/g, '');
    default:
      return undefined;
  }
}

/**
 * Resolve const values in a condition string by substituting known const identifiers.
 */
function resolveConditionConsts(condition: string, constValues: Map<string, string>): string {
  if (constValues.size === 0) return condition;
  let resolved = condition;
  for (const [name, value] of constValues) {
    // Replace standalone identifier references (word boundary) with the resolved value
    const pattern = new RegExp(`\\b${name}\\b`, 'g');
    const replacement = /^\d/.test(value) || value === 'true' || value === 'false' || value === 'null'
      ? value
      : `'${value}'`;
    resolved = resolved.replace(pattern, replacement);
  }
  return resolved;
}

/**
 * Simplify boolean expressions: true && X → X, false || X → X, etc.
 */
function simplifyBooleanExpression(expr: string): string {
  let result = expr;
  // true && X → X
  result = result.replace(/\btrue\b\s*&&\s*/g, '');
  result = result.replace(/\s*&&\s*\btrue\b/g, '');
  // false || X → X
  result = result.replace(/\bfalse\b\s*\|\|\s*/g, '');
  result = result.replace(/\s*\|\|\s*\bfalse\b/g, '');
  // false && X → false
  result = result.replace(/\bfalse\b\s*&&\s*[^|&]+/g, 'false');
  // true || X → true
  result = result.replace(/\btrue\b\s*\|\|\s*[^|&]+/g, 'true');
  return result.trim();
}

/**
 * Unwrap TypeScript expression wrappers: parenthesized, as, non-null, satisfies, type assertion.
 */
function unwrapExpression(expr: Node): Node {
  const { SyntaxKind } = loadTsMorph();
  const kind = expr.getKind();
  switch (kind) {
    case SyntaxKind.ParenthesizedExpression:
    case SyntaxKind.AsExpression:
    case SyntaxKind.TypeAssertionExpression:
    case SyntaxKind.NonNullExpression:
    case SyntaxKind.SatisfiesExpression: {
      const inner = (expr as ParenthesizedExpression).getExpression();
      return unwrapExpression(inner);
    }
    default:
      return expr;
  }
}

/**
 * Check if a statement has a terminator (break/return/throw/continue) at the end.
 */
function hasTerminatorStatement(stmts: readonly Node[]): boolean {
  const { SyntaxKind } = loadTsMorph();
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  if (!last) return false;
  const kind = last.getKind();
  return (
    kind === SyntaxKind.ReturnStatement ||
    kind === SyntaxKind.ThrowStatement ||
    kind === SyntaxKind.BreakStatement ||
    kind === SyntaxKind.ContinueStatement
  );
}

/**
 * Collect all yield* expressions from a node in depth-first left-to-right order,
 * respecting function boundaries.
 */
function collectYieldExpressionsDF(node: Node): Node[] {
  const { SyntaxKind } = loadTsMorph();
  const results: Node[] = [];
  node.forEachChild((child) => {
    if (isFunctionBoundary(child)) return;
    if (child.getKind() === SyntaxKind.YieldExpression) {
      results.push(child);
    } else {
      results.push(...collectYieldExpressionsDF(child));
    }
  });
  return results;
}

// =============================================================================
// effect-flow Step.* Detection Helpers
// =============================================================================

/** Known Step.* function names from the effect-flow library. */
const STEP_FUNCTIONS = new Set([
  'Step.run', 'Step.decide', 'Step.branch', 'Step.all',
  'Step.forEach', 'Step.retry', 'Step.race', 'Step.sleep',
]);

/**
 * Check if a node is a CallExpression whose callee matches `Step.*` patterns.
 */
function isStepCall(node: Node): boolean {
  const { SyntaxKind } = loadTsMorph();
  if (node.getKind() !== SyntaxKind.CallExpression) return false;
  const callee = (node as CallExpression).getExpression().getText();
  return STEP_FUNCTIONS.has(callee);
}

/**
 * Extract the string literal text from a node, or undefined if not a string literal.
 */
function extractStringLiteral(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const { SyntaxKind } = loadTsMorph();
  if (node.getKind() === SyntaxKind.StringLiteral) {
    return (node as StringLiteral).getLiteralText();
  }
  return undefined;
}

/**
 * Parse an ObjectLiteralExpression into StaticSwitchCase[] for Step.branch cases.
 */
function parseBranchCases(casesObj: Node | undefined): StaticSwitchCase[] {
  if (!casesObj) return [];
  const { SyntaxKind } = loadTsMorph();
  if (casesObj.getKind() !== SyntaxKind.ObjectLiteralExpression) return [];
  const cases: StaticSwitchCase[] = [];
  const objLit = casesObj as ObjectLiteralExpression;
  for (const prop of objLit.getProperties()) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      const name = (prop as PropertyAssignment).getName();
      cases.push({
        labels: [name],
        isDefault: name === 'default',
        body: [], // The effect in the property value would need deep analysis
      });
    }
  }
  return cases;
}

/**
 * Analyze a Step.* call expression and produce enriched IR nodes.
 * Only called when `ctx.opts.enableEffectFlow` is true.
 */
function analyzeStepCall(
  callExpr: CallExpression,
  ctx: WalkerContext,
): Effect.Effect<StaticFlowNode, AnalysisError> {
  return Effect.gen(function* () {
    const { SyntaxKind } = loadTsMorph();
    const callee = callExpr.getExpression().getText();
    const args = callExpr.getArguments();

    switch (callee) {
      case 'Step.run': {
        // Step.run(id, effect) -> analyze the inner effect, enrich with step ID
        const stepId = extractStringLiteral(args[0]);
        const innerEffect = args[1];
        if (!innerEffect) {
          const node: StaticEffectNode = {
            id: generateId(),
            type: 'effect',
            callee: 'Step.run',
            name: stepId,
            displayName: stepId,
          };
          ctx.stats.totalEffects++;
          return node;
        }
        const analyzed = yield* analyzeEffectExpression(
          innerEffect,
          ctx.sourceFile,
          ctx.filePath,
          ctx.opts,
          ctx.warnings,
          ctx.stats,
          ctx.serviceScope,
        );
        return {
          ...analyzed,
          displayName: stepId ?? analyzed.displayName,
          name: stepId ?? analyzed.name,
        };
      }

      case 'Step.decide': {
        // Step.decide(id, label, conditionEffect) -> StaticDecisionNode
        const stepId = extractStringLiteral(args[0]);
        const label = extractStringLiteral(args[1]);
        ctx.stats.decisionCount++;
        const decisionNode: StaticDecisionNode = {
          id: generateId(),
          type: 'decision',
          decisionId: stepId ?? generateId(),
          label: label ?? stepId ?? 'decision',
          condition: args[2]?.getText() ?? 'unknown',
          source: 'effect-flow',
          onTrue: [],   // The if/else around it captures branches
          onFalse: undefined,
        };
        return decisionNode;
      }

      case 'Step.branch': {
        // Step.branch(id, expression, cases) -> StaticSwitchNode
        const stepId = extractStringLiteral(args[0]);
        const expression = args[1]?.getText() ?? 'unknown';
        const casesObj = args[2];
        const cases = parseBranchCases(casesObj);
        ctx.stats.switchCount++;
        const switchNode: StaticSwitchNode = {
          id: generateId(),
          type: 'switch',
          switchId: stepId,
          expression,
          cases,
          source: 'effect-flow',
          hasDefault: cases.some((c) => c.isDefault),
          hasFallthrough: false,
        };
        return switchNode;
      }

      case 'Step.all': {
        // Step.all(id, effects) -> StaticParallelNode with enriched name
        const stepId = extractStringLiteral(args[0]);
        const effectsArg = args[1];
        const children: StaticFlowNode[] = [];
        if (effectsArg?.getKind() === SyntaxKind.ArrayLiteralExpression) {
          const arrayLit = effectsArg as ArrayLiteralExpression;
          for (const element of arrayLit.getElements()) {
            const analyzed = yield* analyzeEffectExpression(
              element,
              ctx.sourceFile,
              ctx.filePath,
              ctx.opts,
              ctx.warnings,
              ctx.stats,
              ctx.serviceScope,
            );
            children.push(analyzed);
          }
        }
        ctx.stats.parallelCount++;
        const parallelNode: StaticParallelNode = {
          id: generateId(),
          type: 'parallel',
          name: stepId,
          displayName: stepId,
          children,
          mode: 'parallel',
          callee: 'Step.all',
        };
        return parallelNode;
      }

      case 'Step.forEach': {
        // Step.forEach(id, items, fn) -> StaticLoopNode with enriched name
        const stepId = extractStringLiteral(args[0]);
        const iterSource = args[1]?.getText();
        const fn = args[2];
        let body: StaticFlowNode = { id: generateId(), type: 'effect', callee: 'unknown' } as StaticEffectNode;
        if (fn) {
          const analyzed = yield* analyzeEffectExpression(
            fn,
            ctx.sourceFile,
            ctx.filePath,
            ctx.opts,
            ctx.warnings,
            ctx.stats,
            ctx.serviceScope,
          );
          body = analyzed;
        }
        ctx.stats.loopCount++;
        const loopNode: StaticLoopNode = {
          id: generateId(),
          type: 'loop',
          name: stepId,
          displayName: stepId,
          loopType: 'forEach',
          iterSource,
          body,
        };
        return loopNode;
      }

      case 'Step.retry': {
        // Step.retry(id, effect, options) -> StaticRetryNode
        const stepId = extractStringLiteral(args[0]);
        const innerEffect = args[1];
        if (!innerEffect) {
          const node: StaticEffectNode = {
            id: generateId(),
            type: 'effect',
            callee: 'Step.retry',
            name: stepId,
            displayName: stepId,
          };
          ctx.stats.totalEffects++;
          return node;
        }
        const analyzed = yield* analyzeEffectExpression(
          innerEffect,
          ctx.sourceFile,
          ctx.filePath,
          ctx.opts,
          ctx.warnings,
          ctx.stats,
          ctx.serviceScope,
        );
        ctx.stats.retryCount++;
        const retryNode: StaticRetryNode = {
          id: generateId(),
          type: 'retry',
          name: stepId,
          displayName: stepId,
          source: analyzed,
          hasFallback: false,
        };
        return retryNode;
      }

      case 'Step.race': {
        // Step.race(id, effects) -> StaticRaceNode
        const stepId = extractStringLiteral(args[0]);
        const effectsArg = args[1];
        const children: StaticFlowNode[] = [];
        if (effectsArg?.getKind() === SyntaxKind.ArrayLiteralExpression) {
          const arrayLit = effectsArg as ArrayLiteralExpression;
          for (const element of arrayLit.getElements()) {
            const analyzed = yield* analyzeEffectExpression(
              element,
              ctx.sourceFile,
              ctx.filePath,
              ctx.opts,
              ctx.warnings,
              ctx.stats,
              ctx.serviceScope,
            );
            children.push(analyzed);
          }
        }
        ctx.stats.raceCount++;
        const raceNode: StaticRaceNode = {
          id: generateId(),
          type: 'race',
          name: stepId,
          displayName: stepId,
          children,
          callee: 'Step.race',
        };
        return raceNode;
      }

      case 'Step.sleep': {
        // Step.sleep(id, duration) -> StaticEffectNode with scheduling role
        const stepId = extractStringLiteral(args[0]);
        const effectNode: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee: 'Step.sleep',
          name: stepId,
          displayName: stepId,
          semanticRole: 'scheduling',
        };
        ctx.stats.totalEffects++;
        return effectNode;
      }

      default: {
        // Unknown Step.* call — fallback to generic effect analysis
        const node: StaticEffectNode = {
          id: generateId(),
          type: 'effect',
          callee,
          name: callee,
          displayName: callee,
        };
        ctx.stats.totalEffects++;
        return node;
      }
    }
  });
}

/** Walker context threaded through statement analysis. */
interface WalkerContext {
  readonly sourceFile: SourceFile;
  readonly filePath: string;
  readonly opts: Required<AnalyzerOptions>;
  readonly warnings: AnalysisWarning[];
  readonly stats: AnalysisStats;
  readonly serviceScope: Map<string, string>;
  /** Tracks const declarations with literal initializers for condition simplification */
  readonly constValues: Map<string, string>;
}

/**
 * Analyze a single yield expression: call analyzeEffectExpression on
 * its inner expression, enrich, and track service scope.
 */
function analyzeYieldNode(
  yieldNode: Node,
  ctx: WalkerContext,
): Effect.Effect<{ variableName: string | undefined; effect: StaticFlowNode }, AnalysisError> {
  return Effect.gen(function* () {
    const yieldExpr = yieldNode as YieldExpression;
    const isDelegated = yieldExpr.getText().startsWith('yield*');
    const expr = yieldExpr.getExpression();

    // Plain yield (not yield*)
    if (!isDelegated) {
      const opaqueNode: StaticOpaqueNode = {
        id: generateId(),
        type: 'opaque',
        reason: 'plain-yield',
        sourceText: yieldNode.getText().slice(0, 80),
      };
      ctx.stats.opaqueCount++;
      ctx.warnings.push({
        code: 'PLAIN_YIELD',
        message: `Plain yield (not yield*) detected; this is unusual in Effect generators: ${yieldNode.getText().slice(0, 60)}`,
        location: extractLocation(yieldNode, ctx.filePath, ctx.opts.includeLocations ?? false),
      });
      return { variableName: extractYieldVariableName(yieldNode), effect: opaqueNode };
    }

    if (!expr) {
      const opaqueNode: StaticOpaqueNode = {
        id: generateId(),
        type: 'opaque',
        reason: 'yield-no-expression',
        sourceText: yieldNode.getText().slice(0, 80),
      };
      ctx.stats.opaqueCount++;
      return { variableName: undefined, effect: opaqueNode };
    }

    // effect-flow: intercept Step.* calls when enableEffectFlow is active
    const unwrappedExpr = unwrapExpression(expr);
    if (ctx.opts.enableEffectFlow && isStepCall(unwrappedExpr)) {
      const stepResult = yield* analyzeStepCall(unwrappedExpr as CallExpression, ctx);
      const variableName = extractYieldVariableName(yieldNode);
      const enrichedStep = {
        ...stepResult,
        displayName: stepResult.displayName ?? computeDisplayName(stepResult, variableName),
        semanticRole: stepResult.semanticRole ?? computeSemanticRole(stepResult),
      };
      return { variableName, effect: enrichedStep };
    }

    const analyzed = yield* analyzeEffectExpression(
      expr,
      ctx.sourceFile,
      ctx.filePath,
      ctx.opts,
      ctx.warnings,
      ctx.stats,
      ctx.serviceScope,
    );
    const variableName = extractYieldVariableName(yieldNode);
    if (
      variableName &&
      analyzed.type === 'effect' &&
      isServiceTagCallee((analyzed).callee)
    ) {
      ctx.serviceScope.set(variableName, (analyzed).callee);
    }
    const enrichedEffect = {
      ...analyzed,
      displayName: computeDisplayName(analyzed, variableName),
      semanticRole: analyzed.semanticRole ?? computeSemanticRole(analyzed),
    };
    return { variableName, effect: enrichedEffect };
  });
}

/**
 * Walk a block (or block-like body) statement-by-statement and produce structured IR.
 */
function analyzeGeneratorBody(
  block: import('ts-morph').Block,
  ctx: WalkerContext,
): Effect.Effect<StaticGeneratorNode['yields'], AnalysisError> {
  return Effect.gen(function* () {
    const stmts = block.getStatements();
    const result: StaticGeneratorNode['yields'][number][] = [];
    for (const stmt of stmts) {
      const nodes = yield* analyzeStatement(stmt, ctx);
      result.push(...nodes);
    }
    return result;
  });
}

/**
 * Main statement dispatcher: analyze a single statement and return yield entries.
 */
function analyzeStatement(
  stmt: Node,
  ctx: WalkerContext,
): Effect.Effect<StaticGeneratorNode['yields'], AnalysisError> {
  return Effect.gen(function* () {
    const { SyntaxKind } = loadTsMorph();
    const kind = stmt.getKind();

    switch (kind) {
      // -------------------------------------------------------------------
      // ExpressionStatement
      // -------------------------------------------------------------------
      case SyntaxKind.ExpressionStatement: {
        const exprStmt = stmt as ExpressionStatement;
        const expr = exprStmt.getExpression();
        return yield* analyzeExpressionForYields(expr, ctx);
      }

      // -------------------------------------------------------------------
      // VariableStatement
      // -------------------------------------------------------------------
      case SyntaxKind.VariableStatement: {
        const varStmt = stmt as VariableStatement;
        const result: StaticGeneratorNode['yields'][number][] = [];
        const { VariableDeclarationKind } = loadTsMorph();
        const isConst = varStmt.getDeclarationKind() === VariableDeclarationKind.Const;
        for (const decl of varStmt.getDeclarations()) {
          const init = decl.getInitializer();

          // Track const declarations with literal initializers for condition resolution
          if (isConst && init) {
            const literalValue = extractLiteralValue(init);
            if (literalValue !== undefined) {
              ctx.constValues.set(decl.getName(), literalValue);
            }
          }

          // Preserve Context.pick/Context.omit steps even when not yield*'d.
          // These are pure but context-shaping and are part of intended IR coverage.
          if (init && !containsGeneratorYield(init) && init.getKind() === SyntaxKind.CallExpression) {
            const callExpr = init as CallExpression;
            const calleeText = callExpr.getExpression().getText();
            if (calleeText === 'Context.pick' || calleeText === 'Context.omit') {
              const analyzed = yield* analyzeEffectExpression(
                callExpr,
                ctx.sourceFile,
                ctx.filePath,
                ctx.opts,
                ctx.warnings,
                ctx.stats,
                ctx.serviceScope,
              );
              if (analyzed.type === 'effect' && analyzed.description === 'context') {
                result.push({ variableName: decl.getName(), effect: analyzed });
              }
              continue;
            }
          }

          if (init && containsGeneratorYield(init)) {
            const yieldEntries = yield* analyzeExpressionForYields(init, ctx);
            // Try to get variable name from the declaration for the last yield
            if (yieldEntries.length > 0) {
              const declName = decl.getName();
              const lastEntry = yieldEntries[yieldEntries.length - 1];
              if (lastEntry) {
                yieldEntries[yieldEntries.length - 1] = {
                  ...lastEntry,
                  variableName: lastEntry.variableName ?? declName,
                };
              }
            }
            result.push(...yieldEntries);
          }
        }
        return result;
      }

      // -------------------------------------------------------------------
      // IfStatement
      // -------------------------------------------------------------------
      case SyntaxKind.IfStatement: {
        if (!containsGeneratorYield(stmt)) return [];
        const ifStmt = stmt as IfStatement;
        const condition = ifStmt.getExpression().getText();

        // Check if condition itself has yields
        const condYields = yield* analyzeExpressionForYields(
          ifStmt.getExpression(),
          ctx,
        );

        const thenStmt = ifStmt.getThenStatement();
        const elseStmt = ifStmt.getElseStatement();

        const onTrue = yield* analyzeStatementBlock(thenStmt, ctx);
        const onFalse = elseStmt
          ? yield* analyzeStatementBlock(elseStmt, ctx)
          : undefined;

        const resolvedCondition = simplifyBooleanExpression(resolveConditionConsts(condition, ctx.constValues));
        const decisionLabel = resolvedCondition.length > 40 ? resolvedCondition.slice(0, 40) + '...' : resolvedCondition;
        const decisionNode: StaticDecisionNode = {
          id: generateId(),
          type: 'decision',
          decisionId: generateId(),
          label: decisionLabel,
          condition,
          source: 'raw-if',
          onTrue: onTrue.map((y) => y.effect),
          onFalse: onFalse && onFalse.length > 0 ? onFalse.map((y) => y.effect) : undefined,
        };
        ctx.stats.decisionCount++;

        return [
          ...condYields,
          { effect: decisionNode },
        ];
      }

      // -------------------------------------------------------------------
      // SwitchStatement
      // -------------------------------------------------------------------
      case SyntaxKind.SwitchStatement: {
        if (!containsGeneratorYield(stmt)) return [];
        const switchStmt = stmt as SwitchStatement;
        const expression = switchStmt.getExpression().getText();

        const clauses = switchStmt.getClauses();
        const cases: StaticSwitchCase[] = [];
        let hasFallthrough = false;
        let hasDefault = false;

        // Build fallthrough groups
        let currentLabels: string[] = [];
        let currentBodyYields: StaticGeneratorNode['yields'] = [];
        let currentIsDefault = false;

        for (const clause of clauses) {
          const isDefault = clause.getKind() === SyntaxKind.DefaultClause;
          if (isDefault) {
            hasDefault = true;
            currentIsDefault = true;
            currentLabels.push('default');
          } else {
            const caseClause = clause as CaseClause;
            currentLabels.push(caseClause.getExpression().getText());
          }

          const clauseStmts = clause.getStatements();
          if (clauseStmts.length === 0) {
            // Empty clause body = fallthrough
            hasFallthrough = true;
            continue;
          }

          // Analyze clause body
          for (const clauseStmt of clauseStmts) {
            const yieldEntries = yield* analyzeStatement(clauseStmt, ctx);
            currentBodyYields.push(...yieldEntries);
          }

          const hasTerminator = hasTerminatorStatement(clauseStmts);
          if (!hasTerminator) {
            hasFallthrough = true;
          }

          cases.push({
            labels: currentLabels,
            isDefault: currentIsDefault,
            body: currentBodyYields.map((y) => y.effect),
          });
          currentLabels = [];
          currentBodyYields = [];
          currentIsDefault = false;
        }

        // Flush remaining group
        if (currentLabels.length > 0) {
          cases.push({
            labels: currentLabels,
            isDefault: currentIsDefault,
            body: currentBodyYields.map((y) => y.effect),
          });
        }

        const resolvedExpression = resolveConditionConsts(expression, ctx.constValues);
        const switchNode: StaticSwitchNode = {
          id: generateId(),
          type: 'switch',
          switchId: generateId(),
          expression: resolvedExpression,
          cases,
          source: 'raw-js',
          hasDefault,
          hasFallthrough,
        };
        ctx.stats.switchCount++;

        return [{ effect: switchNode }];
      }

      // -------------------------------------------------------------------
      // ForStatement
      // -------------------------------------------------------------------
      case SyntaxKind.ForStatement: {
        if (!containsGeneratorYield(stmt)) return [];
        const forStmt = stmt as ForStatement;

        // Check for yields in header (initializer / incrementor)
        const headerYields: StaticFlowNode[] = [];
        const initializer = forStmt.getInitializer();
        if (initializer && containsGeneratorYield(initializer)) {
          const entries = yield* analyzeExpressionForYields(initializer, ctx);
          headerYields.push(...entries.map((e) => e.effect));
        }
        const incrementor = forStmt.getIncrementor();
        if (incrementor && containsGeneratorYield(incrementor)) {
          const entries = yield* analyzeExpressionForYields(incrementor, ctx);
          headerYields.push(...entries.map((e) => e.effect));
        }

        const bodyStmt = forStmt.getStatement();
        const bodyYields = yield* analyzeStatementBlock(bodyStmt, ctx);
        const hasEarlyExit = checkEarlyExit(bodyStmt);

        const condition = forStmt.getCondition();
        const iterSource = condition ? condition.getText() : undefined;

        const loopBody: StaticFlowNode =
          bodyYields.length === 1 && bodyYields[0]
            ? bodyYields[0].effect
            : {
                id: generateId(),
                type: 'generator' as const,
                yields: bodyYields,
              };

        const loopNode: StaticLoopNode = {
          id: generateId(),
          type: 'loop',
          loopType: 'for',
          iterSource,
          body: loopBody,
          ...(hasEarlyExit ? { hasEarlyExit } : {}),
          ...(headerYields.length > 0 ? { headerYields } : {}),
        };
        ctx.stats.loopCount++;

        return [{ effect: loopNode }];
      }

      // -------------------------------------------------------------------
      // ForOfStatement
      // -------------------------------------------------------------------
      case SyntaxKind.ForOfStatement: {
        if (!containsGeneratorYield(stmt)) return [];
        const forOfStmt = stmt as ForOfStatement;

        const iterExpr = forOfStmt.getExpression();
        const iterSource = iterExpr.getText();

        // Check for yield* in the iterable expression: `for (const x of yield* items)`
        const headerYields: StaticFlowNode[] = [];
        if (containsGeneratorYield(iterExpr)) {
          const entries = yield* analyzeExpressionForYields(iterExpr, ctx);
          headerYields.push(...entries.map((e) => e.effect));
        }

        const iterVariable = forOfStmt.getInitializer().getText();

        const bodyStmt = forOfStmt.getStatement();
        const bodyYields = yield* analyzeStatementBlock(bodyStmt, ctx);
        const hasEarlyExit = checkEarlyExit(bodyStmt);

        const loopBody: StaticFlowNode =
          bodyYields.length === 1 && bodyYields[0]
            ? bodyYields[0].effect
            : {
                id: generateId(),
                type: 'generator' as const,
                yields: bodyYields,
              };

        const loopNode: StaticLoopNode = {
          id: generateId(),
          type: 'loop',
          loopType: 'forOf',
          iterSource,
          body: loopBody,
          ...(hasEarlyExit ? { hasEarlyExit } : {}),
          ...(headerYields.length > 0 ? { headerYields } : {}),
          iterVariable,
        };
        ctx.stats.loopCount++;

        return [{ effect: loopNode }];
      }

      // -------------------------------------------------------------------
      // ForInStatement
      // -------------------------------------------------------------------
      case SyntaxKind.ForInStatement: {
        if (!containsGeneratorYield(stmt)) return [];
        const forInStmt = stmt as ForInStatement;

        const iterSource = forInStmt.getExpression().getText();
        const iterVariable = forInStmt.getInitializer().getText();

        const bodyStmt = forInStmt.getStatement();
        const bodyYields = yield* analyzeStatementBlock(bodyStmt, ctx);
        const hasEarlyExit = checkEarlyExit(bodyStmt);

        const loopBody: StaticFlowNode =
          bodyYields.length === 1 && bodyYields[0]
            ? bodyYields[0].effect
            : {
                id: generateId(),
                type: 'generator' as const,
                yields: bodyYields,
              };

        const loopNode: StaticLoopNode = {
          id: generateId(),
          type: 'loop',
          loopType: 'forIn',
          iterSource,
          body: loopBody,
          ...(hasEarlyExit ? { hasEarlyExit } : {}),
          iterVariable,
        };
        ctx.stats.loopCount++;

        return [{ effect: loopNode }];
      }

      // -------------------------------------------------------------------
      // WhileStatement
      // -------------------------------------------------------------------
      case SyntaxKind.WhileStatement: {
        if (!containsGeneratorYield(stmt)) return [];
        const whileStmt = stmt as WhileStatement;

        const condition = whileStmt.getExpression().getText();

        const bodyStmt = whileStmt.getStatement();
        const bodyYields = yield* analyzeStatementBlock(bodyStmt, ctx);
        const hasEarlyExit = checkEarlyExit(bodyStmt);

        const loopBody: StaticFlowNode =
          bodyYields.length === 1 && bodyYields[0]
            ? bodyYields[0].effect
            : {
                id: generateId(),
                type: 'generator' as const,
                yields: bodyYields,
              };

        const loopNode: StaticLoopNode = {
          id: generateId(),
          type: 'loop',
          loopType: 'while',
          iterSource: condition,
          body: loopBody,
          ...(hasEarlyExit ? { hasEarlyExit } : {}),
        };
        ctx.stats.loopCount++;

        return [{ effect: loopNode }];
      }

      // -------------------------------------------------------------------
      // DoStatement (do-while)
      // -------------------------------------------------------------------
      case SyntaxKind.DoStatement: {
        if (!containsGeneratorYield(stmt)) return [];
        const doStmt = stmt as DoStatement;

        const condition = doStmt.getExpression().getText();

        const bodyStmt = doStmt.getStatement();
        const bodyYields = yield* analyzeStatementBlock(bodyStmt, ctx);
        const hasEarlyExit = checkEarlyExit(bodyStmt);

        const loopBody: StaticFlowNode =
          bodyYields.length === 1 && bodyYields[0]
            ? bodyYields[0].effect
            : {
                id: generateId(),
                type: 'generator' as const,
                yields: bodyYields,
              };

        const loopNode: StaticLoopNode = {
          id: generateId(),
          type: 'loop',
          loopType: 'doWhile',
          iterSource: condition,
          body: loopBody,
          ...(hasEarlyExit ? { hasEarlyExit } : {}),
        };
        ctx.stats.loopCount++;

        return [{ effect: loopNode }];
      }

      // -------------------------------------------------------------------
      // TryStatement
      // -------------------------------------------------------------------
      case SyntaxKind.TryStatement: {
        if (!containsGeneratorYield(stmt)) return [];
        const tryStmt = stmt as TryStatement;

        const tryBlock = tryStmt.getTryBlock();
        const tryYields = yield* analyzeGeneratorBody(tryBlock, ctx);

        const catchClause = tryStmt.getCatchClause();
        let catchVariable: string | undefined;
        let catchYields: StaticGeneratorNode['yields'] | undefined;
        if (catchClause) {
          const variableDecl = catchClause.getVariableDeclaration();
          catchVariable = variableDecl?.getName();
          const catchBlock = catchClause.getBlock();
          catchYields = yield* analyzeGeneratorBody(catchBlock, ctx);
        }

        const finallyBlock = tryStmt.getFinallyBlock();
        let finallyYields: StaticGeneratorNode['yields'] | undefined;
        if (finallyBlock) {
          finallyYields = yield* analyzeGeneratorBody(finallyBlock, ctx);
        }

        const hasTerminalInTry = hasTerminatorStatement(tryBlock.getStatements());

        const tryCatchNode: StaticTryCatchNode = {
          id: generateId(),
          type: 'try-catch',
          tryBody: tryYields.map((y) => y.effect),
          ...(catchVariable ? { catchVariable } : {}),
          ...(catchYields && catchYields.length > 0
            ? { catchBody: catchYields.map((y) => y.effect) }
            : {}),
          ...(finallyYields && finallyYields.length > 0
            ? { finallyBody: finallyYields.map((y) => y.effect) }
            : {}),
          hasTerminalInTry,
        };
        ctx.stats.tryCatchCount++;

        return [{ effect: tryCatchNode }];
      }

      // -------------------------------------------------------------------
      // ReturnStatement
      // -------------------------------------------------------------------
      case SyntaxKind.ReturnStatement: {
        const retStmt = stmt as ReturnStatement;
        const expr = retStmt.getExpression();

        if (!expr || !containsGeneratorYield(expr)) {
          // return with no yield — skip (not interesting for the IR)
          return [];
        }

        // return yield* X or return (yield* X) — analyze the yield expression
        const yieldEntries = yield* analyzeExpressionForYields(expr, ctx);
        const termNode: StaticTerminalNode = {
          id: generateId(),
          type: 'terminal',
          terminalKind: 'return',
          value: yieldEntries.map((y) => y.effect),
        };
        ctx.stats.terminalCount++;
        return [{ effect: termNode }];
      }

      // -------------------------------------------------------------------
      // ThrowStatement
      // -------------------------------------------------------------------
      case SyntaxKind.ThrowStatement: {
        const throwStmt = stmt as ThrowStatement;
        const expr = throwStmt.getExpression();
        if (!containsGeneratorYield(expr)) {
          // throw without yields — skip (not interesting for the IR at top level)
          return [];
        }

        const valueYields = yield* analyzeExpressionForYields(expr, ctx);

        const termNode: StaticTerminalNode = {
          id: generateId(),
          type: 'terminal',
          terminalKind: 'throw',
          ...(valueYields.length > 0 ? { value: valueYields.map((y) => y.effect) } : {}),
        };
        ctx.stats.terminalCount++;
        return [{ effect: termNode }];
      }

      // -------------------------------------------------------------------
      // BreakStatement
      // -------------------------------------------------------------------
      case SyntaxKind.BreakStatement: {
        // Only emit break as a terminal when inside a yield-containing control flow.
        // We always skip at the top level since it can't appear there anyway,
        // but it may appear inside switch/loop bodies that we recurse into.
        return [];
      }

      // -------------------------------------------------------------------
      // ContinueStatement
      // -------------------------------------------------------------------
      case SyntaxKind.ContinueStatement: {
        // Same as break — skip as a yield entry.
        return [];
      }

      // -------------------------------------------------------------------
      // LabeledStatement — unwrap inner statement
      // -------------------------------------------------------------------
      case SyntaxKind.LabeledStatement: {
        const labeledStmt = stmt as LabeledStatement;
        return yield* analyzeStatement(labeledStmt.getStatement(), ctx);
      }

      // -------------------------------------------------------------------
      // Block — recurse
      // -------------------------------------------------------------------
      case SyntaxKind.Block: {
        return yield* analyzeGeneratorBody(stmt as Block, ctx);
      }

      // -------------------------------------------------------------------
      // Default — skip non-yield-containing statements
      // -------------------------------------------------------------------
      default:
        return [];
    }
  });
}

/**
 * Analyze a statement or block-like node into yield entries.
 * If the node is a Block, delegate to analyzeGeneratorBody.
 * Otherwise, treat it as a single statement (e.g., an if-then body without braces).
 */
function analyzeStatementBlock(
  stmt: Node,
  ctx: WalkerContext,
): Effect.Effect<StaticGeneratorNode['yields'], AnalysisError> {
  const { SyntaxKind } = loadTsMorph();
  if (stmt.getKind() === SyntaxKind.Block) {
    return analyzeGeneratorBody(stmt as Block, ctx);
  }
  return analyzeStatement(stmt, ctx);
}

/**
 * Check if a statement body contains an early exit (break/return) at any depth,
 * respecting function boundaries.
 */
function checkEarlyExit(stmt: Node): boolean {
  const { SyntaxKind } = loadTsMorph();
  let found = false;
  stmt.forEachChild((child) => {
    if (found) return;
    if (isFunctionBoundary(child)) return;
    const k = child.getKind();
    if (k === SyntaxKind.BreakStatement || k === SyntaxKind.ReturnStatement) {
      found = true;
      return;
    }
    if (checkEarlyExit(child)) {
      found = true;
      return;
    }
  });
  return found;
}

/**
 * Analyze an expression node for yield expressions. Handles:
 * - Direct yield/yield* expressions
 * - Ternary expressions: cond ? yield* A : yield* B
 * - Short-circuit: cond && yield* A, cond || yield* B, x ?? yield* A
 * - Fallback: collect all yield* in evaluation order
 */
function analyzeExpressionForYields(
  expr: Node,
  ctx: WalkerContext,
): Effect.Effect<StaticGeneratorNode['yields'], AnalysisError> {
  return Effect.gen(function* () {
    const { SyntaxKind } = loadTsMorph();

    if (!containsGeneratorYield(expr)) return [];

    const unwrapped = unwrapExpression(expr);
    const exprKind = unwrapped.getKind();

    // Direct yield expression
    if (exprKind === SyntaxKind.YieldExpression) {
      const entry = yield* analyzeYieldNode(unwrapped, ctx);
      return [entry];
    }

    // Ternary: cond ? (yield* A) : (yield* B)
    if (exprKind === SyntaxKind.ConditionalExpression) {
      const ternary = unwrapped as ConditionalExpression;
      const condition = ternary.getCondition().getText();
      const whenTrue = ternary.getWhenTrue();
      const whenFalse = ternary.getWhenFalse();

      const trueYields = yield* analyzeExpressionForYields(whenTrue, ctx);
      const falseYields = yield* analyzeExpressionForYields(whenFalse, ctx);

      if (trueYields.length > 0 || falseYields.length > 0) {
        const resolvedCond = simplifyBooleanExpression(resolveConditionConsts(condition, ctx.constValues));
        const decisionNode: StaticDecisionNode = {
          id: generateId(),
          type: 'decision',
          decisionId: generateId(),
          label: resolvedCond.length > 40 ? resolvedCond.slice(0, 40) + '...' : resolvedCond,
          condition,
          source: 'raw-ternary',
          onTrue: trueYields.map((y) => y.effect),
          onFalse: falseYields.length > 0 ? falseYields.map((y) => y.effect) : undefined,
        };
        ctx.stats.decisionCount++;
        return [{ effect: decisionNode }];
      }
    }

    // Binary expression: short-circuit (&&, ||, ??)
    if (exprKind === SyntaxKind.BinaryExpression) {
      const binary = unwrapped as BinaryExpression;
      const operatorToken = binary.getOperatorToken().getKind();
      const left = binary.getLeft();
      const right = binary.getRight();

      // && short-circuit: cond && (yield* A)
      if (operatorToken === SyntaxKind.AmpersandAmpersandToken) {
        const rightYields = yield* analyzeExpressionForYields(right, ctx);
        if (rightYields.length > 0) {
          const condition = left.getText();
          const resolvedCond = simplifyBooleanExpression(resolveConditionConsts(condition, ctx.constValues));
          const decisionNode: StaticDecisionNode = {
            id: generateId(),
            type: 'decision',
            decisionId: generateId(),
            label: resolvedCond.length > 40 ? resolvedCond.slice(0, 40) + '...' : resolvedCond,
            condition,
            source: 'raw-short-circuit',
            onTrue: rightYields.map((y) => y.effect),
            onFalse: [],
          };
          ctx.stats.decisionCount++;
          return [{ effect: decisionNode }];
        }
      }

      // || short-circuit: cond || (yield* B)
      if (operatorToken === SyntaxKind.BarBarToken) {
        const rightYields = yield* analyzeExpressionForYields(right, ctx);
        if (rightYields.length > 0) {
          const condition = left.getText();
          const resolvedCond = simplifyBooleanExpression(resolveConditionConsts(condition, ctx.constValues));
          const decisionNode: StaticDecisionNode = {
            id: generateId(),
            type: 'decision',
            decisionId: generateId(),
            label: resolvedCond.length > 40 ? resolvedCond.slice(0, 40) + '...' : resolvedCond,
            condition,
            source: 'raw-short-circuit',
            onTrue: [],
            onFalse: rightYields.map((y) => y.effect),
          };
          ctx.stats.decisionCount++;
          return [{ effect: decisionNode }];
        }
      }

      // ?? nullish coalescing: x ?? (yield* A)
      if (operatorToken === SyntaxKind.QuestionQuestionToken) {
        const rightYields = yield* analyzeExpressionForYields(right, ctx);
        if (rightYields.length > 0) {
          const condition = `${left.getText()} != null`;
          const resolvedCond = simplifyBooleanExpression(resolveConditionConsts(condition, ctx.constValues));
          const decisionNode: StaticDecisionNode = {
            id: generateId(),
            type: 'decision',
            decisionId: generateId(),
            label: resolvedCond.length > 40 ? resolvedCond.slice(0, 40) + '...' : resolvedCond,
            condition,
            source: 'raw-short-circuit',
            onTrue: [],
            onFalse: rightYields.map((y) => y.effect),
          };
          ctx.stats.decisionCount++;
          return [{ effect: decisionNode }];
        }
      }
    }

    // Fallback: collect all yield expressions in depth-first order
    const yieldExprs = collectYieldExpressionsDF(expr);
    const result: StaticGeneratorNode['yields'] = [];
    for (const yieldExpr of yieldExprs) {
      const entry = yield* analyzeYieldNode(yieldExpr, ctx);
      result.push(entry);
    }
    return result;
  });
}

// =============================================================================
// Generator Function Analysis (rewritten with statement-level walker)
// =============================================================================

export const analyzeGeneratorFunction = (
  node: Node,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<readonly StaticFlowNode[], AnalysisError> =>
  Effect.gen(function* () {
    const { SyntaxKind } = loadTsMorph();

    let body: Node | undefined;

    if (
      node.getKind() === SyntaxKind.ArrowFunction ||
      node.getKind() === SyntaxKind.FunctionExpression
    ) {
      body = (
        node as
          | import('ts-morph').ArrowFunction
          | import('ts-morph').FunctionExpression
      ).getBody();
    } else if (node.getKind() === SyntaxKind.FunctionDeclaration) {
      body = (node as FunctionDeclaration).getBody();
    }

    if (!body) {
      return [];
    }

    const serviceScope = new Map<string, string>();
    const constValues = new Map<string, string>();
    const ctx: WalkerContext = {
      sourceFile,
      filePath,
      opts,
      warnings,
      stats,
      serviceScope,
      constValues,
    };

    let yields: StaticGeneratorNode['yields'];

    // If the body is a Block (the normal case), use the statement-level walker
    if (body.getKind() === SyntaxKind.Block) {
      yields = yield* analyzeGeneratorBody(body as Block, ctx);
    } else {
      // Expression body (arrow function): analyze the expression directly
      const entries = yield* analyzeExpressionForYields(body, ctx);
      yields = entries;
    }

    // Also scan for non-yielded Effect-like call expressions (same as before).
    // This intentionally includes calls nested inside yield* arguments — the existing
    // behavior produces additional entries for sub-expressions like Effect.provide()
    // inside pipe chains, which tests and downstream consumers rely on.
    const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      // Skip Effect.withSpan calls — they are merged as annotations on pipe nodes
      const callCallee = call.getExpression().getText();
      if (callCallee.includes('withSpan')) continue;

      const aliases = getAliasesForFile(sourceFile);
      if (isEffectLikeCallExpression(call, sourceFile, aliases, opts.knownEffectInternalsRoot)) {
        const analyzed = yield* analyzeEffectCall(
          call,
          sourceFile,
          filePath,
          opts,
          warnings,
          stats,
          serviceScope,
        );
        yields.push({
          effect: analyzed,
        });
      }
    }

    const generatorJSDoc = extractJSDocDescription(node);

    const generatorNode: StaticGeneratorNode = {
      id: generateId(),
      type: 'generator',
      yields,
      jsdocDescription: generatorJSDoc,
      jsdocTags: extractJSDocTags(node),
    };
    const enrichedGeneratorNode: StaticGeneratorNode = {
      ...generatorNode,
      displayName: computeDisplayName(generatorNode),
      semanticRole: computeSemanticRole(generatorNode),
    };

    return [enrichedGeneratorNode];
  });

export function analyzeRunEntrypointExpression(
  call: CallExpression,
  sourceFile: SourceFile,
  filePath: string,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
): Effect.Effect<Option.Option<readonly StaticFlowNode[]>, AnalysisError> {
  const calleeExpr = call.getExpression();
  const calleeText = calleeExpr.getText();
  const isPipeCall = calleeText.endsWith('.pipe') || calleeText === 'pipe';
  if (!isPipeCall) return Effect.succeed(Option.none());
  const args = call.getArguments();
  const lastArg = args[args.length - 1];
  if (!lastArg) return Effect.succeed(Option.none());
  const lastArgText = lastArg.getText();
  const isRunTerminated =
    lastArgText.includes('.runMain') ||
    lastArgText.includes('.runPromise') ||
    lastArgText.includes('.runSync') ||
    lastArgText.includes('.runFork');
  if (!isRunTerminated) return Effect.succeed(Option.none());
  return Effect.map(
    analyzePipeChain(call, sourceFile, filePath, opts, warnings, stats),
    (nodes) => Option.some(nodes),
  );
}
