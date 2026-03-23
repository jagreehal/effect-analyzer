/**
 * Effect program discovery: find Effect.gen, pipe, run, class, and class-member programs.
 */

import type {
  SourceFile,
  Node,
  CallExpression,
  VariableDeclaration,
  PropertyAccessExpression,
  Identifier,
  AwaitExpression,
  Block,
  ArrowFunction,
  FunctionExpression,
  PropertyDeclaration,
  MethodDeclaration,
  GetAccessorDeclaration,
  FunctionDeclaration,
  ClassDeclaration,
  ReturnStatement,
  ExpressionStatement,
  TypeNode,
  ObjectLiteralExpression,
  PropertyAssignment,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type { AnalyzerOptions, ServiceDefinition } from './types';
import { extractProgramName, extractEnclosingEffectFnName } from './analysis-utils';
import type { EffectProgram } from './analysis-utils';

export type { EffectProgram } from './analysis-utils';
import { isLikelyDirectEffectInitializer } from './analysis-patterns';
import {
  getEffectLikeNamespaceAliases,
  getNonProgramEffectImportNames,
  isSpecifierUnderKnownEffectInternalsRoot,
  isEffectLikeCallExpression,
} from './alias-resolution';

// =============================================================================
// Workflow (effect-workflow) helpers
// =============================================================================

const WORKFLOW_FACTORY_NAMES = new Set([
  'createWorkflow',
  'createSagaWorkflow',
  'runSaga',
]);

const isWorkflowFactoryCall = (calleeText: string): boolean =>
  Array.from(WORKFLOW_FACTORY_NAMES).some(
    (name) => calleeText === name || calleeText.endsWith(`.${name}`),
  );

/** Returns true if call is X.make(name, deps?, fn, options?) with at least 3 args and 3rd is a function. */
const isWorkflowMakeCall = (call: CallExpression): boolean => {
  const expr = call.getExpression();
  if (expr.getKind() !== loadTsMorph().SyntaxKind.PropertyAccessExpression) {
    return false;
  }
  const prop = expr as PropertyAccessExpression;
  const args = call.getArguments();
  if (prop.getName() !== 'make' || args.length < 3 || !args[2]) {
    return false;
  }
  const third = args[2].getKind();
  const { SyntaxKind } = loadTsMorph();
  return (
    third === SyntaxKind.ArrowFunction || third === SyntaxKind.FunctionExpression
  );
};

// =============================================================================
// Effect package workflow
// =============================================================================

/** True if the module specifier refers to the workflow package. */
function isWorkflowPackageSpecifier(specifier: string, _currentFilePath?: string): boolean {
  const n = specifier.replace(/\\/g, '/');
  if (n === '@effect/workflow' || n === 'effect/workflow') return true;
  if (n.endsWith('/workflow') || n.includes('/workflow/')) return true;
  if (n.endsWith('/Workflow.js') || n.endsWith('/Workflow.ts')) return true;
  if (n.endsWith('/Activity.js') || n.endsWith('/Activity.ts')) return true;
  if (n.startsWith('.') && (n.endsWith('Workflow.js') || n.endsWith('Workflow.ts') || n.endsWith('Activity.js') || n.endsWith('Activity.ts'))) return true;
  return false;
}

function isWorkflowNamespaceFromPackage(
  localName: string,
  specifier: string,
  _currentFilePath?: string,
): boolean {
  if (localName !== 'Workflow') return false;
  return isWorkflowPackageSpecifier(specifier, _currentFilePath);
}

function isActivityNamespaceFromPackage(
  localName: string,
  specifier: string,
  _currentFilePath?: string,
): boolean {
  if (localName !== 'Activity') return false;
  return isWorkflowPackageSpecifier(specifier, _currentFilePath);
}

function objectArgHasAnyProperty(
  call: CallExpression,
  propertyNames: readonly string[],
): boolean {
  const { SyntaxKind } = loadTsMorph();
  const args = call.getArguments();
  if (args.length !== 1 || !args[0]) return false;
  const arg = args[0];
  if (arg.getKind() !== SyntaxKind.ObjectLiteralExpression) return false;
  const obj = arg as ObjectLiteralExpression;
  const props = obj.getProperties();
  const names = new Set(propertyNames);
  for (const p of props) {
    if (p.getKind() === SyntaxKind.PropertyAssignment) {
      const name = (p as PropertyAssignment).getName();
      if (names.has(name)) return true;
    }
  }
  return false;
}

function isWorkflowMakeOptionsCall(
  call: CallExpression,
  importSpecifierByLocalName: Map<string, string>,
  currentFilePath: string,
): boolean {
  const { SyntaxKind } = loadTsMorph();
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
  const prop = expr as PropertyAccessExpression;
  if (prop.getName() !== 'make') return false;
  const baseText = prop.getExpression().getText();
  const specifier = importSpecifierByLocalName.get(baseText);
  if (!specifier || !isWorkflowNamespaceFromPackage(baseText, specifier, currentFilePath)) return false;
  return objectArgHasAnyProperty(call, ['name', 'payload', 'idempotencyKey']);
}

function isActivityMakeOptionsCall(
  call: CallExpression,
  importSpecifierByLocalName: Map<string, string>,
  currentFilePath: string,
): boolean {
  const { SyntaxKind } = loadTsMorph();
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
  const prop = expr as PropertyAccessExpression;
  if (prop.getName() !== 'make') return false;
  const baseText = prop.getExpression().getText();
  const specifier = importSpecifierByLocalName.get(baseText);
  if (!specifier || !isActivityNamespaceFromPackage(baseText, specifier, currentFilePath)) return false;
  return objectArgHasAnyProperty(call, ['name', 'execute']);
}

/**
 * For X.run(singleArg) (e.g. effect-workflow Workflow.run(workflow)), resolve the single
 * argument to the workflow body (the callback passed to Workflow.make). Returns the AST
 * node for that callback or null.
 */
export const getWorkflowBodyNodeForRunCall = (
  runCall: CallExpression,
  sourceFile: SourceFile,
): Node | null => {
  const expr = runCall.getExpression();
  if (expr.getKind() !== loadTsMorph().SyntaxKind.PropertyAccessExpression) {
    return null;
  }
  const prop = expr as PropertyAccessExpression;
  if (prop.getName() !== 'run') {
    return null;
  }
  const args = runCall.getArguments();
  if (args.length < 1 || !args[0]) {
    return null;
  }
  const arg = args[0];
  const { SyntaxKind } = loadTsMorph();

  if (arg.getKind() === SyntaxKind.CallExpression) {
    const innerCall = arg as CallExpression;
    if (isWorkflowMakeCall(innerCall)) {
      const makeArgs = innerCall.getArguments();
      return makeArgs[2] ?? null;
    }
    return null;
  }

  if (arg.getKind() !== SyntaxKind.Identifier) {
    return null;
  }
  const id = arg as Identifier;
  const name = id.getText();
  const varDecls = sourceFile.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  );
  for (const decl of varDecls) {
    if ((decl).getName() !== name) {
      continue;
    }
    const initializer = (decl).getInitializer();
    if (
      initializer?.getKind() === SyntaxKind.CallExpression &&
      isWorkflowMakeCall(initializer as CallExpression)
    ) {
      const makeArgs = (initializer as CallExpression).getArguments();
      return makeArgs[2] ?? null;
    }
  }
  return null;
};

