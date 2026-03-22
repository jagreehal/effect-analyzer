/**
 * Shared utilities for static Effect analysis: options, ID generation,
 * location/JSDoc extraction, dependency/error aggregation, program naming.
 */

import type {
  Node,
  VariableDeclaration,
  PropertyAssignment,
  CallExpression,
  FunctionDeclaration,
  ClassDeclaration,
  PropertyDeclaration,
  MethodDeclaration,
  GetAccessorDeclaration,
} from 'ts-morph';
import { Option } from 'effect';
import { loadTsMorph } from './ts-morph-loader';
import type {
  AnalysisStats,
  AnalyzerOptions,
  DependencyInfo,
  JSDocTags,
  SemanticRole,
  SourceLocation,
  StaticFlowNode,
} from './types';
import { getStaticChildren } from './types';
import { splitTopLevelUnion } from './type-extractor';

// =============================================================================
// Default Options
// =============================================================================

export const DEFAULT_OPTIONS: Required<AnalyzerOptions> = {
  tsConfigPath: './tsconfig.json',
  resolveReferences: true,
  maxReferenceDepth: 5,
  includeLocations: true,
  assumeImported: false,
  enableEffectWorkflow: false,
  knownEffectInternalsRoot: undefined,
  minDiscoveryConfidence: 'low',
  onlyExportedPrograms: false,
  enableEffectFlow: false,
};

// =============================================================================
// ID Generation
// =============================================================================

let idCounter = 0;

export const resetIdCounter = (): void => {
  idCounter = 0;
};

export const generateId = (): string => `effect-${++idCounter}`;

// =============================================================================
// Node text cache (reduce repeated getText() on large nodes - improve.md §7)
// =============================================================================

const nodeTextCache = new WeakMap<Node, string>();

export function getNodeText(node: Node): string {
  let text = nodeTextCache.get(node);
  if (text === undefined) {
    text = node.getText();
    nodeTextCache.set(node, text);
  }
  return text;
}

// =============================================================================
// Program-level aggregation (dependencies, error types)
// =============================================================================

export function collectErrorTypes(nodes: readonly StaticFlowNode[]): string[] {
  const set = new Set<string>();
  const visit = (list: readonly StaticFlowNode[]) => {
    for (const node of list) {
      if (node.type === 'effect') {
        const err = node.typeSignature?.errorType?.trim();
        if (err && err !== 'never') {
          for (const part of splitTopLevelUnion(err)) {
            set.add(part);
          }
        }
      }
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      if (children.length > 0) visit(children);
    }
  };
  visit(nodes);
  return Array.from(set).sort();
}

export function collectDependencies(nodes: readonly StaticFlowNode[]): DependencyInfo[] {
  const byName = new Map<string, DependencyInfo>();
  const visit = (list: readonly StaticFlowNode[]) => {
    for (const node of list) {
      if (node.type === 'effect') {
        const reqs = (node).requiredServices;
        if (reqs) {
          for (const r of reqs) {
            if (!byName.has(r.serviceId)) {
              byName.set(r.serviceId, {
                name: r.serviceId,
                typeSignature: r.serviceType,
                isLayer: false,
              });
            }
          }
        }

        // Also collect from environment/service yields (yield* ServiceTag pattern)
        // Include both 'environment' role and service-like callees (e.g., FileSystem.FileSystem, Config.string)
        if ((node.semanticRole === 'environment' || node.semanticRole === 'side-effect') && node.callee) {
          const callee = node.callee;
          // Heuristic: service tags typically start with uppercase or are dotted identifiers like FileSystem.FileSystem
          const looksLikeService = /^[A-Z]/.test(callee)
            && !callee.startsWith('Effect.')
            && !callee.startsWith('Schema.')
            && !callee.startsWith('Data.')
            && !callee.startsWith('Config.')
            && !callee.startsWith('Command.')
            && !callee.startsWith('Stream.')
            && !callee.startsWith('Option.')
            && !callee.startsWith('Either.')
            && !callee.startsWith('Cause.')
            && !callee.startsWith('Exit.');
          if (looksLikeService && !byName.has(callee)) {
            byName.set(callee, {
              name: callee,
              typeSignature: node.typeSignature?.requirementsType,
              isLayer: false,
            });
          }
        }
      }
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      if (children.length > 0) visit(children);
    }
  };
  visit(nodes);
  return Array.from(byName.values());
}

