/**
 * Path Generator
 *
 * Generates all possible execution paths through an Effect program based on
 * static analysis. Each path represents a unique sequence of steps that could
 * execute given certain conditions.
 */

import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticDecisionNode,
  StaticSwitchNode,
  StaticTryCatchNode,
  StaticTerminalNode,
  StaticCauseNode,
  StaticMatchNode,
  StaticTransformNode,
  StaticChannelNode,
  StaticSinkNode,
  StaticInterruptionNode,
  EffectPath,
  PathStepRef,
  PathCondition,
} from './types';

// =============================================================================
// Options
// =============================================================================

export interface PathGeneratorOptions {
  /** Maximum paths to generate (default: 1000) */
  maxPaths?: number;
  /** Whether to include loop iterations as separate paths (default: false) */
  expandLoops?: boolean;
  /** Maximum loop iterations to expand if expandLoops is true (default: 3) */
  maxLoopIterations?: number;
}

const DEFAULT_OPTIONS: Required<PathGeneratorOptions> = {
  maxPaths: 1000,
  expandLoops: false,
  maxLoopIterations: 3,
};

// =============================================================================
// Path Generation
// =============================================================================

export interface PathGenerationResult {
  /** Generated effect paths */
  paths: EffectPath[];
  /** Whether the maxPaths limit was hit (truncation occurred) */
  limitHit: boolean;
}

/**
 * Generate all possible execution paths through an Effect program.
 */
export function generatePaths(
  ir: StaticEffectIR,
  options: PathGeneratorOptions = {},
): EffectPath[] {
  return generatePathsWithMetadata(ir, options).paths;
}

/**
 * Generate all possible execution paths with metadata.
 */
export function generatePathsWithMetadata(
  ir: StaticEffectIR,
  options: PathGeneratorOptions = {},
): PathGenerationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const context: PathContext = {
    opts,
    pathCount: 0,
    hasHitLimit: false,
    controlStack: [],
  };

  const initialState: PathState = {
    steps: [],
    conditions: [],
    hasLoops: false,
    hasUnresolvedRefs: false,
  };

  const states = generatePathsForNodes(ir.root.children, initialState, context);

  const paths: EffectPath[] = states.map((state, index) => ({
    id: `path-${index + 1}`,
    description: generatePathDescription(state),
    steps: state.steps,
    conditions: state.conditions,
    hasLoops: state.hasLoops,
    hasUnresolvedRefs: state.hasUnresolvedRefs,
  }));

  return {
    paths,
    limitHit: context.hasHitLimit,
  };
}

// =============================================================================
// Internal Types
// =============================================================================

interface ControlTarget {
  readonly kind: 'loop' | 'switch' | 'block';
  readonly label?: string;
  readonly breakContinuationNodeId: string;
  readonly continueContinuationNodeId?: string; // only for loops
}

interface PathContext {
  opts: Required<PathGeneratorOptions>;
  pathCount: number;
  hasHitLimit: boolean;
  controlStack: ControlTarget[];
}

interface PathState {
  steps: PathStepRef[];
  conditions: PathCondition[];
  hasLoops: boolean;
  hasUnresolvedRefs: boolean;
}

// =============================================================================
// Path Generation Logic
// =============================================================================

function generatePathsForNodes(
  nodes: readonly StaticFlowNode[],
  currentState: PathState,
  context: PathContext,
): PathState[] {
  if (nodes.length === 0) {
    return [currentState];
  }

  let states: PathState[] = [currentState];

  for (const node of nodes) {
    const newStates: PathState[] = [];
    for (const state of states) {
      newStates.push(...generatePathsForNode(node, state, context));
    }
    states = newStates;
    if (node.type === 'terminal') {
      const term = node;
      if (term.terminalKind === 'return' || term.terminalKind === 'throw') {
        return states;
      }
    }
  }

  return states;
}