// =============================================================================
// Scope and run detection
// =============================================================================

const isInsideEffectGen = (node: Node): boolean => {
  const { SyntaxKind } = loadTsMorph();
  let current = node.getParent();
  while (current) {
    if (current.getKind() === SyntaxKind.CallExpression) {
      const expr = (current as CallExpression).getExpression();
      const text = expr.getText();
      if (text.includes('.gen') || text === 'gen') {
        return true;
      }
    }
    current = current.getParent();
  }
  return false;
};

const isTopLevelVariableDeclaration = (decl: VariableDeclaration): boolean => {
  const { SyntaxKind } = loadTsMorph();
  const statement = decl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  return statement?.getParent()?.getKind() === SyntaxKind.SourceFile;
};

const isYieldBoundDeclaration = (decl: VariableDeclaration): boolean => {
  const { SyntaxKind } = loadTsMorph();
  const initializer = decl.getInitializer();
  if (!initializer) return false;
  if (initializer.getKind() === SyntaxKind.YieldExpression) return true;
  if (
    initializer.getKind() === SyntaxKind.AwaitExpression &&
    (
      initializer as AwaitExpression
    ).getExpression().getKind() === SyntaxKind.YieldExpression
  ) {
    return true;
  }
  return false;
};

const getCallExpressionFromInitializer = (
  initializer: Node,
): CallExpression | undefined => {
  const { SyntaxKind } = loadTsMorph();
  if (initializer.getKind() === SyntaxKind.CallExpression) {
    return initializer as CallExpression;
  }
  if (initializer.getKind() === SyntaxKind.AwaitExpression) {
    const awaited = (
      initializer as AwaitExpression
    ).getExpression();
    if (awaited.getKind() === SyntaxKind.CallExpression) {
      return awaited as CallExpression;
    }
  }
  return undefined;
};

type DiscoveryConfidence = NonNullable<EffectProgram['discoveryConfidence']>;

interface DiscoveryInfo {
  readonly discoveryConfidence: DiscoveryConfidence;
  readonly discoveryReason: string;
}

const buildDiscoveryInfo = (
  discoveryConfidence: DiscoveryConfidence,
  discoveryReason: string,
): DiscoveryInfo => ({ discoveryConfidence, discoveryReason });

const EFFECT_FAMILY_TYPE_HINTS = [
  'Effect<',
  'Layer<',
  'Layer.Layer<',
  'Stream<',
  'Stream.Stream<',
  'Channel<',
  'Channel.Channel<',
  'Sink<',
  'Sink.Sink<',
  'STM<',
  'STM.STM<',
  'Schedule<',
  'Schedule.Schedule<',
];

const hasEffectFamilyTypeHint = (text: string | undefined): boolean =>
  text !== undefined && EFFECT_FAMILY_TYPE_HINTS.some((hint) => text.includes(hint));

const DISCOVERY_CONFIDENCE_RANK: Record<DiscoveryConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const isRunCall = (call: CallExpression): boolean => {
  const exprText = call.getExpression().getText();
  return (
    exprText.includes('.runPromise') ||
    exprText.includes('.runPromiseExit') ||
    exprText.includes('.runSync') ||
    exprText.includes('.runSyncExit') ||
    exprText.includes('.runFork') ||
    exprText.includes('.runCallback') ||
    exprText.includes('.runMain') ||
    exprText.includes('Runtime.runPromise') ||
    exprText.includes('Runtime.runSync') ||
    exprText.includes('Runtime.runFork')
  );
};