// =============================================================================
// Source Location Extraction
// =============================================================================

export const extractLocation = (
  node: Node,
  filePath: string,
  includeLocations: boolean,
): SourceLocation | undefined => {
  if (!includeLocations) {
    return undefined;
  }

  const sourceFile = node.getSourceFile();
  const pos = node.getStart();
  const { line, column } = sourceFile.getLineAndColumnAtPos(pos);
  const endPos = node.getEnd();
  const end = sourceFile.getLineAndColumnAtPos(endPos);

  return {
    filePath,
    line,
    column,
    endLine: end.line,
    endColumn: end.column,
  };
};

// =============================================================================
// JSDoc Extraction
// =============================================================================

/**
 * Extract JSDoc description from a node.
 * Uses ts-morph's getJsDocs() method with fallback to leading comment ranges.
 * Extracts only the description text (before first @tag).
 */
export const extractJSDocDescription = (node: Node): string | undefined => {
  // Try to get JSDoc from the node directly using ts-morph
  const jsDocs = (
    node as unknown as {
      getJsDocs?: () => {
        getText: () => string;
        getComment?: () => string | { text: string }[];
      }[];
    }
  ).getJsDocs?.();

  if (jsDocs && jsDocs.length > 0) {
    const firstJsDoc = jsDocs[0];
    if (!firstJsDoc) return undefined;
    const comment = firstJsDoc.getComment?.();

    if (comment) {
      // Handle both string and array comment formats
      let description: string;
      if (typeof comment === 'string') {
        description = comment;
      } else if (Array.isArray(comment)) {
        description = comment.map((c) => c.text).join('\n');
      } else {
        return undefined;
      }

      // Extract only the description (before first @tag)
      const tagIndex = description.search(/\n\s*@/);
      if (tagIndex !== -1) {
        description = description.substring(0, tagIndex);
      }

      return description.trim() || undefined;
    }

    // Fallback to parsing the raw JSDoc text
    const rawText = firstJsDoc.getText();
    const descriptionMatch = /\/\*\*\s*\n?\s*\*\s*([^@]*?)(?=\n\s*\*\s*@|\*\/)/.exec(rawText);
    if (descriptionMatch?.[1]) {
      return (
        descriptionMatch[1].replace(/\n\s*\*\s*/g, ' ').trim() || undefined
      );
    }
  }

  // Fallback: use leading comment ranges
  const leadingComments = node.getLeadingCommentRanges();
  if (leadingComments.length > 0) {
    const lastComment = leadingComments[leadingComments.length - 1];
    if (!lastComment) return undefined;

    const commentText = lastComment.getText();

    // Check if it's a JSDoc comment
    if (commentText.startsWith('/**')) {
      // Remove /** and */ and * prefixes
      const cleaned = commentText
        .replace(/^\/\*\*\s*/, '')
        .replace(/\s*\*\/\s*$/, '')
        .replace(/^\s*\*\s?/gm, '')
        .trim();

      // Extract only the description (before first @tag)
      const tagIndex = cleaned.search(/\n@/);
      if (tagIndex !== -1) {
        return cleaned.substring(0, tagIndex).trim() || undefined;
      }

      return cleaned || undefined;
    }
  }

  return undefined;
};

/**
 * Extract structured JSDoc tags (@param, @returns, @throws, @example) from a node.
 * Returns undefined if no structured tags are present.
 */