function generatePathsForNode(
  node: StaticFlowNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  switch (node.type) {
    case 'effect':
      return handleEffectNode(node, currentState);
    case 'generator':
      return handleGeneratorNode(node, currentState, context);
    case 'pipe':
      return handlePipeNode(node, currentState, context);
    case 'parallel':
      return handleParallelNode(node, currentState, context);
    case 'race':
      return handleRaceNode(node, currentState, context);
    case 'error-handler':
      return handleErrorHandlerNode(node, currentState, context);
    case 'retry':
    case 'timeout':
      return handleSingleChildNode(node, currentState, context);
    case 'resource':
      return handleResourceNode(node, currentState, context);
    case 'conditional':
      return handleConditionalNode(node, currentState, context);
    case 'loop':
      return handleLoopNode(node, currentState, context);
    case 'layer':
      return handleLayerNode(node, currentState, context);
    case 'stream':
      return handleStreamNode(node, currentState, context);
    case 'concurrency-primitive':
    case 'fiber':
      return handleConcurrencyOrFiberNode(node, currentState, context);
    case 'decision':
      return handleDecisionNode(node, currentState, context);
    case 'switch':
      return handleSwitchNode(node, currentState, context);
    case 'try-catch':
      return handleTryCatchNode(node, currentState, context);
    case 'terminal':
      return handleTerminalNode(node, currentState, context);
    case 'cause':
      return handleCauseNode(node, currentState, context);
    case 'exit':
    case 'schedule':
      return handleLeafStepNode(node, currentState);
    case 'match':
      return handleMatchNode(node, currentState, context);
    case 'transform':
      return handleTransformNode(node, currentState, context);
    case 'channel':
      return handleChannelNode(node, currentState, context);
    case 'sink':
      return handleSinkNode(node, currentState, context);
    case 'interruption':
      return handleInterruptionNode(node, currentState, context);
    case 'opaque':
      return [currentState]; // treat as no-op, path continues
    case 'unknown':
      return [currentState];
    default:
      return [currentState];
  }
}

function handleEffectNode(
  node: StaticFlowNode & { type: 'effect' },
  currentState: PathState,
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.name ?? node.callee,
    repeated: false,
  };
  return [
    {
      ...currentState,
      steps: [...currentState.steps, stepRef],
    },
  ];
}