/**
 * Check if a function-like node's body contains runMain/runPromise/runSync/runFork.
 * Used for indirect runMain wrapper detection (improve.md §9).
 */
function bodyContainsRunMainOrRunPromise(node: Node): boolean {
  const body = (node as unknown as { getBody?: () => Node }).getBody?.();
  if (!body) return false;
  const text = body.getText();
  return (
    text.includes('.runMain') ||
    text.includes('.runPromise') ||
    text.includes('.runSync') ||
    text.includes('.runFork') ||
    text.includes('Runtime.runPromise') ||
    text.includes('Runtime.runSync') ||
    text.includes('NodeRuntime.runMain') ||
    text.includes('BunRuntime.runMain') ||
    text.includes('DenoRuntime.runMain')
  );
}

/**
 * Resolve identifier to a function declaration/expression and check if its body contains runMain/runPromise.
 */
function isIndirectRunMainWrapper(call: CallExpression, _sourceFile: SourceFile): boolean {
  const expr = call.getExpression();
  if (expr.getKind() !== loadTsMorph().SyntaxKind.Identifier) return false;
  const id = expr as Identifier;
  const sym = id.getSymbol();
  const decl = sym?.getValueDeclaration();
  if (!decl) return false;
  const kind = decl.getKind();
  const { SyntaxKind } = loadTsMorph();
  if (
    kind === SyntaxKind.FunctionDeclaration ||
    kind === SyntaxKind.ArrowFunction ||
    kind === SyntaxKind.FunctionExpression
  ) {
    return bodyContainsRunMainOrRunPromise(decl);
  }
  if (kind === SyntaxKind.VariableDeclaration) {
    const init = (decl as VariableDeclaration).getInitializer();
    if (init && (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)) {
      return bodyContainsRunMainOrRunPromise(init);
    }
  }
  return false;
}

/**
 * Detect curried runtime form: Runtime.runPromise(runtime)(effect) — improve.md §9.
 * The outer call has one argument (the effect); the callee is itself a call with one argument (the runtime).
 */
export function isRuntimeCurriedForm(call: CallExpression): boolean {
  const expr = call.getExpression();
  if (call.getArguments().length !== 1) return false;
  const { SyntaxKind } = loadTsMorph();
  if (expr.getKind() !== SyntaxKind.CallExpression) return false;
  const innerCall = expr as CallExpression;
  if (innerCall.getArguments().length !== 1) return false;
  const innerExprText = innerCall.getExpression().getText();
  return (
    innerExprText.includes('.runPromise') ||
    innerExprText.includes('.runSync') ||
    innerExprText.includes('.runFork') ||
    innerExprText.includes('.runCallback') ||
    innerExprText.includes('Runtime.runPromise') ||
    innerExprText.includes('Runtime.runSync') ||
    innerExprText.includes('Runtime.runFork')
  );
}

// =============================================================================
// Program discovery
// =============================================================================