export const extractJSDocTags = (node: Node): JSDocTags | undefined => {
  const tryGetJsDocText = (n: Node): string | undefined => {
    const jsDocs = (
      n as unknown as {
        getJsDocs?: () => { getText: () => string }[];
      }
    ).getJsDocs?.();
    if (jsDocs && jsDocs.length > 0) {
      return jsDocs[0]!.getText();
    }
    // Fallback: leading comment ranges
    const leadingComments = n.getLeadingCommentRanges();
    if (leadingComments.length > 0) {
      const lastComment = leadingComments[leadingComments.length - 1];
      if (lastComment) {
        const commentText = lastComment.getText();
        if (commentText.startsWith('/**')) return commentText;
      }
    }
    return undefined;
  };

  // Try the node itself first
  let text = tryGetJsDocText(node);

  // Walk up to find JSDoc on parent statement (same logic as getJSDocFromParentVariable)
  if (!text) {
    const { SyntaxKind } = loadTsMorph();
    let current = node.getParent();
    // Walk through CallExpression → ArrowFunction → VariableDeclaration → VariableDeclarationList → VariableStatement
    while (current && !text) {
      const kind = current.getKind();
      if (kind === SyntaxKind.VariableStatement) {
        text = tryGetJsDocText(current);
        break;
      }
      if (kind === SyntaxKind.VariableDeclarationList) {
        const grandparent = current.getParent();
        if (grandparent) {
          text = tryGetJsDocText(grandparent);
        }
        break;
      }
      // Keep walking up through CallExpression, ArrowFunction, VariableDeclaration
      if (
        kind === SyntaxKind.CallExpression ||
        kind === SyntaxKind.ArrowFunction ||
        kind === SyntaxKind.VariableDeclaration ||
        kind === SyntaxKind.ParenthesizedExpression
      ) {
        current = current.getParent();
      } else {
        break;
      }
    }
  }

  if (!text) return undefined;
  return parseJSDocTags(text);
};

function parseJSDocTags(rawText: string): JSDocTags | undefined {
  const cleaned = rawText
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, ''))
    .join('\n');

  const params: { name: string; description?: string }[] = [];
  let returns: string | undefined;
  const throws: string[] = [];
  let example: string | undefined;

  const tagPattern = /@(param|returns?|throws?|exception|example)\s*(.*)/gi;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(cleaned)) !== null) {
    const tag = match[1]!.toLowerCase();
    const rest = match[2]!.trim();

    if (tag === 'param') {
      const paramMatch =
        /^(?:\{[^}]*\}\s*)?(\[?\w+(?:=[^\]]*)?]?)\s*(?:-\s*(.*))?$/.exec(rest);
      if (paramMatch) {
        const name = paramMatch[1]!.replace(/^\[|\]$/g, '').replace(/=.*/, '');
        const description = paramMatch[2]?.trim();
        params.push(description ? { name, description } : { name });
      }
    } else if (tag === 'returns' || tag === 'return') {
      returns = rest.replace(/^\{[^}]*\}\s*/, '').trim() || undefined;
    } else if (tag === 'throws' || tag === 'throw' || tag === 'exception') {
      const value = rest.replace(/^\{[^}]*\}\s*/, '').trim();
      if (value) throws.push(value);
    } else if (tag === 'example') {
      // @example may span multiple lines until next @tag or end of comment
      const exampleStart = match.index + match[0].length;
      const nextTagMatch = /\n\s*@\w/.exec(cleaned.slice(exampleStart));
      if (nextTagMatch) {
        const block = cleaned.slice(match.index + match[0].length - rest.length, exampleStart + nextTagMatch.index);
        example = block.trim() || undefined;
      } else {
        const block = cleaned.slice(match.index + match[0].length - rest.length);
        example = block.trim() || undefined;
      }
    }
  }

  if (params.length === 0 && !returns && throws.length === 0 && !example) {
    return undefined;
  }

  return { params, returns, throws, example };
}

/**
 * Get JSDoc description from the parent variable declaration of a node.
 * Used to extract program-level JSDoc from the variable above an Effect program.
 */
