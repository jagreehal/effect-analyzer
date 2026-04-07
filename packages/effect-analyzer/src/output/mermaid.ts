/**
 * Mermaid diagram generation for Effect IR
 *
 * Aligned with awaitly-analyze: Start/End nodes, explicit edges,
 * optional subgraphs for parallel/race, sequential flow for pipe/generator.
 */

import { Effect, Option } from 'effect';
import type {
  ProjectServiceMap,
  StaticEffectIR,
  StaticFlowNode,
  StaticFiberNode,
  StaticRetryNode,
  StaticEffectNode,
  MermaidOptions,
  MermaidStyles,
  MermaidDetailLevel,
  EffectPath,
} from '../types';
import { getStaticChildren } from '../types';
import { buildDataFlowGraph } from '../data-flow';
import { analyzeErrorFlow, analyzeErrorPropagation } from '../error-flow';
import { DEFAULT_LABEL_MAX, truncateDisplayText, countMeaningfulNodes } from '../analysis-utils';

// =============================================================================
// Default styles (include start/end for Start/End nodes)
// =============================================================================

const DEFAULT_STYLES: MermaidStyles = {
  effect: 'fill:#90EE90,stroke:#333,stroke-width:2px',
  generator: 'fill:#FFB6C1,stroke:#333,stroke-width:2px',
  pipe: 'fill:#ADD8E6,stroke:#333,stroke-width:2px',
  parallel: 'fill:#FFA500,stroke:#333,stroke-width:2px',
  race: 'fill:#FF6347,stroke:#333,stroke-width:2px',
  errorHandler: 'fill:#FFD700,stroke:#333,stroke-width:2px',
  retry: 'fill:#EE82EE,stroke:#333,stroke-width:2px',
  timeout: 'fill:#87CEEB,stroke:#333,stroke-width:2px',
  resource: 'fill:#98FB98,stroke:#333,stroke-width:2px',
  conditional: 'fill:#DDA0DD,stroke:#333,stroke-width:2px',
  loop: 'fill:#F0E68C,stroke:#333,stroke-width:2px',
  layer: 'fill:#E6E6FA,stroke:#333,stroke-width:2px',
  stream: 'fill:#E0F7FA,stroke:#333,stroke-width:2px',
  concurrencyPrimitive: 'fill:#B0E0E6,stroke:#333,stroke-width:2px',
  fiber: 'fill:#DDA0DD,stroke:#333,stroke-width:2px',
  decision: 'fill:#DDA0DD,stroke:#333,stroke-width:2px',
  switch: 'fill:#FFD700,stroke:#333,stroke-width:2px',
  tryCatch: 'fill:#FFE4B5,stroke:#333,stroke-width:2px',
  terminal: 'fill:#FF6B6B,stroke:#333,stroke-width:2px',
  opaque: 'fill:#FF9800,stroke:#333,stroke-width:2px',
  unknown: 'fill:#D3D3D3,stroke:#333,stroke-width:1px',
  start: 'fill:#c8e6c9,stroke:#2e7d32',
  end: 'fill:#ffcdd2,stroke:#c62828',
  cause: 'fill:#FF8A80,stroke:#D32F2F,stroke-width:2px',
  exit: 'fill:#B39DDB,stroke:#512DA8,stroke-width:2px',
  schedule: 'fill:#80DEEA,stroke:#00838F,stroke-width:2px',
  match: 'fill:#FFE082,stroke:#F57F17,stroke-width:2px',
  transform: 'fill:#A5D6A7,stroke:#388E3C,stroke-width:2px',
  channel: 'fill:#90CAF9,stroke:#1565C0,stroke-width:2px',
  sink: 'fill:#CE93D8,stroke:#7B1FA2,stroke-width:2px',
  interruption: 'fill:#FFAB91,stroke:#BF360C,stroke-width:2px',
};

const DEFAULT_OPTIONS: Required<
  Omit<MermaidOptions, 'title' | 'includeTypeSignatures' | 'detail' | 'dataFlowOverlay' | 'errorFlowOverlay'>
> & {
  title?: string;
  includeTypeSignatures?: boolean;
  detail?: MermaidDetailLevel;
  dataFlowOverlay?: boolean;
  errorFlowOverlay?: boolean;
} = {
  direction: 'TB',
  includeIds: false,
  includeDescriptions: true,
  styles: DEFAULT_STYLES,
  compact: false,
  includeTypeSignatures: true,
  useSubgraphs: true,
  showConditions: true,
  detail: 'verbose',
};

// =============================================================================
// Internal types (awaitly-style context and result)
// =============================================================================

interface Edge {
  from: string;
  to: string;
  label?: string;
}

interface Subgraph {
  id: string;
  label: string;
  content: string[];
}

interface RenderContext {
  opts: ResolvedMermaidOptions;
  nodeCounter: number;
  edges: Edge[];
  subgraphs: Subgraph[];
  styleClasses: Map<string, string>;
  /** Map from IR node id to mermaid node ID (for enhanced overlay) */
  nodeIdMap: Map<string, string>;
  /** Optional label annotations per node id (for enhanced renderer) */
  nodeLabelAnnotations?: Map<string, string[]> | undefined;
}

/** Options with defaults applied (all required fields set). */
interface ResolvedMermaidOptions {
  direction: 'TB' | 'LR' | 'BT' | 'RL';
  includeIds: boolean;
  includeDescriptions: boolean;
  styles: MermaidStyles;
  compact: boolean;
  useSubgraphs: boolean;
  showConditions: boolean;
  detail: MermaidDetailLevel;
  title?: string | undefined;
  includeTypeSignatures?: boolean | undefined;
}

interface RenderResult {
  firstNodeId: string | null;
  lastNodeIds: string[];
}

// =============================================================================
// Utilities
// =============================================================================

function escapeLabel(label: string): string {
  return label
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, "'")
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/#/g, '&num;')
    .replace(/\|/g, '&#124;');
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

// =============================================================================
// Internal: render static Mermaid (sync) for reuse by static and enhanced
// =============================================================================