export const findEffectPrograms = (
  sourceFile: SourceFile,
  _opts: Required<AnalyzerOptions>,
): readonly EffectProgram[] => {
  const programs: EffectProgram[] = [];
  const { SyntaxKind } = loadTsMorph();
  const seenCallStarts = new Set<number>();
  const workflowProgramBuilders = new Set<string>();
  const effectImportNames = getEffectLikeNamespaceAliases(
    sourceFile,
    _opts.knownEffectInternalsRoot,
  );
  const nonProgramEffectImportNames = getNonProgramEffectImportNames(sourceFile);
  const importSpecifierByLocalName = new Map<string, string>();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    const def = importDecl.getDefaultImport();
    if (def) importSpecifierByLocalName.set(def.getText(), specifier);
    const ns = importDecl.getNamespaceImport();
    if (ns) importSpecifierByLocalName.set(ns.getText(), specifier);
    for (const named of importDecl.getNamedImports()) {
      importSpecifierByLocalName.set(
        named.getAliasNode()?.getText() ?? named.getName(),
        specifier,
      );
    }
  }

  const inferAliasBackedDiscovery = (aliasName: string): DiscoveryInfo | undefined => {
    const specifier = importSpecifierByLocalName.get(aliasName);
    if (!specifier) return undefined;
    if (specifier.startsWith('effect') || specifier.startsWith('@effect/')) {
      return buildDiscoveryInfo('high', `imported from ${specifier}`);
    }
    if (
      isSpecifierUnderKnownEffectInternalsRoot(
        sourceFile.getFilePath(),
        specifier,
        _opts.knownEffectInternalsRoot,
      )
    ) {
      return buildDiscoveryInfo(
        'high',
        'namespace import resolved under knownEffectInternalsRoot',
      );
    }
    if (specifier.startsWith('.') && /(?:^|\/)Effect(?:\.[jt]sx?)?$/.test(specifier)) {
      return buildDiscoveryInfo('high', `relative Effect module namespace import (${specifier})`);
    }
    return undefined;
  };

  const inferDirectInitializerDiscovery = (initializer: Node): DiscoveryInfo => {
    const inferFromNestedEffectAliasUsage = (node: Node): DiscoveryInfo | undefined => {
      const propertyAccesses = node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
      for (const expr of propertyAccesses) {
        const base = expr.getExpression().getText();
        if (effectImportNames.has(base) && !nonProgramEffectImportNames.has(base)) {
          const aliasInfo = inferAliasBackedDiscovery(base);
          if (aliasInfo?.discoveryConfidence === 'high') {
            return buildDiscoveryInfo('high', `function body uses ${base}.* from trusted Effect alias`);
          }
          return buildDiscoveryInfo('medium', `function body uses Effect-like alias ${base}.*`);
        }
      }

      const calls = node.getDescendantsOfKind(SyntaxKind.CallExpression);
      for (const c of calls) {
        const callee = (c).getExpression();
        if (callee.getKind() === SyntaxKind.Identifier) {
          const local = callee.getText();
          if (effectImportNames.has(local) && !nonProgramEffectImportNames.has(local)) {
            const aliasInfo = inferAliasBackedDiscovery(local);
            if (aliasInfo?.discoveryConfidence === 'high') {
              return buildDiscoveryInfo('high', `function body calls trusted Effect import ${local}(...)`);
            }
            return buildDiscoveryInfo('medium', `function body calls Effect-like import ${local}(...)`);
          }
        }
      }

      return undefined;
    };

    if (
      initializer.getKind() === SyntaxKind.ArrowFunction ||
      initializer.getKind() === SyntaxKind.FunctionExpression
    ) {
      const fn = initializer as
        | ArrowFunction
        | FunctionExpression;
      const body = fn.getBody();
      if (body.getKind() === SyntaxKind.Block) {
        const nested = inferFromNestedEffectAliasUsage(body as Block);
        if (nested) return nested;
      } else {
        const nested = inferFromNestedEffectAliasUsage(body);
        if (nested) return nested;
      }
    }

    const call = getCallExpressionFromInitializer(initializer);
    if (call) {
      const callee = call.getExpression();
      const calleeText = callee.getText();
      if (callee.getKind() === SyntaxKind.Identifier) {
        const local = calleeText;
        if (
          effectImportNames.has(local) &&
          !nonProgramEffectImportNames.has(local)
        ) {
          return (
            inferAliasBackedDiscovery(local) ??
            buildDiscoveryInfo('high', `named import call (${local})`)
          );
        }
        if (local === 'pipe') {
          return buildDiscoveryInfo('medium', 'exact pipe() call detection');
        }
      }
      if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
        const prop = callee as PropertyAccessExpression;
        const baseText = prop.getExpression().getText();
        if (effectImportNames.has(baseText) && !nonProgramEffectImportNames.has(baseText)) {
          return (
            inferAliasBackedDiscovery(baseText) ??
            buildDiscoveryInfo('medium', `Effect-like namespace prefix (${baseText}.*)`)
          );
        }
        if (prop.getName() === 'pipe') {
          return buildDiscoveryInfo('medium', 'exact .pipe() call detection');
        }
      }
    }

    if (initializer.getKind() === SyntaxKind.PropertyAccessExpression) {
      const prop = initializer as PropertyAccessExpression;
      const baseText = prop.getExpression().getText();
      if (effectImportNames.has(baseText) && !nonProgramEffectImportNames.has(baseText)) {
        return (
          inferAliasBackedDiscovery(baseText) ??
          buildDiscoveryInfo('medium', `Effect-like namespace property access (${baseText}.*)`)
        );
      }
    }

    if (initializer.getKind() === SyntaxKind.AwaitExpression) {
      const awaited = (initializer as AwaitExpression).getExpression();
      if (awaited.getKind() === SyntaxKind.CallExpression) {
        return inferDirectInitializerDiscovery(awaited);
      }
    }

    return buildDiscoveryInfo('low', 'heuristic direct initializer match');
  };

  const inferTypeAnnotatedDiscovery = (
    node:
      | VariableDeclaration
      | PropertyDeclaration
      | MethodDeclaration
      | GetAccessorDeclaration,
  ): DiscoveryInfo | undefined => {
    const getTypeNodeText = (
      n: unknown,
    ): string | undefined => {
      const typeNode = (
        n as { getTypeNode?: () => { getText: () => string } | undefined }
      ).getTypeNode?.();
      return typeNode?.getText();
    };

    const typeText = getTypeNodeText(node);
    if (hasEffectFamilyTypeHint(typeText)) {
      return buildDiscoveryInfo('high', 'explicit Effect-family type annotation');
    }

    const isExportedDecl = (() => {
      if (node.getKind() === SyntaxKind.VariableDeclaration) {
        const stmt = (node as VariableDeclaration).getFirstAncestorByKind(
          SyntaxKind.VariableStatement,
        );
        return stmt?.isExported() ?? false;
      }
      if (node.getKind() === SyntaxKind.PropertyDeclaration) {
        const cls = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
        return cls?.isExported() ?? false;
      }
      if (
        node.getKind() === SyntaxKind.MethodDeclaration ||
        node.getKind() === SyntaxKind.GetAccessor
      ) {
        const cls = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
        return cls?.isExported() ?? false;
      }
      return false;
    })();

    if (
      node.getKind() === SyntaxKind.VariableDeclaration ||
      node.getKind() === SyntaxKind.PropertyDeclaration
    ) {
      const initializer = (
        node as VariableDeclaration | PropertyDeclaration
      ).getInitializer();
      if (
        initializer &&
        (initializer.getKind() === SyntaxKind.ArrowFunction ||
          initializer.getKind() === SyntaxKind.FunctionExpression)
      ) {
        const fn = initializer as
          | import('ts-morph').ArrowFunction
          | import('ts-morph').FunctionExpression;
        const fnReturnTypeText = fn.getReturnTypeNode()?.getText();
        if (hasEffectFamilyTypeHint(fnReturnTypeText)) {
          return buildDiscoveryInfo('high', 'function return type annotated as Effect-family');
        }
        if (isExportedDecl && typeText) {
          return buildDiscoveryInfo('medium', 'explicit exported function API type signature');
        }
      }
      if (initializer?.getKind() === SyntaxKind.CallExpression) {
        const call = initializer as CallExpression;
        const typeArgText = call
          .getTypeArguments()
          .map((arg) => arg.getText())
          .join(' ');
        if (hasEffectFamilyTypeHint(typeArgText)) {
          return buildDiscoveryInfo('high', 'call type arguments reference Effect-family types');
        }
        if (isExportedDecl && typeText) {
          return buildDiscoveryInfo('medium', 'explicit exported call-based API type signature');
        }
      }
    }

    if (
      node.getKind() === SyntaxKind.MethodDeclaration ||
      node.getKind() === SyntaxKind.GetAccessor
    ) {
      const fnReturnTypeText = (
        node as MethodDeclaration | GetAccessorDeclaration
      ).getReturnTypeNode?.()?.getText();
      if (hasEffectFamilyTypeHint(fnReturnTypeText)) {
        return buildDiscoveryInfo('high', 'method/getter return type annotated as Effect-family');
      }
      if (isExportedDecl && typeText) {
        return buildDiscoveryInfo('medium', 'explicit exported method/getter API type signature');
      }
    }

    return undefined;
  };

  const isProgramRootExported = (program: EffectProgram): boolean => {
    const node = program.node;
    const kind = node.getKind();
    if (kind === SyntaxKind.CallExpression) {
      // Top-level entrypoint statements / assigned runs don't have a direct export modifier.
      return true;
    }
    if (kind === SyntaxKind.VariableDeclaration) {
      const stmt = (node as VariableDeclaration).getFirstAncestorByKind(
        SyntaxKind.VariableStatement,
      );
      return stmt?.isExported() ?? false;
    }
    if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.ClassDeclaration) {
      return (
        node as FunctionDeclaration | ClassDeclaration
      ).isExported();
    }
    if (
      kind === SyntaxKind.PropertyDeclaration ||
      kind === SyntaxKind.MethodDeclaration ||
      kind === SyntaxKind.GetAccessor
    ) {
      const cls = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      return cls?.isExported() ?? false;
    }
    return true;
  };

  const inferMethodReturnDiscovery = (
    returnStatements: readonly ReturnStatement[],
  ): DiscoveryInfo => {
    for (const ret of returnStatements) {
      const expr = ret.getExpression();
      if (!expr) continue;
      if (
        isLikelyDirectEffectInitializer(
          expr,
          effectImportNames,
          nonProgramEffectImportNames,
        )
      ) {
        return inferDirectInitializerDiscovery(expr);
      }
    }
    return buildDiscoveryInfo('low', 'heuristic method return match');
  };

  const filePath = sourceFile.getFilePath();
  const varDeclarations = sourceFile.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  );
  for (const decl of varDeclarations) {
    const initializer = decl.getInitializer();
    if (
      initializer?.getKind() === SyntaxKind.CallExpression &&
      isWorkflowFactoryCall(
        (initializer as CallExpression).getExpression().getText(),
      )
    ) {
      workflowProgramBuilders.add(decl.getName());
    }
    if (
      _opts.enableEffectWorkflow &&
      initializer?.getKind() === SyntaxKind.CallExpression
    ) {
      const initCall = initializer as CallExpression;
      if (
        isWorkflowMakeOptionsCall(initCall, importSpecifierByLocalName, filePath) ||
        isActivityMakeOptionsCall(initCall, importSpecifierByLocalName, filePath)
      ) {
        workflowProgramBuilders.add(decl.getName());
      }
    }
  }

  const genCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of genCalls) {
    const expression = call.getExpression();
    const exprText = expression.getText();
    const callStart = call.getStart();

    let isWorkflowInvocation = false;
    if (expression.getKind() === SyntaxKind.Identifier) {
      isWorkflowInvocation = workflowProgramBuilders.has(exprText);
    } else if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
      const propertyAccess =
        expression as PropertyAccessExpression;
      const objectText = propertyAccess.getExpression().getText();
      const methodName = propertyAccess.getName();
      isWorkflowInvocation =
        workflowProgramBuilders.has(objectText) && methodName === 'run';
      if (
        _opts.enableEffectWorkflow &&
        !isWorkflowInvocation &&
        methodName === 'run' &&
        call.getArguments().length === 1 &&
        !exprText.includes('runPromise') &&
        !exprText.includes('runSync') &&
        !exprText.includes('runFork') &&
        !exprText.includes('runCallback') &&
        !seenCallStarts.has(callStart)
      ) {
        const name =
          extractProgramName(call) ?? `workflow-${programs.length + 1}`;
        programs.push({
          name,
          node: call,
          type: 'run',
          ...buildDiscoveryInfo('low', 'workflow-like .run(...) shape heuristic'),
        });
        seenCallStarts.add(callStart);
        continue;
      }
    }
    if (isWorkflowInvocation && !seenCallStarts.has(callStart)) {
      const name = extractProgramName(call) ?? `workflow-${programs.length + 1}`;
      programs.push({
        name,
        node: call,
        type: 'run',
        ...buildDiscoveryInfo('medium', 'workflow builder invocation'),
      });
      seenCallStarts.add(callStart);
      continue;
    }

    if (
      _opts.enableEffectWorkflow &&
      expression.getKind() === SyntaxKind.PropertyAccessExpression
    ) {
      const propertyAccess = expression as PropertyAccessExpression;
      const objectText = propertyAccess.getExpression().getText();
      const methodName = propertyAccess.getName();
      const isExecuteEntrypoint =
        (methodName === 'execute' || methodName === 'executeEncoded') &&
        workflowProgramBuilders.has(objectText) &&
        !seenCallStarts.has(callStart);
      if (isExecuteEntrypoint) {
        const name =
          extractProgramName(call) ?? `${objectText}.${methodName}`;
        programs.push({
          name,
          node: call,
          type: 'workflow-execute',
          ...buildDiscoveryInfo('medium', 'workflow/activity .execute entrypoint'),
        });
        seenCallStarts.add(callStart);
        continue;
      }
    }

    if ((exprText === 'gen' || (exprText.endsWith('.gen') && isEffectLikeCallExpression(call, sourceFile, effectImportNames, _opts.knownEffectInternalsRoot))) && !seenCallStarts.has(callStart)) {
      const name = extractProgramName(call) ?? extractEnclosingEffectFnName(call) ?? `program-${programs.length + 1}`;
      programs.push({
        name,
        node: call,
        type: 'generator',
        ...(exprText === 'gen'
          ? buildDiscoveryInfo('medium', 'unqualified gen(...) call')
          : buildDiscoveryInfo('high', 'Effect-like .gen(...) call')),
      });
      seenCallStarts.add(callStart);
    }

    const pipeName = extractProgramName(call);
    if (
      exprText.includes('pipe') &&
      hasEffectInArgs(call, effectImportNames) &&
      !seenCallStarts.has(callStart) &&
      expression.getKind() !== SyntaxKind.PropertyAccessExpression &&
      pipeName !== undefined &&
      !isInsideEffectGen(call)
    ) {
      programs.push({
        name: pipeName,
        node: call,
        type: 'pipe',
        ...buildDiscoveryInfo('medium', 'exact pipe(...) call with Effect-like args'),
      });
      seenCallStarts.add(callStart);
    }

    if ((isRunCall(call) || isRuntimeCurriedForm(call)) && !seenCallStarts.has(callStart)) {
      const name = extractProgramName(call) ?? `run-${programs.length + 1}`;
      programs.push({
        name,
        node: call,
        type: 'run',
        ...buildDiscoveryInfo('high', 'recognized Runtime/Effect run* entrypoint'),
      });
      seenCallStarts.add(callStart);
    }
  }

  for (const decl of varDeclarations) {
    if (!isTopLevelVariableDeclaration(decl)) continue;
    if (isYieldBoundDeclaration(decl)) continue;
    const initializer = decl.getInitializer();
    if (initializer) {
      const name = decl.getName();
      const callInitializer = getCallExpressionFromInitializer(initializer);
      if (callInitializer && isRunCall(callInitializer)) {
        continue;
      }
      if (initializer.getKind() === SyntaxKind.ObjectLiteralExpression) {
        continue;
      }
      const looksLikeEffect = isLikelyDirectEffectInitializer(
        initializer,
        effectImportNames,
        nonProgramEffectImportNames,
      );
      if (looksLikeEffect && !programs.some((p) => p.name === name)) {
        programs.push({
          name,
          node: decl,
          type: 'direct',
          ...(inferTypeAnnotatedDiscovery(decl) ?? inferDirectInitializerDiscovery(initializer)),
        });
      } else if (!looksLikeEffect && !programs.some((p) => p.name === name)) {
        // Even if the initializer doesn't look like Effect code, check type annotations
        // This catches arrow functions like: export const f = (args, deps): Effect.Effect<T> => deps.call(args)
        const typeDiscovery = inferTypeAnnotatedDiscovery(decl);
        if (typeDiscovery) {
          programs.push({
            name,
            node: decl,
            type: 'direct',
            ...typeDiscovery,
          });
        }
      }
    }
  }

  const topLevelStatements = sourceFile.getStatements();
  for (const stmt of topLevelStatements) {
    if (stmt.getKind() !== SyntaxKind.ExpressionStatement) continue;
    const expr = (stmt as ExpressionStatement).getExpression();
    if (expr.getKind() !== SyntaxKind.CallExpression) continue;

    const call = expr as CallExpression;
    const callStart = call.getStart();
    if (seenCallStarts.has(callStart)) continue;

    const calleeExpr = call.getExpression();
    const calleeText = calleeExpr.getText();

    if (isRunCall(call)) {
      const name = `run-${programs.length + 1}`;
      programs.push({
        name,
        node: call,
        type: 'run',
        ...buildDiscoveryInfo('high', 'recognized top-level run* entrypoint'),
      });
      seenCallStarts.add(callStart);
      continue;
    }

    if (calleeText.endsWith('.pipe') || calleeText === 'pipe') {
      const args = call.getArguments();
      const lastArg = args[args.length - 1];
      if (!lastArg) continue;

      const lastArgText = lastArg.getText();
      const isRunTerminated =
        lastArgText.includes('.runMain') ||
        lastArgText.includes('.runPromise') ||
        lastArgText.includes('.runSync') ||
        lastArgText.includes('.runFork');

      if (isRunTerminated) {
        let baseName: string | undefined;
        if (calleeExpr.getKind() === SyntaxKind.PropertyAccessExpression) {
          const propAccess = calleeExpr as PropertyAccessExpression;
          const baseExpr = propAccess.getExpression();
          baseName = baseExpr.getText().split('.').pop();
        }
        const name = baseName && !programs.some(p => p.name === baseName)
          ? baseName
          : `entrypoint-${programs.length + 1}`;
        programs.push({
          name,
          node: call,
          type: 'run',
          ...buildDiscoveryInfo('medium', 'top-level pipe(...).run* terminator pattern'),
        });
        seenCallStarts.add(callStart);
      }
    }

    if (calleeExpr.getKind() === SyntaxKind.Identifier && call.getArguments().length >= 1) {
      const name = (calleeExpr as Identifier).getText();
      const isIndirectWrapper = isIndirectRunMainWrapper(call, sourceFile);
      if (isIndirectWrapper && !programs.some(p => p.name === name)) {
        programs.push({
          name,
          node: call,
          type: 'run',
          ...buildDiscoveryInfo('low', 'indirect run wrapper body heuristic'),
        });
        seenCallStarts.add(callStart);
      }
    }
  }

  const DATA_SCHEMA_CLASS_PATTERNS = [
    'Data.TaggedError',
    'Data.TaggedClass',
    'Data.Class',
    'Data.Error',
    'Schema.Class',
    'Schema.TaggedClass',
    'Schema.TaggedError',
    'Schema.TaggedRequest',
    'Context.Tag',
    'Context.Reference',
    'Effect.Service',
  ];
  const classDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration);
  for (const classDecl of classDeclarations) {
    const name = classDecl.getName();
    if (!name) continue;
    if (programs.some((p) => p.name === name)) continue;
    const heritageClauses = classDecl.getHeritageClauses();
    const matchesPattern = heritageClauses.some((clause) => {
      const clauseText = clause.getText();
      return DATA_SCHEMA_CLASS_PATTERNS.some((p) => clauseText.includes(p));
    });
    if (matchesPattern) {
      programs.push({
        name,
        node: classDecl,
        type: 'class',
        ...buildDiscoveryInfo('medium', 'known Data/Schema/Context class pattern'),
      });
    }
  }

  const topLevelClasses = classDeclarations.filter((c) => {
    const parent = c.getParent();
    return parent === sourceFile || parent?.getParent() === sourceFile;
  });
  for (const classDecl of topLevelClasses) {
    const className = classDecl.getName() ?? 'Anonymous';

    const members = classDecl.getMembers();
    const properties = members.filter(
      m => m.getKind() === SyntaxKind.PropertyDeclaration
    ) as PropertyDeclaration[];

    for (const prop of properties) {
      const initializer = prop.getInitializer();
      if (!initializer) continue;
      const memberName = prop.getName();
      const fullName = `${className}.${memberName}`;
      if (programs.some(p => p.name === fullName)) continue;

      if (
        isLikelyDirectEffectInitializer(
          initializer,
          effectImportNames,
          nonProgramEffectImportNames,
        )
      ) {
        programs.push({
          name: fullName,
          node: prop,
          type: 'classProperty',
          ...(inferTypeAnnotatedDiscovery(prop) ?? inferDirectInitializerDiscovery(initializer)),
        });
      }
    }

    const methods = members.filter(
      m => m.getKind() === SyntaxKind.MethodDeclaration
    ) as MethodDeclaration[];

    for (const method of methods) {
      const memberName = method.getName();
      const fullName = `${className}.${memberName}`;
      if (programs.some(p => p.name === fullName)) continue;

      const body = method.getBody();
      if (!body) continue;

      const returnStatements = body.getDescendantsOfKind(SyntaxKind.ReturnStatement);
      const hasEffectReturn = returnStatements.some(ret => {
        const expr = (ret).getExpression();
        return expr
          ? isLikelyDirectEffectInitializer(
              expr,
              effectImportNames,
              nonProgramEffectImportNames,
            )
          : false;
      });

      if (hasEffectReturn) {
        programs.push({
          name: fullName,
          node: method,
          type: 'classMethod',
          ...(inferTypeAnnotatedDiscovery(method) ?? inferMethodReturnDiscovery(returnStatements)),
        });
      }
    }

    const getters = members.filter(
      m => m.getKind() === SyntaxKind.GetAccessor
    ) as GetAccessorDeclaration[];

    for (const getter of getters) {
      const memberName = getter.getName();
      const fullName = `${className}.${memberName}`;
      if (programs.some(p => p.name === fullName)) continue;

      const body = getter.getBody();
      if (!body) continue;

      const returnStatements = body.getDescendantsOfKind(SyntaxKind.ReturnStatement);
      const hasEffectReturn = returnStatements.some(ret => {
        const expr = (ret).getExpression();
        return expr
          ? isLikelyDirectEffectInitializer(
              expr,
              effectImportNames,
              nonProgramEffectImportNames,
            )
          : false;
      });

      if (hasEffectReturn) {
        programs.push({
          name: fullName,
          node: getter,
          type: 'classMethod',
          ...(inferTypeAnnotatedDiscovery(getter) ?? inferMethodReturnDiscovery(returnStatements)),
        });
      }
    }
  }

  // Discover exported function declarations whose return type is Effect.Effect
  const functionDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
  for (const fnDecl of functionDeclarations) {
    const name = fnDecl.getName();
    if (!name) continue;
    if (programs.some((p) => p.name === name)) continue;
    if (!fnDecl.isExported()) continue;
    // Skip overload signatures (no body) — only discover the implementation
    if (!fnDecl.getBody()) continue;

    const returnTypeNode = fnDecl.getReturnTypeNode();
    if (returnTypeNode && hasEffectFamilyTypeHint(returnTypeNode.getText())) {
      programs.push({
        name,
        node: fnDecl,
        type: 'functionDeclaration',
        ...buildDiscoveryInfo('high', 'exported function with Effect-family return type'),
      });
    }
  }

  return programs.filter((program) => {
    const threshold = _opts.minDiscoveryConfidence ?? 'low';
    const confidence = program.discoveryConfidence ?? 'low';
    if (DISCOVERY_CONFIDENCE_RANK[confidence] < DISCOVERY_CONFIDENCE_RANK[threshold]) {
      return false;
    }
    if (_opts.onlyExportedPrograms && !isProgramRootExported(program)) {
      return false;
    }
    return true;
  });
};