export const getJSDocFromParentVariable = (node: Node): string | undefined => {
  const parent = node.getParent();
  const { SyntaxKind } = loadTsMorph();

  if (parent) {
    const parentKind = parent.getKind();

    if (parentKind === SyntaxKind.VariableDeclaration) {
      return extractJSDocDescription(parent);
    }

    // Check for arrow function assignment
    if (parentKind === SyntaxKind.ArrowFunction) {
      const grandparent = parent.getParent();
      if (grandparent?.getKind() === SyntaxKind.VariableDeclaration) {
        return extractJSDocDescription(grandparent);
      }
    }
  }

  return undefined;
};

// =============================================================================
// Path / file helpers
// =============================================================================

/** Gap 6: .js/.jsx need allowJs and a minimal project so tsconfig does not exclude them. */
export function isJsOrJsxPath(path: string): boolean {
  return path.endsWith('.js') || path.endsWith('.jsx');
}

// =============================================================================
// EffectProgram type (used by program-discovery and core-analysis)
// =============================================================================

export interface EffectProgram {
  readonly name: string;
  readonly discoveryConfidence?: 'high' | 'medium' | 'low';
  readonly discoveryReason?: string;
  readonly node: CallExpression | FunctionDeclaration | VariableDeclaration | ClassDeclaration
    | PropertyDeclaration | MethodDeclaration | GetAccessorDeclaration;
  readonly type: 'generator' | 'direct' | 'pipe' | 'run' | 'workflow-execute' | 'class' | 'classProperty' | 'classMethod';
}

// =============================================================================
// Program / yield name extraction
// =============================================================================

export const extractYieldVariableName = (yieldNode: Node): string | undefined => {
  const parent = yieldNode.getParent();
  const { SyntaxKind } = loadTsMorph();

  if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
    return (parent as VariableDeclaration).getName();
  }

  return undefined;
};

export const extractProgramName = (node: Node): string | undefined => {
  const { SyntaxKind } = loadTsMorph();
  const getEnclosingVariableName = (start: Node): string | undefined => {
    let current: Node | undefined = start;
    while (current !== undefined) {
      if (current.getKind() === SyntaxKind.VariableDeclaration) {
        return (current as VariableDeclaration).getName();
      }
      current = current.getParent();
    }
    return undefined;
  };

  // Try to find the variable name this is assigned to
  const parent = node.getParent();
  if (parent) {
    const parentKind = parent.getKind();

    if (parentKind === SyntaxKind.VariableDeclaration) {
      return (parent as VariableDeclaration).getName();
    }

    if (parentKind === SyntaxKind.AwaitExpression) {
      const grandparent = parent.getParent();
      if (grandparent?.getKind() === SyntaxKind.VariableDeclaration) {
        return (grandparent as VariableDeclaration).getName();
      }
    }

    if (parentKind === SyntaxKind.PropertyAssignment) {
      const property = parent as PropertyAssignment;
      const propertyName = property.getName();
      const containerName = getEnclosingVariableName(parent);
      return containerName ? `${containerName}.${propertyName}` : propertyName;
    }

    // Check for arrow function assignment
    if (parentKind === SyntaxKind.ArrowFunction) {
      const grandparent = parent.getParent();
      if (grandparent?.getKind() === SyntaxKind.VariableDeclaration) {
        return (grandparent as VariableDeclaration).getName();
      }
      if (grandparent?.getKind() === SyntaxKind.PropertyAssignment) {
        const property = grandparent as PropertyAssignment;
        const propertyName = property.getName();
        const containerName = getEnclosingVariableName(grandparent);
        return containerName ? `${containerName}.${propertyName}` : propertyName;
      }
    }
  }

  // Walk further up through DIRECT wrappers (CallExpression, ArrowFunction, FunctionExpression)
  // Stop at function boundaries we're not an argument of
  let ancestor: Node | undefined = node;
  for (let depth = 0; ancestor && depth < 6; depth++) {
    ancestor = ancestor.getParent();
    if (!ancestor) break;

    const kind = ancestor.getKind();

    // Found a named container — use it
    if (kind === SyntaxKind.VariableDeclaration) {
      return (ancestor as VariableDeclaration).getName();
    }

    if (kind === SyntaxKind.PropertyAssignment) {
      const property = ancestor as PropertyAssignment;
      const propertyName = property.getName();
      const containerName = getEnclosingVariableName(ancestor);
      return containerName ? `${containerName}.${propertyName}` : propertyName;
    }

    // Stop walking up at Block/SourceFile — we've left the expression context
    if (kind === SyntaxKind.Block || kind === SyntaxKind.SourceFile) break;
  }

  return undefined;
};