function renderStaticMermaidInternal(
  ir: StaticEffectIR,
  options?: Partial<MermaidOptions>,
  nodeLabelAnnotations?: Map<string, string[]>,
): { lines: string[]; context: RenderContext } {
  const autoDetail = (): MermaidDetailLevel => {
    const nodeCount = countMeaningfulNodes(ir.root.children);
    if (nodeCount > 80) return 'compact';
    if (nodeCount >= 30) return 'standard';
    return 'verbose';
  };

  const opts: ResolvedMermaidOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    useSubgraphs: options?.useSubgraphs ?? true,
    showConditions: options?.showConditions ?? true,
    detail: options?.detail ?? autoDetail(),
  };
  const context: RenderContext = {
    opts,
    nodeCounter: 0,
    edges: [],
    subgraphs: [],
    styleClasses: new Map(),
    nodeIdMap: new Map(),
    nodeLabelAnnotations,
  };

  const lines: string[] = [];

  lines.push(`flowchart ${opts.direction}`);
  lines.push('');
  lines.push(`  %% Program: ${ir.root.programName}`);
  lines.push('');

  const startId = 'start';
  const endId = 'end_node';
  lines.push(`  ${startId}((Start))`);
  lines.push(`  ${endId}((End))`);
  lines.push('');

  const { firstNodeId, lastNodeIds } = renderNodes(
    ir.root.children,
    context,
    lines,
  );

  if (firstNodeId) {
    context.edges.push({ from: startId, to: firstNodeId });
  }
  for (const lastId of lastNodeIds) {
    context.edges.push({ from: lastId, to: endId });
  }

  for (const subgraph of context.subgraphs) {
    lines.push('');
    lines.push(`  subgraph ${subgraph.id}["${subgraph.label}"]`);
    for (const line of subgraph.content) {
      lines.push(`    ${line}`);
    }
    lines.push('  end');
  }

  lines.push('');
  lines.push('  %% Edges');
  for (const edge of context.edges) {
    if (edge.label && opts.showConditions) {
      lines.push(`  ${edge.from} -->|${escapeLabel(edge.label)}| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
  }

  const styles = { ...DEFAULT_STYLES, ...opts.styles };
  lines.push('');
  lines.push('  %% Styles');

  // Collect which style keys are actually used by nodes in the diagram
  const usedStyleKeys = new Set<string>(['start', 'end']);
  for (const [, styleClass] of context.styleClasses) {
    // styleClass values are like "effectStyle", "decisionStyle" — strip "Style" suffix to get the key
    const key = styleClass.endsWith('Style') ? styleClass.slice(0, -5) : styleClass;
    usedStyleKeys.add(key);
  }

  if (styles.start) {
    lines.push(`  classDef startStyle ${styles.start}`);
  }
  if (styles.end) {
    lines.push(`  classDef endStyle ${styles.end}`);
  }
  for (const [key, value] of Object.entries(styles)) {
    if (value && key !== 'start' && key !== 'end' && usedStyleKeys.has(key)) {
      lines.push(`  classDef ${key}Style ${value}`);
    }
  }
  lines.push(`  class ${startId} startStyle`);
  lines.push(`  class ${endId} endStyle`);
  for (const [nodeId, styleClass] of context.styleClasses) {
    lines.push(`  class ${nodeId} ${styleClass}`);
  }

  // Data-flow overlay: annotate edges with variable names and highlight warnings
  if (options?.dataFlowOverlay) {
    const dataFlow = buildDataFlowGraph(ir);

    // Build IR-node-id → mermaid-node-id mapping for data-flow nodes
    const irToMermaid = context.nodeIdMap;

    // Annotate edges between nodes with variable name labels
    lines.push('');
    lines.push('  %% Data-flow variable annotations');
    lines.push('  linkStyle default stroke:#999');
    for (const dfEdge of dataFlow.edges) {
      if (dfEdge.from === '__context__') continue;
      const fromMermaid = irToMermaid.get(dfEdge.from);
      const toMermaid = irToMermaid.get(dfEdge.to);
      if (fromMermaid && toMermaid && dfEdge.key && dfEdge.key !== 'value') {
        lines.push(`  ${fromMermaid} -.->|${dfEdge.key}| ${toMermaid}`);
      }
    }

    // Highlight nodes with undefined reads
    if (dataFlow.undefinedReads.length > 0) {
      lines.push('');
      lines.push('  %% Data-flow warnings');
      lines.push('  classDef dataFlowWarning fill:#fff3cd,stroke:#856404,stroke-width:2px');
      for (const read of dataFlow.undefinedReads) {
        const mermaidId = irToMermaid.get(read.readerId);
        if (mermaidId) {
          lines.push(`  class ${mermaidId} dataFlowWarning`);
        }
      }
    }

    // Highlight nodes with duplicate writes
    if (dataFlow.duplicateWrites.length > 0) {
      lines.push('  classDef duplicateWrite fill:#f8d7da,stroke:#721c24,stroke-width:2px');
      for (const dup of dataFlow.duplicateWrites) {
        for (const writerId of dup.writerIds) {
          const mermaidId = irToMermaid.get(writerId);
          if (mermaidId) {
            lines.push(`  class ${mermaidId} duplicateWrite`);
          }
        }
      }
    }
  }

  // Error-flow overlay: annotate nodes with error types and highlight unhandled errors
  if (options?.errorFlowOverlay) {
    const errorFlow = analyzeErrorFlow(ir);
    const errorPropagation = analyzeErrorPropagation(ir);
    const irToMermaid = context.nodeIdMap;

    lines.push('');
    lines.push('  %% Error-flow overlay');
    lines.push('  classDef canFail fill:#FFECB3,stroke:#F57F17,stroke-width:2px');
    lines.push('  classDef unhandledError fill:#FFCDD2,stroke:#C62828,stroke-width:3px');

    // Tag nodes that can fail
    for (const stepError of errorFlow.stepErrors) {
      if (stepError.errors.length > 0) {
        const mermaidId = irToMermaid.get(stepError.stepId);
        if (mermaidId) {
          lines.push(`  class ${mermaidId} canFail`);
        }
      }
    }

    // Tag nodes with unhandled error propagation (errors that reach the top without a handler)
    for (const prop of errorPropagation.propagation) {
      if (prop.possibleErrors.length > 0 && !prop.narrowedBy) {
        const mermaidId = irToMermaid.get(prop.atNode);
        if (mermaidId) {
          lines.push(`  class ${mermaidId} unhandledError`);
        }
      }
    }

    // Annotate error-handler edges with narrowing info
    for (const prop of errorPropagation.propagation) {
      if (prop.narrowedBy && prop.narrowedBy.removedErrors.length > 0) {
        const handlerMermaid = irToMermaid.get(prop.narrowedBy.handler);
        const nodeMermaid = irToMermaid.get(prop.atNode);
        if (handlerMermaid && nodeMermaid) {
          const narrowed = prop.narrowedBy.removedErrors.join(', ');
          lines.push(`  ${nodeMermaid} -.->|catches ${narrowed}| ${handlerMermaid}`);
        }
      }
    }
  }

  return { lines, context };
}

// =============================================================================
// Node rendering (sequential flow: firstNodeId, lastNodeIds)
// =============================================================================

function renderNodes(
  nodes: readonly StaticFlowNode[],
  context: RenderContext,
  lines: string[],
  depth = 0,
): RenderResult {
  if (nodes.length === 0) {
    return { firstNodeId: null, lastNodeIds: [] };
  }

  let firstNodeId: string | null = null;
  let prevLastNodeIds: string[] = [];

  for (const node of nodes) {
    const result = renderNode(node, context, lines, depth);
    if (firstNodeId === null && result.firstNodeId) {
      firstNodeId = result.firstNodeId;
    }
    if (result.firstNodeId) {
      for (const prevId of prevLastNodeIds) {
        context.edges.push({ from: prevId, to: result.firstNodeId });
      }
    }
    prevLastNodeIds = result.lastNodeIds;
  }

  return { firstNodeId, lastNodeIds: prevLastNodeIds };
}

function getNodeId(node: StaticFlowNode, context: RenderContext): string {
  const id =
    context.opts.includeIds && 'id' in node
      ? node.id
      : `n${String(++context.nodeCounter)}`;
  return sanitizeId(id);
}

function getNodeLabel(
  node: StaticFlowNode,
  opts: RenderContext['opts'],
  annotations?: string[],
): string {
  if (!opts.includeDescriptions) {
    return node.type;
  }

  // Base label (compact mode)
  let label: string;
  switch (node.type) {
    case 'effect':
      label = truncateDisplayText(node.callee || 'Effect', DEFAULT_LABEL_MAX);
      break;
    case 'generator':
      label = `Generator (${node.yields.length} yields)`;
      break;
    case 'pipe':
      label = `Pipe (${node.transformations.length + 1} steps)`;
      break;
    case 'parallel':
      label = truncateDisplayText(
        `${node.callee} (${node.children.length} effects)`,
        DEFAULT_LABEL_MAX,
      );
      break;
    case 'race':
      label = truncateDisplayText(
        `${node.callee} (${node.children.length} racing)`,
        DEFAULT_LABEL_MAX,
      );
      break;
    case 'error-handler':
      label = node.handlerType;
      break;
    case 'retry':
      label = `Retry${node.schedule ? `(${node.schedule})` : ''}`;
      break;
    case 'timeout':
      label = `Timeout${node.duration ? `(${node.duration})` : ''}`;
      break;
    case 'resource':
      label = 'Resource';
      break;
    case 'conditional':
      label = `${node.conditionalType} (${truncate(node.condition, 20)})`;
      break;
    case 'loop':
      label = node.iterSource
        ? truncateDisplayText(
            `${node.loopType}(${node.iterSource})`,
            DEFAULT_LABEL_MAX,
          )
        : node.loopType;
      break;
    case 'layer':
      label = `Layer${node.isMerged ? ' (merged)' : ''}`;
      break;
    case 'stream':
      label = truncateDisplayText(
        `Stream${node.pipeline.length > 0 ? `.${node.pipeline.map((p) => p.operation).join(' → ')}` : ''}${node.sink ? ` → ${node.sink}` : ''}`,
        DEFAULT_LABEL_MAX,
      );
      break;
    case 'concurrency-primitive':
      label = `${node.primitive}.${node.operation}${node.strategy ? ` (${node.strategy})` : ''}`;
      break;
    case 'fiber':
      label = `${node.operation}${node.isDaemon ? ' (daemon)' : ''}${node.isScoped ? ' (scoped)' : ''}`;
      break;
    case 'decision':
      label = node.label || truncate(node.condition, 30);
      break;
    case 'switch':
      label = `Switch: ${truncate(node.expression, 25)}`;
      break;
    case 'try-catch':
      label = 'Try/Catch';
      break;
    case 'terminal':
      label = node.terminalKind;
      break;
    case 'opaque':
      label = `⚠ ${node.reason}`;
      break;
    case 'cause':
      label = `Cause: ${node.causeOp}`;
      break;
    case 'exit':
      label = `Exit: ${node.exitOp}`;
      break;
    case 'schedule':
      label = `Schedule: ${node.scheduleOp}`;
      break;
    case 'match':
      label = `Match: ${node.matchOp}${node.matchedTags?.length ? ` (${node.matchedTags.join(', ')})` : ''}`;
      break;
    case 'transform':
      label = `${node.transformType}${node.isEffectful ? ' (effectful)' : ''}`;
      break;
    case 'channel':
      label = `Channel${node.pipeline.length > 0 ? `.${node.pipeline.map(p => p.operation).join(' → ')}` : ''}`;
      break;
    case 'sink':
      label = `Sink${node.pipeline.length > 0 ? `.${node.pipeline.map(p => p.operation).join(' → ')}` : ''}`;
      break;
    case 'interruption':
      label = node.interruptionType;
      break;
    case 'unknown':
      label = `Unknown: ${node.reason}`;
      break;
    default: {
      const n = node as StaticFlowNode & { type: string };
      label = n.type ?? 'unknown';
      break;
    }
  }

  // Standard/Verbose: use displayName if available
  let usedDisplayName = false;
  if (opts.detail !== 'compact' && node.displayName) {
    label = node.displayName;
    usedDisplayName = true;
  }

  // Verbose: append type signature and semantic role
  // Skip inline type signature when annotations already carry one (enhanced renderer)
  const annotationsHaveTypeSig = annotations?.some((a) => a.startsWith('<') && a.includes(','));
  if (opts.detail === 'verbose') {
    if (!annotationsHaveTypeSig && node.type === 'effect' && opts.includeTypeSignatures && node.typeSignature) {
      const sig = node.typeSignature;
      label += `\n<${sig.successType}, ${sig.errorType}, ${sig.requirementsType}>`;
    }
    if (node.semanticRole && node.semanticRole !== 'unknown' && node.semanticRole !== 'constructor') {
      label += `\n(${node.semanticRole})`;
    }
  }

  if (annotations?.length) {
    // When displayName is used, skip type signature annotations to avoid duplication
    const filteredAnnotations = usedDisplayName
      ? annotations.filter((a) => !a.startsWith('<') || !a.includes(','))
      : annotations;
    if (filteredAnnotations.length) {
      label += '\n' + filteredAnnotations.join('\n');
    }
  }
  return label;
}

function getNodeStyleClass(node: StaticFlowNode): string {
  if (node.type === 'concurrency-primitive') return 'concurrencyPrimitiveStyle';
  if (node.type === 'try-catch') return 'tryCatchStyle';
  if (node.type === 'error-handler') return 'errorHandlerStyle';
  return `${node.type}Style`;
}

function renderNode(
  node: StaticFlowNode,
  context: RenderContext,
  lines: string[],
  depth = 0,
): RenderResult {
  const nodeId = getNodeId(node, context);
  const annotations = context.nodeLabelAnnotations?.get(node.id);
  const label = getNodeLabel(node, context.opts, annotations);
  const styleClass = getNodeStyleClass(node);

  // Skip the "Generator (N yields)" box so the diagram shows the actual yield steps (varName <- callee, types, etc.)
  // Skip decision nodes too — the case 'decision' block creates its own diamond-shaped node.
  if (node.type !== 'generator' && node.type !== 'decision') {
    lines.push(`  ${nodeId}["${escapeLabel(label)}"]`);
    context.styleClasses.set(nodeId, styleClass);
    context.nodeIdMap.set(node.id, nodeId);
  }

  // Compact mode: at depth > 0, render compound nodes as leaf nodes (don't recurse)
  // This prevents deeply nested structures from exploding the diagram.
  // Leaf types (effect, unknown) always render as-is regardless of depth.
  const compactLeafTypes = new Set(['effect', 'unknown', 'opaque', 'terminal', 'exit', 'schedule']);
  if (context.opts.detail === 'compact' && depth > 0 && !compactLeafTypes.has(node.type)) {
    // For generators, emit the summary node (generator skips pre-emission above)
    if (node.type === 'generator') {
      const summaryName = node.name || node.displayName || 'Generator';
      const summaryLabel = `${summaryName} (${node.yields.length} steps)`;
      lines.push(`  ${nodeId}["${escapeLabel(summaryLabel)}"]`);
      context.styleClasses.set(nodeId, styleClass);
      context.nodeIdMap.set(node.id, nodeId);
    }
    // All other compound types already have their node emitted above
    return { firstNodeId: nodeId, lastNodeIds: [nodeId] };
  }

  switch (node.type) {
    case 'effect':
    case 'unknown':
      return { firstNodeId: nodeId, lastNodeIds: [nodeId] };

    case 'stream': {
      const childResult = renderNode(node.source, context, lines, depth + 1);
      if (childResult.firstNodeId) {
        context.edges.push({ from: nodeId, to: childResult.firstNodeId });
      }
      return { firstNodeId: nodeId, lastNodeIds: childResult.lastNodeIds };
    }

    case 'concurrency-primitive': {
      if (node.source) {
        const childResult = renderNode(node.source, context, lines, depth + 1);
        if (childResult.firstNodeId) {
          context.edges.push({ from: nodeId, to: childResult.firstNodeId });
        }
        return { firstNodeId: nodeId, lastNodeIds: childResult.lastNodeIds };
      }
      return { firstNodeId: nodeId, lastNodeIds: [nodeId] };
    }

    case 'fiber': {
      if (node.fiberSource) {
        const childResult = renderNode(node.fiberSource, context, lines, depth + 1);
        if (childResult.firstNodeId) {
          context.edges.push({ from: nodeId, to: childResult.firstNodeId });
        }
        return { firstNodeId: nodeId, lastNodeIds: childResult.lastNodeIds };
      }
      return { firstNodeId: nodeId, lastNodeIds: [nodeId] };
    }

    case 'generator': {
      // Sequential: yield1 -> yield2 -> ... (no "Generator (N yields)" box; show each yield's name/callee/types)
      const children = node.yields.map((y) => y.effect);
      const result = renderNodes(children, context, lines, depth + 1);
      if (result.firstNodeId) {
        return {
          firstNodeId: result.firstNodeId,
          lastNodeIds: result.lastNodeIds.length > 0 ? result.lastNodeIds : [result.firstNodeId],
        };
      }
      // Empty generator: emit a single node so edges stay valid
      lines.push(`  ${nodeId}["${escapeLabel(label)}"]`);
      context.styleClasses.set(nodeId, styleClass);
      context.nodeIdMap.set(node.id, nodeId);
      return { firstNodeId: nodeId, lastNodeIds: [nodeId] };
    }

    case 'pipe': {
      // Sequential: initial -> t1 -> t2 -> ...
      const chain = [node.initial, ...node.transformations];
      const result = renderNodes(chain, context, lines, depth + 1);
      if (result.firstNodeId) {
        context.edges.push({ from: nodeId, to: result.firstNodeId });
      }
      return {
        firstNodeId: nodeId,
        lastNodeIds: result.lastNodeIds.length > 0 ? result.lastNodeIds : [nodeId],
      };
    }

    case 'parallel': {
      const forkId = `parallel_fork_${++context.nodeCounter}`;
      const joinId = `parallel_join_${context.nodeCounter}`;
      const modeLabel = node.mode === 'parallel' ? 'Parallel' : 'All';
      lines.push(`  ${forkId}{{"${modeLabel} (${node.children.length})"}}`);
      lines.push(`  ${joinId}{{"Join"}}`);
      context.styleClasses.set(forkId, 'parallelStyle');
      context.styleClasses.set(joinId, 'parallelStyle');
      context.edges.push({ from: nodeId, to: forkId });

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (!child) continue;
        const branchResult = renderNode(child, context, lines, depth + 1);
        if (branchResult.firstNodeId) {
          context.edges.push({
            from: forkId,
            to: branchResult.firstNodeId,
            label: node.branchLabels?.[i] ?? `branch ${i + 1}`,
          });
        }
        for (const lastId of branchResult.lastNodeIds) {
          context.edges.push({ from: lastId, to: joinId });
        }
      }
      return { firstNodeId: nodeId, lastNodeIds: [joinId] };
    }

    case 'race': {
      const forkId = `race_fork_${++context.nodeCounter}`;
      const joinId = `race_join_${context.nodeCounter}`;
      lines.push(`  ${forkId}{{{"Race (${node.children.length})"}}}`);
      lines.push(`  ${joinId}{{{"Winner"}}}`);
      context.styleClasses.set(forkId, 'raceStyle');
      context.styleClasses.set(joinId, 'raceStyle');
      context.edges.push({ from: nodeId, to: forkId });

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (!child) continue;
        const branchResult = renderNode(child, context, lines, depth + 1);
        if (branchResult.firstNodeId) {
          context.edges.push({
            from: forkId,
            to: branchResult.firstNodeId,
            label: node.raceLabels?.[i] ?? `racer ${i + 1}`,
          });
        }
        for (const lastId of branchResult.lastNodeIds) {
          context.edges.push({ from: lastId, to: joinId });
        }
      }
      return { firstNodeId: nodeId, lastNodeIds: [joinId] };
    }

    case 'error-handler': {
      const sourceResult = renderNode(node.source, context, lines, depth + 1);
      const handlerNodeId = `err_handler_${++context.nodeCounter}`;
      lines.push(`  ${handlerNodeId}["${node.handlerType}"]`);
      context.styleClasses.set(handlerNodeId, 'errorHandlerStyle');
      if (sourceResult.lastNodeIds.length > 0) {
        context.edges.push({
          from: sourceResult.lastNodeIds[0]!,
          to: handlerNodeId,
          label: node.errorEdgeLabel ?? 'on error',
        });
      }
      let lastIds = [handlerNodeId];
      if (node.handler) {
        const handlerResult = renderNode(node.handler, context, lines, depth + 1);
        if (handlerResult.firstNodeId) {
          context.edges.push({ from: handlerNodeId, to: handlerResult.firstNodeId });
        }
        lastIds = handlerResult.lastNodeIds;
      }
      return {
        firstNodeId: sourceResult.firstNodeId ?? nodeId,
        lastNodeIds: lastIds,
      };
    }

    case 'retry':
    case 'timeout': {
      const sourceResult = renderNode(node.source, context, lines, depth + 1);
      const wrapperId = `${node.type}_${++context.nodeCounter}`;
      const label =
        node.type === 'retry'
          ? `Retry${node.schedule ? `(${node.schedule})` : ''}`
          : `Timeout${node.duration ? `(${node.duration})` : ''}`;
      lines.push(`  ${wrapperId}["${label}"]`);
      context.styleClasses.set(wrapperId, `${node.type}Style`);
      if (sourceResult.lastNodeIds.length > 0) {
        context.edges.push({
          from: sourceResult.lastNodeIds[0]!,
          to: wrapperId,
        });
      }
      return {
        firstNodeId: sourceResult.firstNodeId ?? nodeId,
        lastNodeIds: [wrapperId],
      };
    }

    case 'resource': {
      const acquireResult = renderNode(node.acquire, context, lines, depth + 1);
      const resourceId = `resource_${++context.nodeCounter}`;
      lines.push(`  ${resourceId}["Resource"]`);
      context.styleClasses.set(resourceId, 'resourceStyle');
      if (acquireResult.lastNodeIds.length > 0) {
        context.edges.push({
          from: acquireResult.lastNodeIds[0]!,
          to: resourceId,
        });
      }
      let lastIds = [resourceId];
      if (node.use) {
        const useResult = renderNode(node.use, context, lines, depth + 1);
        if (useResult.firstNodeId) {
          context.edges.push({ from: resourceId, to: useResult.firstNodeId });
        }
        lastIds = useResult.lastNodeIds;
      }
      return {
        firstNodeId: acquireResult.firstNodeId ?? nodeId,
        lastNodeIds: lastIds,
      };
    }

    case 'conditional': {
      const decisionId = `cond_${++context.nodeCounter}`;
      const condLabel = node.conditionLabel ?? truncate(node.condition, 25);
      lines.push(`  ${decisionId}{"${escapeLabel(condLabel)}"}`);
      context.styleClasses.set(decisionId, 'conditionalStyle');
      context.edges.push({ from: nodeId, to: decisionId });

      const onTrueResult = renderNode(node.onTrue, context, lines, depth + 1);
      if (onTrueResult.firstNodeId) {
        context.edges.push({
          from: decisionId,
          to: onTrueResult.firstNodeId,
          label: node.trueEdgeLabel ?? 'true',
        });
      }
      const lastNodeIds: string[] = [...onTrueResult.lastNodeIds];

      if (node.onFalse) {
        const onFalseResult = renderNode(node.onFalse, context, lines, depth + 1);
        if (onFalseResult.firstNodeId) {
          context.edges.push({
            from: decisionId,
            to: onFalseResult.firstNodeId,
            label: node.falseEdgeLabel ?? 'false',
          });
        }
        lastNodeIds.push(...onFalseResult.lastNodeIds);
      } else {
        lastNodeIds.push(decisionId);
      }
      return { firstNodeId: nodeId, lastNodeIds };
    }

    case 'loop': {
      const loopId = `loop_${++context.nodeCounter}`;
      const bodyLabel = node.iterSource
        ? truncateDisplayText(
            `${node.loopType}(${node.iterSource})`,
            DEFAULT_LABEL_MAX,
          )
        : node.loopType;
      lines.push(`  ${loopId}(["${escapeLabel(bodyLabel)}"])`);
      context.styleClasses.set(loopId, 'loopStyle');
      context.edges.push({ from: nodeId, to: loopId });

      const bodyResult = renderNode(node.body, context, lines, depth + 1);
      if (bodyResult.firstNodeId) {
        context.edges.push({ from: loopId, to: bodyResult.firstNodeId, label: 'iterate' });
      }
      for (const lastId of bodyResult.lastNodeIds) {
        context.edges.push({ from: lastId, to: loopId, label: 'next' });
      }
      return { firstNodeId: nodeId, lastNodeIds: [loopId] };
    }

    case 'layer': {
      const result = renderNodes(node.operations, context, lines, depth + 1);
      if (result.firstNodeId) {
        context.edges.push({ from: nodeId, to: result.firstNodeId });
      }
      return {
        firstNodeId: nodeId,
        lastNodeIds: result.lastNodeIds.length > 0 ? result.lastNodeIds : [nodeId],
      };
    }

    case 'decision': {
      const decisionId = `decision_${++context.nodeCounter}`;
      const condLabel = node.label || truncate(node.condition, 25);
      lines.push(`  ${decisionId}{"${escapeLabel(condLabel)}"}`);
      context.styleClasses.set(decisionId, 'decisionStyle');
      context.nodeIdMap.set(node.id, decisionId);

      // Render true branch
      const trueResult = renderNodes(node.onTrue, context, lines, depth + 1);
      if (trueResult.firstNodeId) {
        context.edges.push({ from: decisionId, to: trueResult.firstNodeId, label: 'yes' });
      }
      const lastNodeIds: string[] = [...trueResult.lastNodeIds];

      // Render false branch
      if (node.onFalse && node.onFalse.length > 0) {
        const falseResult = renderNodes(node.onFalse, context, lines, depth + 1);
        if (falseResult.firstNodeId) {
          context.edges.push({ from: decisionId, to: falseResult.firstNodeId, label: 'no' });
        }
        lastNodeIds.push(...falseResult.lastNodeIds);
      } else {
        lastNodeIds.push(decisionId);  // no false branch → continues from decision
      }
      return { firstNodeId: decisionId, lastNodeIds };
    }

    case 'switch': {
      const switchId = `switch_${++context.nodeCounter}`;
      const switchLabel = `Switch: ${truncate(node.expression, 20)}`;
      lines.push(`  ${switchId}{"${escapeLabel(switchLabel)}"}`);
      context.styleClasses.set(switchId, 'switchStyle');

      const lastNodeIds: string[] = [];
      for (const caseItem of node.cases) {
        const caseLabel = caseItem.labels.join(' / ');
        const caseResult = renderNodes(caseItem.body, context, lines, depth + 1);
        if (caseResult.firstNodeId) {
          context.edges.push({ from: switchId, to: caseResult.firstNodeId, label: caseLabel });
        }
        lastNodeIds.push(...caseResult.lastNodeIds);
      }

      // If hasFallthrough, add warning annotation
      if (node.hasFallthrough) {
        const warnId = `switchWarn_${++context.nodeCounter}`;
        lines.push(`  ${warnId}{{"⚠ fallthrough"}}`);
        context.styleClasses.set(warnId, 'opaqueStyle');
        context.edges.push({ from: switchId, to: warnId, label: 'note' });
      }

      if (lastNodeIds.length === 0) lastNodeIds.push(switchId);
      return { firstNodeId: switchId, lastNodeIds };
    }

    case 'try-catch': {
      const tryResult = renderNodes(node.tryBody, context, lines, depth + 1);
      const allLastIds: string[] = [...tryResult.lastNodeIds];

      if (node.catchBody && node.catchBody.length > 0) {
        const catchId = `catch_${++context.nodeCounter}`;
        const catchLabel = node.catchVariable ? `Catch(${node.catchVariable})` : 'Catch';
        lines.push(`  ${catchId}["${escapeLabel(catchLabel)}"]`);
        context.styleClasses.set(catchId, 'tryCatchStyle');

        // Edge from try body to catch
        for (const lastId of tryResult.lastNodeIds) {
          context.edges.push({ from: lastId, to: catchId, label: 'on error' });
        }

        const catchResult = renderNodes(node.catchBody, context, lines, depth + 1);
        if (catchResult.firstNodeId) {
          context.edges.push({ from: catchId, to: catchResult.firstNodeId });
        }
        allLastIds.push(...catchResult.lastNodeIds);
      }

      if (node.finallyBody && node.finallyBody.length > 0) {
        const finallyResult = renderNodes(node.finallyBody, context, lines, depth + 1);
        if (finallyResult.firstNodeId) {
          for (const lastId of allLastIds) {
            context.edges.push({ from: lastId, to: finallyResult.firstNodeId, label: 'finally' });
          }
        }
        return {
          firstNodeId: tryResult.firstNodeId ?? nodeId,
          lastNodeIds: finallyResult.lastNodeIds,
        };
      }

      return {
        firstNodeId: tryResult.firstNodeId ?? nodeId,
        lastNodeIds: allLastIds.length > 0 ? allLastIds : [nodeId],
      };
    }

    case 'terminal': {
      const termId = `term_${++context.nodeCounter}`;
      const termLabel = node.terminalKind;
      lines.push(`  ${termId}(["${escapeLabel(termLabel)}"])`);
      context.styleClasses.set(termId, 'terminalStyle');

      // Render value (e.g., return yield* effect)
      if (node.value && node.value.length > 0) {
        const valueResult = renderNodes(node.value, context, lines, depth + 1);
        if (valueResult.firstNodeId) {
          context.edges.push({ from: nodeId, to: valueResult.firstNodeId });
        }
        // Value flows into terminal
        for (const lastId of valueResult.lastNodeIds) {
          context.edges.push({ from: lastId, to: termId });
        }
      }

      return { firstNodeId: node.value?.length ? nodeId : termId, lastNodeIds: [] };
    }

    case 'opaque': {
      const opaqueId = `opaque_${++context.nodeCounter}`;
      const opaqueLabel =
        node.reason === 'callback-body' || node.reason === 'predicate'
          ? node.sourceText
          : `⚠ ${node.reason}`;
      lines.push(`  ${opaqueId}{{"${escapeLabel(opaqueLabel)}"}}`);
      context.styleClasses.set(opaqueId, 'opaqueStyle');
      return { firstNodeId: opaqueId, lastNodeIds: [opaqueId] };
    }

    case 'cause': {
      // Hexagon shape for Cause nodes
      const causeId = `cause_${++context.nodeCounter}`;
      lines.push(`  ${causeId}{{"${escapeLabel(label)}"}}`);
      context.styleClasses.set(causeId, 'causeStyle');
      context.nodeIdMap.set(node.id, causeId);

      if (node.children && node.children.length > 0) {
        const childResult = renderNodes([...node.children], context, lines, depth + 1);
        if (childResult.firstNodeId) {
          context.edges.push({ from: causeId, to: childResult.firstNodeId });
        }
        return { firstNodeId: causeId, lastNodeIds: childResult.lastNodeIds.length > 0 ? childResult.lastNodeIds : [causeId] };
      }
      return { firstNodeId: causeId, lastNodeIds: [causeId] };
    }

    case 'exit': {
      // Stadium shape for Exit nodes
      const exitId = `exit_${++context.nodeCounter}`;
      lines.push(`  ${exitId}(["${escapeLabel(label)}"])`);
      context.styleClasses.set(exitId, 'exitStyle');
      context.nodeIdMap.set(node.id, exitId);
      return { firstNodeId: exitId, lastNodeIds: [exitId] };
    }

    case 'schedule': {
      // Parallelogram shape for Schedule nodes
      const schedId = `schedule_${++context.nodeCounter}`;
      lines.push(`  ${schedId}[/"${escapeLabel(label)}"/]`);
      context.styleClasses.set(schedId, 'scheduleStyle');
      context.nodeIdMap.set(node.id, schedId);
      return { firstNodeId: schedId, lastNodeIds: [schedId] };
    }

    case 'match': {
      // Diamond shape for Match nodes (similar to switch)
      const matchId = `match_${++context.nodeCounter}`;
      lines.push(`  ${matchId}{"${escapeLabel(label)}"}`);
      context.styleClasses.set(matchId, 'matchStyle');
      context.nodeIdMap.set(node.id, matchId);

      if (node.matchedTags && node.matchedTags.length > 0) {
        // Render a branch per matched tag (similar to switch cases)
        const lastNodeIds: string[] = [];
        for (const tag of node.matchedTags) {
          const tagNodeId = `match_tag_${++context.nodeCounter}`;
          lines.push(`  ${tagNodeId}["${escapeLabel(tag)}"]`);
          context.styleClasses.set(tagNodeId, 'matchStyle');
          context.edges.push({ from: matchId, to: tagNodeId, label: tag });
          lastNodeIds.push(tagNodeId);
        }
        if (lastNodeIds.length === 0) lastNodeIds.push(matchId);
        return { firstNodeId: matchId, lastNodeIds };
      }
      return { firstNodeId: matchId, lastNodeIds: [matchId] };
    }

    case 'transform': {
      // Rectangle for Transform nodes — recurse into source child
      if (node.source) {
        const sourceResult = renderNode(node.source, context, lines, depth + 1);
        if (sourceResult.lastNodeIds.length > 0) {
          context.edges.push({ from: sourceResult.lastNodeIds[0]!, to: nodeId });
        }
        return { firstNodeId: sourceResult.firstNodeId ?? nodeId, lastNodeIds: [nodeId] };
      }
      return { firstNodeId: nodeId, lastNodeIds: [nodeId] };
    }

    case 'channel': {
      // Subroutine shape for Channel nodes
      const chanId = `channel_${++context.nodeCounter}`;
      lines.push(`  ${chanId}[["${escapeLabel(label)}"]]`);
      context.styleClasses.set(chanId, 'channelStyle');
      context.nodeIdMap.set(node.id, chanId);

      if (node.source) {
        const sourceResult = renderNode(node.source, context, lines, depth + 1);
        if (sourceResult.lastNodeIds.length > 0) {
          context.edges.push({ from: sourceResult.lastNodeIds[0]!, to: chanId });
        }
        return { firstNodeId: sourceResult.firstNodeId ?? chanId, lastNodeIds: [chanId] };
      }
      return { firstNodeId: chanId, lastNodeIds: [chanId] };
    }

    case 'sink': {
      // Cylindrical shape for Sink nodes
      const sinkId = `sink_${++context.nodeCounter}`;
      lines.push(`  ${sinkId}[("${escapeLabel(label)}")]`);
      context.styleClasses.set(sinkId, 'sinkStyle');
      context.nodeIdMap.set(node.id, sinkId);

      if (node.source) {
        const sourceResult = renderNode(node.source, context, lines, depth + 1);
        if (sourceResult.lastNodeIds.length > 0) {
          context.edges.push({ from: sourceResult.lastNodeIds[0]!, to: sinkId });
        }
        return { firstNodeId: sourceResult.firstNodeId ?? sinkId, lastNodeIds: [sinkId] };
      }
      return { firstNodeId: sinkId, lastNodeIds: [sinkId] };
    }

    case 'interruption': {
      // Hexagon shape for Interruption nodes
      const intId = `interruption_${++context.nodeCounter}`;
      lines.push(`  ${intId}{{"${escapeLabel(label)}"}}`);
      context.styleClasses.set(intId, 'interruptionStyle');
      context.nodeIdMap.set(node.id, intId);

      if (node.source) {
        const sourceResult = renderNode(node.source, context, lines, depth + 1);
        if (sourceResult.firstNodeId) {
          context.edges.push({ from: intId, to: sourceResult.firstNodeId });
        }
        const lastIds = [...sourceResult.lastNodeIds];

        if (node.handler) {
          const handlerResult = renderNode(node.handler, context, lines, depth + 1);
          if (sourceResult.lastNodeIds.length > 0 && handlerResult.firstNodeId) {
            context.edges.push({ from: sourceResult.lastNodeIds[0]!, to: handlerResult.firstNodeId, label: 'on interrupt' });
          }
          lastIds.push(...handlerResult.lastNodeIds);
        }
        return { firstNodeId: intId, lastNodeIds: lastIds.length > 0 ? lastIds : [intId] };
      }
      return { firstNodeId: intId, lastNodeIds: [intId] };
    }

    default:
      return { firstNodeId: nodeId, lastNodeIds: [nodeId] };
  }
}

// =============================================================================
// Public API: static Mermaid (sync) and renderMermaid (Effect)
// =============================================================================

/**
 * Generate a Mermaid flowchart from static Effect IR (sync).
 * Includes Start/End nodes, optional subgraphs, sequential flow.
 */
export function renderStaticMermaid(
  ir: StaticEffectIR,
  options?: Partial<MermaidOptions>,
): string {
  const { lines } = renderStaticMermaidInternal(ir, options);
  return lines.join('\n');
}

/**
 * Render Effect IR as Mermaid flowchart (Effect).
 * Same as renderStaticMermaid but returns Effect.Effect<string>.
 */
export const renderMermaid = (
  ir: StaticEffectIR,
  options?: Partial<MermaidOptions>,
): Effect.Effect<string> =>
  Effect.sync(() => renderStaticMermaid(ir, options));

// =============================================================================
// Path-based Mermaid
// =============================================================================

export interface PathsMermaidOptions {
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  /** Collapse consecutive log-like steps into one summary node (default: true). */
  collapseRepeatedLogs?: boolean;
  /** Collapse consecutive pure-transform-like steps into one summary node (default: true). */
  collapsePureTransforms?: boolean;
  /** Collapse consecutive environment-acquisition-like steps (default: false, true in style-guide mode). */
  collapseEnvironmentRuns?: boolean;
  /** Apply summary-only readability heuristics (environment grouping + service boundary prefixes). */
  styleGuide?: boolean;
  /** Prefix the first service-like calls with "svc:" (default: false, true in style-guide mode). */
  prefixServiceBoundaries?: boolean;
}

export interface DisplayPathStep {
  key: string;
  name: string;
}

export interface PathSummaryResult {
  steps: readonly DisplayPathStep[];
  collapsedGroups: number;
}

function isLogLikeStep(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes('log') ||
    n.includes('loginfo') ||
    n.includes('logdebug') ||
    n.includes('logwarning') ||
    n.includes('logerror') ||
    n.includes('taperror')
  );
}

function isPureTransformLikeStep(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes('map') ||
    n.includes('flatmap') ||
    n.includes('filter') ||
    n.includes('transform') ||
    n.includes('tap(') ||
    n === 'tap' ||
    n.includes('annotate') ||
    n.includes('hsep') ||
    n.includes('ansidoc.text')
  );
}

function isEnvironmentLikeStep(name: string): boolean {
  const n = name.trim();
  if (/\(environment\)/i.test(n)) return true;
  if (/^[A-Z][A-Za-z0-9_]+$/.test(n)) return true;
  if (/^(Context\.Tag|GenericTag|Effect\.serviceOption|Effect\.service)\b/.test(n)) return true;
  return false;
}

function isServiceBoundaryLikeStep(name: string): boolean {
  const n = name.trim();
  if (!/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*/.test(n)) return false;
  const builtinPrefixes = [
    'Effect.',
    'Layer.',
    'Stream.',
    'Schema.',
    'Schedule.',
    'Option.',
    'Either.',
    'Duration.',
    'Console.',
    'Array.',
    'String.',
    'Number.',
    'Boolean.',
    'Math.',
    'Object.',
    'JSON.',
    'Promise.',
    'Date.',
  ];
  return !builtinPrefixes.some((prefix) => n.startsWith(prefix));
}

function applyServiceBoundaryPrefixes(
  steps: readonly DisplayPathStep[],
  options: PathsMermaidOptions,
): DisplayPathStep[] {
  const usePrefix = options.prefixServiceBoundaries ?? options.styleGuide ?? false;
  if (!usePrefix) return [...steps];
  const out = [...steps];
  let prefixed = 0;
  for (let i = 0; i < out.length; i++) {
    if (prefixed >= 2) break;
    const step = out[i];
    if (!step) continue;
    if (isServiceBoundaryLikeStep(step.name) && !step.name.startsWith('svc: ')) {
      out[i] = { ...step, name: `svc: ${step.name}` };
      prefixed++;
    }
  }
  return out;
}

export function summarizePathSteps(
  path: EffectPath,
  options: PathsMermaidOptions,
): PathSummaryResult {
  const collapseLogs = options.collapseRepeatedLogs ?? true;
  const collapseTransforms = options.collapsePureTransforms ?? true;
  const collapseEnvironment = options.collapseEnvironmentRuns ?? options.styleGuide ?? false;

  const out: DisplayPathStep[] = [];
  let collapsedGroups = 0;
  let i = 0;
  while (i < path.steps.length) {
    const current = path.steps[i];
    if (!current) break;
    const currentName = current.name ?? current.nodeId;

    if (collapseLogs && isLogLikeStep(currentName)) {
      let j = i + 1;
      while (j < path.steps.length) {
        const next = path.steps[j];
        if (!next) break;
        const nextName = next.name ?? next.nodeId;
        if (!isLogLikeStep(nextName)) break;
        j++;
      }
      const count = j - i;
      if (count > 1) {
        out.push({
          key: `${path.id}:logs:${i}`,
          name: `log steps ×${String(count)}`,
        });
        collapsedGroups++;
        i = j;
        continue;
      }
    }

    if (collapseTransforms && isPureTransformLikeStep(currentName)) {
      let j = i + 1;
      while (j < path.steps.length) {
        const next = path.steps[j];
        if (!next) break;
        const nextName = next.name ?? next.nodeId;
        if (!isPureTransformLikeStep(nextName)) break;
        j++;
      }
      const count = j - i;
      if (count > 1) {
        out.push({
          key: `${path.id}:transforms:${i}`,
          name: `transform steps ×${String(count)}`,
        });
        collapsedGroups++;
        i = j;
        continue;
      }
    }

    if (collapseEnvironment && isEnvironmentLikeStep(currentName)) {
      let j = i + 1;
      while (j < path.steps.length) {
        const next = path.steps[j];
        if (!next) break;
        const nextName = next.name ?? next.nodeId;
        if (!isEnvironmentLikeStep(nextName)) break;
        j++;
      }
      const count = j - i;
      if (count > 1) {
        out.push({
          key: `${path.id}:env:${i}`,
          name: `environment ×${String(count)}`,
        });
        collapsedGroups++;
        i = j;
        continue;
      }
    }

    out.push({ key: current.nodeId, name: currentName });
    i++;
  }

  return {
    steps: applyServiceBoundaryPrefixes(out, options),
    collapsedGroups,
  };
}

/**
 * Generate a simplified Mermaid diagram from execution paths.
 * Start -> step1 -> step2 -> ... -> End; nodes merged by nodeId.
 */
export function renderPathsMermaid(
  paths: readonly EffectPath[],
  options: PathsMermaidOptions = {},
): string {
  const direction = options.direction ?? 'TB';
  const lines: string[] = [];

  lines.push(`flowchart ${direction}`);
  lines.push('');

  const stepNodes = new Map<string, { id: string; name: string }>();
  let nodeCounter = 0;

  const displayPaths = paths.map((path) => summarizePathSteps(path, options).steps);

  for (const displayPath of displayPaths) {
    for (const step of displayPath) {
      const key = step.key;
      if (!stepNodes.has(key)) {
        stepNodes.set(key, {
          id: `step_${++nodeCounter}`,
          name: step.name,
        });
      }
    }
  }

  lines.push('  start((Start))');
  lines.push('  end_node((End))');
  lines.push('');

  for (const [, stepInfo] of stepNodes) {
    lines.push(`  ${stepInfo.id}["${escapeLabel(stepInfo.name)}"]`);
  }
  lines.push('');

  const edges = new Set<string>();
  for (const displayPath of displayPaths) {
    if (displayPath.length === 0) continue;
    const firstStep = displayPath[0]!;
    const firstInfo = stepNodes.get(firstStep.key)!;
    edges.add(`start --> ${firstInfo.id}`);
    for (let i = 0; i < displayPath.length - 1; i++) {
      const cur = displayPath[i]!;
      const next = displayPath[i + 1]!;
      const curInfo = stepNodes.get(cur.key)!;
      const nextInfo = stepNodes.get(next.key)!;
      edges.add(`${curInfo.id} --> ${nextInfo.id}`);
    }
    const lastStep = displayPath[displayPath.length - 1]!;
    const lastInfo = stepNodes.get(lastStep.key)!;
    edges.add(`${lastInfo.id} --> end_node`);
  }

  lines.push('  %% Edges');
  for (const edge of edges) {
    lines.push(`  ${edge}`);
  }

  return lines.join('\n');
}

// =============================================================================
// Enhanced Mermaid (types / errors overlay)
// =============================================================================

export interface EnhancedMermaidOptions extends Partial<MermaidOptions> {
  showTypeSignatures?: boolean;
  showRequiredServices?: boolean;
  showErrorNodes?: boolean;
}

const DEFAULT_ENHANCED_OPTIONS: EnhancedMermaidOptions = {
  ...DEFAULT_OPTIONS,
  showTypeSignatures: true,
  showRequiredServices: true,
  showErrorNodes: false,
};

/**
 * Collect type and service annotations from IR for overlay.
 */
function collectEnhancedAnnotations(
  ir: StaticEffectIR,
  opts: EnhancedMermaidOptions,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const showTypes = opts.showTypeSignatures !== false;
  const showServices = opts.showRequiredServices === true;

  function visit(node: StaticFlowNode): void {
    if (node.type === 'effect') {
      const annotations: string[] = [];
      if (showTypes && node.typeSignature) {
        annotations.push(
          `<${node.typeSignature.successType}, ${node.typeSignature.errorType}, ${node.typeSignature.requirementsType}>`,
        );
      }
      if (showServices && node.requiredServices && node.requiredServices.length > 0) {
        const services = node.requiredServices.map((s) => s.serviceId).join(', ');
        annotations.push(`R: ${services}`);
      }
      if (annotations.length > 0) {
        map.set(node.id, annotations);
      }
    }
    switch (node.type) {
      case 'generator':
        for (const y of node.yields) {
          visit(y.effect);
        }
        break;
      case 'pipe':
        visit(node.initial);
        for (const t of node.transformations) {
          visit(t);
        }
        break;
      case 'parallel':
      case 'race':
        for (const c of node.children) {
          visit(c);
        }
        break;
      case 'error-handler':
        visit(node.source);
        if (node.handler) visit(node.handler);
        break;
      case 'retry':
      case 'timeout':
        visit(node.source);
        break;
      case 'resource':
        visit(node.acquire);
        visit(node.release);
        if (node.use) visit(node.use);
        break;
      case 'conditional':
        visit(node.onTrue);
        if (node.onFalse) visit(node.onFalse);
        break;
      case 'loop':
        visit(node.body);
        break;
      case 'layer':
        for (const op of node.operations) {
          visit(op);
        }
        break;
      case 'decision':
        for (const child of node.onTrue) visit(child);
        if (node.onFalse) {
          for (const child of node.onFalse) visit(child);
        }
        break;
      case 'switch':
        for (const caseItem of node.cases) {
          for (const child of caseItem.body) visit(child);
        }
        break;
      case 'try-catch':
        for (const child of node.tryBody) visit(child);
        if (node.catchBody) {
          for (const child of node.catchBody) visit(child);
        }
        if (node.finallyBody) {
          for (const child of node.finallyBody) visit(child);
        }
        break;
      case 'terminal':
        if (node.value) {
          for (const child of node.value) visit(child);
        }
        break;
      case 'opaque':
        break;
      default:
        break;
    }
  }

  for (const child of ir.root.children) {
    visit(child);
  }
  return map;
}

/**
 * Generate enhanced Mermaid with type signatures and/or required services on nodes.
 */
export function renderEnhancedMermaid(
  ir: StaticEffectIR,
  options?: EnhancedMermaidOptions,
): string {
  const enhancedOpts = { ...DEFAULT_ENHANCED_OPTIONS, ...options };
  const nodeLabelAnnotations = collectEnhancedAnnotations(ir, enhancedOpts);
  // Pass original options' detail (if any) so auto-selection can kick in
  const mermaidOpts: Partial<MermaidOptions> = { ...enhancedOpts };
  if (!options?.detail) delete (mermaidOpts as Record<string, unknown>).detail;
  const { lines } = renderStaticMermaidInternal(
    ir,
    mermaidOpts,
    nodeLabelAnnotations,
  );
  return lines.join('\n');
}

/**
 * Render enhanced Mermaid as Effect.
 */
export const renderEnhancedMermaidEffect = (
  ir: StaticEffectIR,
  options?: EnhancedMermaidOptions,
): Effect.Effect<string> =>
  Effect.sync(() => renderEnhancedMermaid(ir, options));

// =============================================================================
// Enhanced diagram types (GAP 21)
// =============================================================================

function collectFiberNodes(
  nodes: readonly StaticFlowNode[],
  result: StaticFiberNode[],
): void {
  for (const node of nodes) {
    if (node.type === 'fiber') {
      result.push(node);
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) collectFiberNodes(children, result);
  }
}

/**
 * Generate a Mermaid sequence diagram for fiber fork/join (GAP 21).
 */
export function renderSequenceMermaid(ir: StaticEffectIR): string {
  const fibers: StaticFiberNode[] = [];
  collectFiberNodes(ir.root.children, fibers);
  const forks = fibers.filter(
    (f) => f.operation === 'fork' || f.operation === 'forkScoped' || f.operation === 'forkDaemon',
  );
  const joins = fibers.filter((f) => f.operation === 'join' || f.operation === 'await');
  if (forks.length === 0 && joins.length === 0) {
    return 'sequenceDiagram\n  participant Main\n  note over Main: No fiber operations detected';
  }
  const lines: string[] = ['sequenceDiagram', '  participant Main'];
  forks.forEach((_f, i) => {
    lines.push(`  participant Fiber${i + 1}`);
  });
  lines.push('');
  forks.forEach((f, i) => {
    const raw = f.fiberSource
      ? (f.fiberSource as StaticEffectNode).callee ?? 'effect'
      : 'effect';
    const label = truncateDisplayText(raw, DEFAULT_LABEL_MAX);
    lines.push(`  Main->>Fiber${i + 1}: fork(${label})`);
  });
  joins.forEach((_, i) => {
    const fid = Math.min(i + 1, forks.length);
    lines.push(`  Fiber${fid}-->>Main: join`);
  });
  return lines.join('\n');
}

function collectRetryNodes(
  nodes: readonly StaticFlowNode[],
  result: StaticRetryNode[],
): void {
  for (const node of nodes) {
    if (node.type === 'retry') {
      result.push(node);
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) collectRetryNodes(children, result);
  }
}

/**
 * Generate a Mermaid Gantt diagram for retry schedules (GAP 21).
 */
export function renderRetryGanttMermaid(ir: StaticEffectIR): string {
  const retries: StaticRetryNode[] = [];
  collectRetryNodes(ir.root.children, retries);
  const withSchedule = retries.filter((r) => r.scheduleInfo);
  if (withSchedule.length === 0) {
    return 'gantt\n  title Retry Schedule\n  section Retries\n  No retry schedules detected';
  }
  const lines: string[] = ['gantt', '  title Retry Schedule', '  section Attempts'];
  withSchedule.forEach((r, idx) => {
    const info = r.scheduleInfo!;
    const max =
      info.maxRetries === 'unlimited'
        ? 5
        : Math.min(
            typeof info.maxRetries === 'string'
              ? Number(info.maxRetries)
              : (info.maxRetries ?? 3),
            5,
          );
    for (let i = 0; i < max; i++) {
      lines.push(`  Attempt ${i + 1}: a${idx}_${i}, ${i === 0 ? '0' : `after a${idx}_${i - 1}`}, 100ms`);
      if (i < max - 1) {
        lines.push(`  Wait: w${idx}_${i}, after a${idx}_${i}, 200ms`);
      }
    }
  });
  return lines.join('\n');
}

// =============================================================================
// Service Graph Mermaid
// =============================================================================

/**
 * Render a project-level service dependency graph as a Mermaid flowchart.
 * Services are hexagon-shaped nodes, with edges showing layer requirements.
 */
export function renderServiceGraphMermaid(
  serviceMap: ProjectServiceMap,
  options: { direction?: 'TB' | 'LR' | 'BT' | 'RL' } = {},
): string {
  const direction = options.direction ?? 'TB';
  const sgLines: string[] = [];
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

  sgLines.push(`flowchart ${direction}`);
  sgLines.push('');
  sgLines.push('  %% Service Dependency Graph');
  sgLines.push('');

  // Service nodes (hexagon shape)
  for (const [serviceId, artifact] of serviceMap.services) {
    const id = sanitize(serviceId);
    const methodCount = artifact.definition.methods.length;
    const label = methodCount > 0
      ? `${serviceId}\\n(${methodCount} method${methodCount === 1 ? '' : 's'})`
      : serviceId;
    sgLines.push(`  ${id}{{{"${label}"}}}`);
  }

  // Unresolved services (dashed)
  for (const serviceId of serviceMap.unresolvedServices) {
    const id = `unresolved_${sanitize(serviceId)}`;
    sgLines.push(`  ${id}["? ${serviceId}"]`);
  }
  sgLines.push('');

  // Edges: service requires other services (via layers)
  const edgesAdded = new Set<string>();
  for (const [serviceId, artifact] of serviceMap.services) {
    for (const layer of artifact.layerImplementations) {
      for (const req of layer.requires) {
        const edgeKey = `${serviceId}->${req}`;
        if (edgesAdded.has(edgeKey)) continue;
        edgesAdded.add(edgeKey);

        const fromId = sanitize(serviceId);
        const toId = serviceMap.services.has(req)
          ? sanitize(req)
          : `unresolved_${sanitize(req)}`;
        sgLines.push(`  ${fromId} -->|"${layer.name}"| ${toId}`);
      }
    }
  }
  sgLines.push('');

  // Styling
  sgLines.push('  classDef service fill:#E3F2FD,stroke:#1565C0,stroke-width:2px');
  sgLines.push('  classDef unresolved fill:#FFF3CD,stroke:#856404,stroke-dasharray:5');
  for (const serviceId of serviceMap.services.keys()) {
    sgLines.push(`  class ${sanitize(serviceId)} service`);
  }
  for (const serviceId of serviceMap.unresolvedServices) {
    sgLines.push(`  class unresolved_${sanitize(serviceId)} unresolved`);
  }

  return sgLines.join('\n');
}