function handleGeneratorNode(
  node: StaticFlowNode & { type: 'generator' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const children = node.yields.map((y) => y.effect);
  return generatePathsForNodes(children, currentState, context);
}

function handlePipeNode(
  node: StaticFlowNode & { type: 'pipe' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const children = [node.initial, ...node.transformations];
  return generatePathsForNodes(children, currentState, context);
}

function handleParallelNode(
  node: StaticFlowNode & { type: 'parallel' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  let combinedStates: PathState[] = [currentState];

  for (const child of node.children) {
    const newCombinedStates: PathState[] = [];
    for (const state of combinedStates) {
      const childStates = generatePathsForNode(child, state, context);
      for (const childState of childStates) {
        newCombinedStates.push({
          steps: childState.steps,
          conditions: childState.conditions,
          hasLoops: state.hasLoops || childState.hasLoops,
          hasUnresolvedRefs:
            state.hasUnresolvedRefs || childState.hasUnresolvedRefs,
        });
      }
    }
    combinedStates = newCombinedStates;
  }

  return combinedStates;
}

function handleRaceNode(
  node: StaticFlowNode & { type: 'race' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  if (node.children.length === 0) {
    return [currentState];
  }

  const atLimit =
    context.hasHitLimit ||
    context.pathCount + node.children.length >= context.opts.maxPaths;
  if (atLimit) {
    context.hasHitLimit = true;
    const first = node.children[0];
    if (first) {
      return generatePathsForNode(first, currentState, context);
    }
    return [currentState];
  }

  const allStates: PathState[] = [];
  const maxAllowed = context.opts.maxPaths;

  for (const child of node.children) {
    if (allStates.length >= maxAllowed) {
      context.hasHitLimit = true;
      break;
    }
    const childStates = generatePathsForNode(child, currentState, context);
    const roomLeft = maxAllowed - allStates.length;
    const toAdd = childStates.slice(0, roomLeft);
    allStates.push(...toAdd);
    if (toAdd.length < childStates.length) {
      context.hasHitLimit = true;
    }
  }

  context.pathCount += Math.max(0, allStates.length - 1);
  return allStates.length > 0 ? allStates : [currentState];
}

function handleErrorHandlerNode(
  node: StaticFlowNode & { type: 'error-handler' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const sourceStates = generatePathsForNode(node.source, currentState, context);
  if (!node.handler) {
    return sourceStates;
  }
  const handlerStates = generatePathsForNode(
    node.handler,
    currentState,
    context,
  );
  return [...sourceStates, ...handlerStates];
}

function handleSingleChildNode(
  node: StaticFlowNode & { type: 'retry' | 'timeout' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  return generatePathsForNode(node.source, currentState, context);
}

function handleResourceNode(
  node: StaticFlowNode & { type: 'resource' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const resourceNodes: StaticFlowNode[] = [node.acquire, node.release];
  if (node.use) {
    resourceNodes.push(node.use);
  }
  return generatePathsForNodes(resourceNodes, currentState, context);
}

function handleConditionalNode(
  node: StaticFlowNode & { type: 'conditional' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const trueCondition: PathCondition = {
    expression: node.condition,
    mustBe: node.conditionalType === 'unless' ? false : true,
    location: node.location,
  };

  const trueState: PathState = {
    ...currentState,
    conditions: [...currentState.conditions, trueCondition],
  };

  const trueStates = generatePathsForNode(node.onTrue, trueState, context);

  const falseCondition: PathCondition = {
    expression: node.condition,
    mustBe: node.conditionalType === 'unless' ? true : false,
    location: node.location,
  };

  const falseState: PathState = {
    ...currentState,
    conditions: [...currentState.conditions, falseCondition],
  };

  if (node.onFalse) {
    const falseStates = generatePathsForNode(node.onFalse, falseState, context);
    return [...trueStates, ...falseStates];
  }

  return [...trueStates, falseState];
}

function handleLoopNode(
  node: StaticFlowNode & { type: 'loop' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const bodyStates = generatePathsForNode(node.body, currentState, context);
  return bodyStates.map((state) => ({
    ...state,
    steps: state.steps.map((step, idx) =>
      idx >= currentState.steps.length ? { ...step, repeated: true } : step,
    ),
    hasLoops: true,
  }));
}

function handleLayerNode(
  node: StaticFlowNode & { type: 'layer' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  return generatePathsForNodes(node.operations, currentState, context);
}

function handleStreamNode(
  node: StaticFlowNode & { type: 'stream' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.pipeline.length > 0 ? `Stream.${node.pipeline.map((p) => p.operation).join(' → ')}` : 'Stream',
    repeated: false,
  };
  const stateWithStep = {
    ...currentState,
    steps: [...currentState.steps, stepRef],
  };
  return generatePathsForNode(node.source, stateWithStep, context);
}

function handleConcurrencyOrFiberNode(
  node: StaticFlowNode & { type: 'concurrency-primitive' | 'fiber' },
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name:
      node.type === 'concurrency-primitive'
        ? `${node.primitive}.${node.operation}`
        : node.operation,
    repeated: false,
  };
  const stateWithStep = {
    ...currentState,
    steps: [...currentState.steps, stepRef],
  };
  const child =
    node.type === 'concurrency-primitive' ? node.source : node.fiberSource;
  if (child) {
    return generatePathsForNode(child, stateWithStep, context);
  }
  return [stateWithStep];
}

function handleDecisionNode(
  node: StaticDecisionNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const trueCondition: PathCondition = {
    expression: node.condition,
    mustBe: true,
    location: node.location,
  };
  const trueState: PathState = {
    ...currentState,
    conditions: [...currentState.conditions, trueCondition],
  };
  const trueStates = generatePathsForNodes(node.onTrue, trueState, context);

  if (node.onFalse && node.onFalse.length > 0) {
    const falseCondition: PathCondition = {
      expression: node.condition,
      mustBe: false,
      location: node.location,
    };
    const falseState: PathState = {
      ...currentState,
      conditions: [...currentState.conditions, falseCondition],
    };
    const falseStates = generatePathsForNodes(node.onFalse, falseState, context);
    return [...trueStates, ...falseStates];
  }

  const falseCondition: PathCondition = {
    expression: node.condition,
    mustBe: false,
    location: node.location,
  };
  const falseState: PathState = {
    ...currentState,
    conditions: [...currentState.conditions, falseCondition],
  };
  return [...trueStates, falseState];
}

function handleSwitchNode(
  node: StaticSwitchNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const allStates: PathState[] = [];

  for (const caseItem of node.cases) {
    const caseLabel = caseItem.labels.join(' / ');
    const caseCondition: PathCondition = {
      expression: `${node.expression} === ${caseLabel}`,
      mustBe: true,
      location: node.location,
    };
    const caseState: PathState = {
      ...currentState,
      conditions: [...currentState.conditions, caseCondition],
    };
    const caseStates = generatePathsForNodes(caseItem.body, caseState, context);
    allStates.push(...caseStates);
  }

  return allStates.length > 0 ? allStates : [currentState];
}

function handleTryCatchNode(
  node: StaticTryCatchNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  // Try path (success)
  const tryStates = generatePathsForNodes(node.tryBody, currentState, context);

  // Catch path
  const catchStates: PathState[] = [];
  if (node.catchBody && node.catchBody.length > 0) {
    const catchCondition: PathCondition = {
      expression: 'throws',
      mustBe: true,
      location: node.location,
    };
    const catchState: PathState = {
      ...currentState,
      conditions: [...currentState.conditions, catchCondition],
    };
    catchStates.push(...generatePathsForNodes(node.catchBody, catchState, context));
  }

  const combined = [...tryStates, ...catchStates];

  // Finally path: if present, append to all paths
  if (node.finallyBody && node.finallyBody.length > 0) {
    const finalStates: PathState[] = [];
    for (const state of combined) {
      finalStates.push(...generatePathsForNodes(node.finallyBody, state, context));
    }
    return finalStates;
  }

  return combined;
}

function handleTerminalNode(
  node: StaticTerminalNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  // If the terminal has value nodes (e.g., return yield* effect), process them first
  let state = currentState;
  if (node.value && node.value.length > 0) {
    const valueStates = generatePathsForNodes(node.value, currentState, context);
    // Take the first resulting state (value expressions produce sequential steps)
    state = valueStates[0] ?? currentState;
  }

  switch (node.terminalKind) {
    case 'return':
    case 'throw':
      // Path terminates — add a step marking the termination
      return [{
        ...state,
        steps: [...state.steps, {
          nodeId: node.id,
          name: node.terminalKind,
          repeated: false,
        }],
      }];

    case 'break':
    case 'continue':
      // These are structurally captured — just continue the path
      return [state];
  }
}

// =============================================================================
// New node type handlers (cause, exit, schedule, match, transform, channel, sink, interruption)
// =============================================================================

function handleLeafStepNode(
  node: StaticFlowNode,
  currentState: PathState,
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.name ?? node.type,
    repeated: false,
  };
  return [{
    ...currentState,
    steps: [...currentState.steps, stepRef],
  }];
}

function handleCauseNode(
  node: StaticCauseNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.name ?? `Cause.${node.causeOp}`,
    repeated: false,
  };
  const stateWithStep: PathState = {
    ...currentState,
    steps: [...currentState.steps, stepRef],
  };

  if (node.children && node.children.length > 0) {
    return generatePathsForNodes([...node.children], stateWithStep, context);
  }
  return [stateWithStep];
}

function handleMatchNode(
  node: StaticMatchNode,
  currentState: PathState,
  _context: PathContext,
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.name ?? `Match.${node.matchOp}`,
    repeated: false,
  };
  return [{
    ...currentState,
    steps: [...currentState.steps, stepRef],
  }];
}

function handleTransformNode(
  node: StaticTransformNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  let state = currentState;
  if (node.source) {
    const sourceStates = generatePathsForNode(node.source, currentState, context);
    state = sourceStates[0] ?? currentState;
  }
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.name ?? node.transformType,
    repeated: false,
  };
  return [{
    ...state,
    steps: [...state.steps, stepRef],
  }];
}

function handleChannelNode(
  node: StaticChannelNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  let state = currentState;
  if (node.source) {
    const sourceStates = generatePathsForNode(node.source, currentState, context);
    state = sourceStates[0] ?? currentState;
  }
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.name ?? `Channel${node.pipeline.length > 0 ? `.${node.pipeline.map(p => p.operation).join('.')}` : ''}`,
    repeated: false,
  };
  return [{
    ...state,
    steps: [...state.steps, stepRef],
  }];
}

function handleSinkNode(
  node: StaticSinkNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  let state = currentState;
  if (node.source) {
    const sourceStates = generatePathsForNode(node.source, currentState, context);
    state = sourceStates[0] ?? currentState;
  }
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.name ?? `Sink${node.pipeline.length > 0 ? `.${node.pipeline.map(p => p.operation).join('.')}` : ''}`,
    repeated: false,
  };
  return [{
    ...state,
    steps: [...state.steps, stepRef],
  }];
}

function handleInterruptionNode(
  node: StaticInterruptionNode,
  currentState: PathState,
  context: PathContext,
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.name ?? node.interruptionType,
    repeated: false,
  };
  const stateWithStep: PathState = {
    ...currentState,
    steps: [...currentState.steps, stepRef],
  };

  if (node.source) {
    const sourceStates = generatePathsForNode(node.source, stateWithStep, context);
    if (node.handler) {
      // Fork: source path + handler path (on interrupt)
      const handlerStates = generatePathsForNode(node.handler, stateWithStep, context);
      return [...sourceStates, ...handlerStates];
    }
    return sourceStates;
  }
  return [stateWithStep];
}

// =============================================================================
// Path Description
// =============================================================================

function generatePathDescription(state: PathState): string {
  const parts: string[] = [];

  if (state.conditions.length > 0) {
    const conditionParts = state.conditions.map((c) => {
      const verb = c.mustBe ? 'is true' : 'is false';
      const expr =
        c.expression.length > 30
          ? c.expression.slice(0, 30) + '...'
          : c.expression;
      return `${expr} ${verb}`;
    });
    parts.push(`When ${conditionParts.join(' AND ')}`);
  }

  const stepNames = state.steps
    .map((s) => {
      const name = s.name ?? s.nodeId;
      return s.repeated ? `${name} (repeated)` : name;
    })
    .join(' → ');

  if (stepNames) {
    parts.push(`Steps: ${stepNames}`);
  }

  if (state.hasLoops) {
    parts.push('[contains loops]');
  }
  if (state.hasUnresolvedRefs) {
    parts.push('[has unresolved refs]');
  }

  return parts.join('. ') || 'Empty path';
}

// =============================================================================
// Path Statistics
// =============================================================================

export interface PathStatistics {
  totalPaths: number;
  pathLimitHit: boolean;
  pathsWithLoops: number;
  pathsWithUnresolvedRefs: number;
  uniqueConditions: string[];
  maxPathLength: number;
  minPathLength: number;
  avgPathLength: number;
}

export interface PathStatisticsOptions {
  limitHit?: boolean;
}

export function calculatePathStatistics(
  paths: EffectPath[],
  options?: PathStatisticsOptions,
): PathStatistics {
  if (paths.length === 0) {
    return {
      totalPaths: 0,
      pathLimitHit: false,
      pathsWithLoops: 0,
      pathsWithUnresolvedRefs: 0,
      uniqueConditions: [],
      maxPathLength: 0,
      minPathLength: 0,
      avgPathLength: 0,
    };
  }

  const conditions = new Set<string>();
  let pathsWithLoops = 0;
  let pathsWithUnresolvedRefs = 0;
  let totalLength = 0;
  let maxLength = 0;
  let minLength = Infinity;

  for (const path of paths) {
    if (path.hasLoops) pathsWithLoops++;
    if (path.hasUnresolvedRefs) pathsWithUnresolvedRefs++;
    const length = path.steps.length;
    totalLength += length;
    maxLength = Math.max(maxLength, length);
    minLength = Math.min(minLength, length);
    for (const c of path.conditions) {
      conditions.add(c.expression);
    }
  }

  return {
    totalPaths: paths.length,
    pathLimitHit: options?.limitHit ?? false,
    pathsWithLoops,
    pathsWithUnresolvedRefs,
    uniqueConditions: Array.from(conditions),
    maxPathLength: maxLength,
    minPathLength: minLength === Infinity ? 0 : minLength,
    avgPathLength: totalLength / paths.length,
  };
}

// =============================================================================
// Path Filtering
// =============================================================================

export function filterPaths(
  paths: EffectPath[],
  filter: {
    mustIncludeStep?: string;
    mustExcludeStep?: string;
    conditionTrue?: string;
    conditionFalse?: string;
    noLoops?: boolean;
    maxLength?: number;
  },
): EffectPath[] {
  return paths.filter((path) => {
    if (filter.mustIncludeStep) {
      const has = path.steps.some(
        (s) => s.name === filter.mustIncludeStep || s.nodeId === filter.mustIncludeStep,
      );
      if (!has) return false;
    }
    if (filter.mustExcludeStep) {
      const has = path.steps.some(
        (s) =>
          s.name === filter.mustExcludeStep ||
          s.nodeId === filter.mustExcludeStep,
      );
      if (has) return false;
    }
    if (filter.conditionTrue) {
      const has = path.conditions.some(
        (c) => c.expression === filter.conditionTrue && c.mustBe,
      );
      if (!has) return false;
    }
    if (filter.conditionFalse) {
      const has = path.conditions.some(
        (c) => c.expression === filter.conditionFalse && !c.mustBe,
      );
      if (!has) return false;
    }
    if (filter.noLoops && path.hasLoops) return false;
    if (filter.maxLength !== undefined && path.steps.length > filter.maxLength)
      return false;
    return true;
  });
}