const hasEffectInArgs = (
  call: CallExpression,
  effectImportNames: Set<string>,
): boolean => {
  const args = call.getArguments();
  const argTexts = args.map((arg) => arg.getText());
  return argTexts.some((text) =>
    [...effectImportNames].some((alias) => text.includes(`${alias}.`)),
  );
};

// =============================================================================
// Service definitions
// =============================================================================

export function extractServiceDefinitionsFromFile(sourceFile: SourceFile): ServiceDefinition[] {
  const { SyntaxKind } = loadTsMorph();
  const results: ServiceDefinition[] = [];
  const typeChecker = sourceFile.getProject().getTypeChecker();
  const classDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration);
  for (const classDecl of classDeclarations) {
    const name = classDecl.getName();
    if (!name) continue;
    const extExpr = classDecl.getExtends();
    if (!extExpr) continue;
    const extText = extExpr.getText();
    if (!extText.includes('Context.Tag') && !extText.includes('Effect.Service')) continue;
    let typeArgs: readonly TypeNode[] = extExpr.getTypeArguments();
    if (typeArgs.length < 2) {
      const inner = extExpr.getExpression();
      if (inner && 'getTypeArguments' in inner && typeof (inner as { getTypeArguments: () => unknown[] }).getTypeArguments === 'function') {
        typeArgs = (inner as { getTypeArguments: () => readonly TypeNode[] }).getTypeArguments();
      }
    }
    if (typeArgs.length < 2) continue;
    const interfaceTypeNode = typeArgs[1];
    if (!interfaceTypeNode) continue;
    try {
      const type = typeChecker.getTypeAtLocation(interfaceTypeNode);
      const methods: string[] = [];
      const properties: string[] = [];
      for (const sym of type.getProperties()) {
        const propName = sym.getName();
        if (propName.startsWith('_') || propName === 'constructor') continue;
        const propType = typeChecker.getTypeOfSymbolAtLocation(sym, interfaceTypeNode);
        const callSigs = propType.getCallSignatures();
        if (callSigs.length > 0) methods.push(propName);
        else properties.push(propName);
      }
      const classText = classDecl.getText();
      const hasCustomEquality = classText.includes('Equal.symbol') || classText.includes('[Equal') || classText.includes('equal(');
      const hasCustomHash = classText.includes('Hash.symbol') || classText.includes('[Hash') || classText.includes('hash(');
      results.push({
        tagId: name, methods, properties,
        ...(hasCustomEquality ? { hasCustomEquality } : {}),
        ...(hasCustomHash ? { hasCustomHash } : {}),
      });
    } catch {
      // skip
    }
  }

  for (const classDecl of classDeclarations) {
    const name = classDecl.getName();
    if (!name) continue;
    const extExpr = classDecl.getExtends();
    if (!extExpr) continue;
    const extText = extExpr.getText();
    if (!extText.includes('Data.Class') && !extText.includes('Data.TaggedClass')) continue;
    if (results.some(r => r.tagId === name)) continue;
    const classText = classDecl.getText();
    const hasCustomEquality = classText.includes('Equal.symbol') || classText.includes('[Equal') || classText.includes('equal(');
    const hasCustomHash = classText.includes('Hash.symbol') || classText.includes('[Hash') || classText.includes('hash(');
    if (hasCustomEquality || hasCustomHash) {
      results.push({ tagId: name, methods: [], properties: [], hasCustomEquality, hasCustomHash });
    }
  }

  return results;
}