/**
 * Walk up the AST from a node to find an enclosing Effect.fn("name") call.
 * Returns the name string if found, e.g., for Effect.gen inside Effect.fn("getUser").
 */
export const extractEnclosingEffectFnName = (node: Node): string | undefined => {
  const { SyntaxKind } = loadTsMorph();
  let current: Node | undefined = node.getParent();
  for (let depth = 0; current && depth < 10; depth++) {
    if (current.getKind() === SyntaxKind.CallExpression) {
      const callExpr = current as CallExpression;
      const exprText = callExpr.getExpression().getText();
      if (exprText === 'Effect.fn' || exprText.endsWith('.fn')) {
        const args = callExpr.getArguments();
        if (args.length > 0) {
          const firstArg = args[0]!.getText();
          // Extract string literal: "name" or 'name'
          const match = /^["'](.+)["']$/.exec(firstArg);
          if (match?.[1]) return match[1];
        }
      }
    }
    current = current.getParent();
  }
  return undefined;
};

// =============================================================================
// Stats Helper
// =============================================================================

export const createEmptyStats = (): AnalysisStats => ({
  totalEffects: 0,
  parallelCount: 0,
  raceCount: 0,
  errorHandlerCount: 0,
  retryCount: 0,
  timeoutCount: 0,
  resourceCount: 0,
  loopCount: 0,
  conditionalCount: 0,
  layerCount: 0,
  interruptionCount: 0,
  unknownCount: 0,
  decisionCount: 0,
  switchCount: 0,
  tryCatchCount: 0,
  terminalCount: 0,
  opaqueCount: 0,
});

// =============================================================================
// Display Name & Semantic Role Computation
// =============================================================================

/**
 * Truncate a string to `max` characters, appending an ellipsis if truncated.
 */
const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max)}…`;

/**
 * Compute a human-readable display label for a StaticFlowNode.
 *
 * @param node - The node to label.
 * @param variableName - Optional variable name the result is assigned to (e.g. from a yield).
 */
export function computeDisplayName(node: StaticFlowNode, variableName?: string): string {
  switch (node.type) {
    case 'effect': {
      const prefix = variableName ?? node.name;
      return prefix ? `${prefix} <- ${node.callee}` : node.callee;
    }

    case 'generator':
      return `Generator (${node.yields.length} yields)`;

    case 'pipe':
      return `Pipe (${node.transformations.length} steps)`;

    case 'parallel':
      return `${node.callee} (${node.children.length})`;

    case 'race':
      return `${node.callee} (${node.children.length} racing)`;

    case 'error-handler':
      return node.name ? `${node.name}: ${node.handlerType}` : node.handlerType;

    case 'retry':
      return node.schedule ? `retry: ${node.schedule}` : 'retry';

    case 'timeout':
      return node.duration ? `timeout: ${node.duration}` : 'timeout';

    case 'resource':
      return 'Resource';

    case 'conditional':
      return truncate(node.condition, 30);

    case 'loop':
      return node.iterSource ? `${node.loopType}(${node.iterSource})` : node.loopType;

    case 'layer':
      return node.isMerged ? 'Layer (merged)' : 'Layer';

    case 'stream': {
      const ops = node.pipeline.map((op) => op.operation);
      const parts: string[] = ['Stream', ...ops];
      if (node.sink) parts.push(node.sink);
      return parts.join(' → ');
    }

    case 'concurrency-primitive':
      return `${node.primitive}.${node.operation}`;

    case 'fiber': {
      const op = node.operation;
      if (node.isDaemon) return `${op} (daemon)`;
      if (node.isScoped) return `${op} (scoped)`;
      return op;
    }

    case 'transform':
      return node.transformType;

    case 'match':
      return `Match.${node.matchOp}`;

    case 'cause':
      return `Cause.${node.causeOp}`;

    case 'exit':
      return `Exit.${node.exitOp}`;

    case 'schedule':
      return `Schedule.${node.scheduleOp}`;

    case 'interruption':
      return node.interruptionType;

    case 'channel': {
      const channelOps = node.pipeline.map((op) => op.operation);
      return channelOps.length > 0 ? `Channel: ${channelOps.join(' → ')}` : 'Channel';
    }

    case 'sink': {
      const sinkOps = node.pipeline.map((op) => op.operation);
      return sinkOps.length > 0 ? `Sink: ${sinkOps.join(' → ')}` : 'Sink';
    }

    case 'decision':
      return truncate(node.condition, 30);

    case 'switch':
      return `switch(${truncate(node.expression, 25)})`;

    case 'try-catch':
      return 'try/catch';

    case 'terminal':
      return node.label ? `${node.terminalKind} ${node.label}` : node.terminalKind;

    case 'opaque':
      return `Opaque: ${truncate(node.reason, 25)}`;

    case 'unknown':
      return `Unknown: ${truncate(node.reason, 30)}`;
  }
}

/**
 * Classify a StaticFlowNode into a SemanticRole for display styling and filtering.
 */
export function computeSemanticRole(node: StaticFlowNode): SemanticRole {
  switch (node.type) {
    case 'effect': {
      // Service call detection: explicit serviceCall/serviceMethod fields
      if (node.serviceCall || node.serviceMethod) return 'service-call';
      // Description-based heuristic: descriptions mentioning "service" or "layer"
      const desc = node.description?.toLowerCase() ?? '';
      if (desc.includes('service')) return 'service-call';
      if (desc.includes('layer') || node.provideKind === 'layer') return 'layer';
      // Callee-based classification
      const callee = node.callee.toLowerCase();
      // Context/service tag access (yield* UserRepo / yield* AppConfig) is environment read, not side effect.
      if (/^[A-Z][A-Za-z0-9_]*$/.test(node.callee) && !node.constructorKind) {
        return 'environment';
      }
      if (
        callee.includes('sync') ||
        callee.includes('promise') ||
        callee.includes('async') ||
        callee.includes('log') ||
        callee.includes('console')
      ) {
        return 'side-effect';
      }
      if (
        callee.includes('succeed') ||
        callee.includes('fail') ||
        callee.includes('die') ||
        callee.includes('void') ||
        callee.includes('never') ||
        callee.includes('gen') ||
        callee.includes('make') ||
        node.constructorKind
      ) {
        return 'constructor';
      }
      return 'side-effect';
    }

    case 'generator':
    case 'pipe':
      return 'constructor';

    case 'parallel':
    case 'race':
    case 'concurrency-primitive':
      return 'concurrency';

    case 'error-handler':
    case 'cause':
    case 'exit':
      return 'error-handler';

    case 'retry':
    case 'timeout':
    case 'schedule':
      return 'scheduling';

    case 'resource':
      return 'resource';

    case 'conditional':
    case 'loop':
    case 'match':
    case 'decision':
    case 'switch':
    case 'terminal':
      return 'control-flow';

    case 'try-catch':
      return 'error-handler';

    case 'opaque':
      return 'unknown';

    case 'layer':
      return 'layer';

    case 'stream':
    case 'channel':
    case 'sink':
      return 'stream';

    case 'fiber':
    case 'interruption':
      return 'fiber';

    case 'transform':
      return 'transform';

    case 'unknown':
      return 'unknown';
  }
}
