import { Option } from 'effect';
import { DEFAULT_LABEL_MAX, truncateDisplayText } from '../analysis-utils';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode } from '../types';
import { splitTopLevelUnion } from '../type-extractor';

interface RailwayStep {
  readonly label: string;
  readonly errorTypes: readonly string[];
}

interface RailwayOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

/** Generate a short node ID: A–Z, then A1–Z1, A2–Z2, etc. */
function stepId(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  const cycle = Math.floor(index / 26);
  return cycle === 0 ? letter : `${letter}${cycle}`;
}

/** Escape characters that break Mermaid label syntax. */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\(/g, '#lpar;')
    .replace(/\)/g, '#rpar;');
}

/** Strip trailing "Error" or "Exception" suffix from a type name. */
function stripErrorSuffix(name: string): string {
  return name.replace(/(Error|Exception)$/, '');
}

/** Extract error types string from a node, split into individual type names. */
function extractErrorTypes(node: StaticFlowNode): readonly string[] {
  let raw: string | undefined;

  if (node.type === 'effect') {
    raw = node.typeSignature?.errorType ?? node.errorType;
  } else if ('typeSignature' in node && node.typeSignature) {
    raw = (node.typeSignature as { errorType?: string }).errorType;
  }

  if (!raw || raw === 'never' || raw.trim() === '') return [];

  return splitTopLevelUnion(raw)
    .filter(s => s !== 'never');
}

/** Recursively collect error types from a node and its descendants. */
function collectErrorTypes(node: StaticFlowNode): readonly string[] {
  const seen = new Set<string>();
  const errors: string[] = [];

  const visit = (current: StaticFlowNode): void => {
    for (const errorType of extractErrorTypes(current)) {
      if (!seen.has(errorType)) {
        seen.add(errorType);
        errors.push(errorType);
      }
    }

    const children = Option.getOrElse(getStaticChildren(current), () => []);
    for (const child of children) {
      visit(child);
    }
  };

  visit(node);
  return errors;
}

/** Compute a display label for a flow node. */
function computeLabel(node: StaticFlowNode): string {
  const raw = ((): string => {
    if (node.displayName) return node.displayName;
    if (node.type === 'effect') {
      if (node.name) {
        const stripped = node.name.replace(/^Effect\./, '');
        return stripped.charAt(0).toUpperCase() + stripped.slice(1);
      }
      return node.callee.replace(/^Effect\./, '');
    }
    if (node.name) return node.name;
    if (node.type === 'parallel') return 'Effect.all';
    if (node.type === 'race') return 'Effect.race';
    if (node.type === 'error-handler') return 'Error Handler';
    if (node.type === 'retry') return 'Retry';
    if (node.type === 'conditional') return 'Conditional';
    return node.type;
  })();
  return truncateDisplayText(raw, DEFAULT_LABEL_MAX);
}

/** Transparent: recurse into children, don't show this node itself. */
function isTransparentRailwayNode(node: StaticFlowNode): boolean {
  switch (node.type) {
    case 'generator':
    case 'pipe':
      return true;
    default:
      return false;
  }
}

/** Show as a single labeled step — don't recurse into children. */
function isOpaqueRailwayStep(node: StaticFlowNode): boolean {
  switch (node.type) {
    case 'loop':
    case 'conditional':
    case 'decision':
    case 'switch':
    case 'parallel':
    case 'race':
    case 'retry':
    case 'timeout':
    case 'resource':
      return true;
    default:
      return false;
  }
}

/** Skip entirely — don't show, don't recurse. Shown in other views. */
function isSkippedRailwayNode(node: StaticFlowNode): boolean {
  switch (node.type) {
    case 'error-handler':
    case 'transform':
    case 'stream':
    case 'channel':
    case 'sink':
    case 'concurrency-primitive':
    case 'fiber':
    case 'interruption':
    case 'try-catch':
    case 'terminal':
      return true;
    default:
      return false;
  }
}

/**
 * Check if an effect node is a definition/constructor that shouldn't appear
 * as a step in the railway view. These are service method definitions,
 * constructors, and other non-workflow nodes.
 */
function isSkippableEffectNode(node: StaticFlowNode): boolean {
  if (node.type !== 'effect') return false;
  const callee = (node as { callee?: string }).callee ?? '';

  // Effect.fn / Effect.fn("name") — service method definitions
  if (callee === 'Effect.fn' || callee.startsWith('Effect.fn(')) return true;

  // Pure constructors without a meaningful display name (anonymous yields in service setup)
  // A node is "anonymous" if it has no meaningful display name —
  // displayName is either absent, equals the raw callee, or is a generic type name
  const displayName = node.displayName ?? '';
  const hasExplicitName = displayName && displayName !== callee && displayName !== node.type;
  const isAnonymous = !hasExplicitName;
  // Anonymous effect nodes (no variable binding) are infrastructure/plumbing — skip
  if (isAnonymous) return true;

  // Schema/Data definitions are type declarations, not workflow steps
  if (callee.startsWith('Schema.') || callee.startsWith('Data.')) return true;

  return false;
}

/** Flatten IR children to a linear list of concrete steps for the railway diagram. */
function flattenNodesToSteps(nodes: readonly StaticFlowNode[]): readonly StaticFlowNode[] {
  const steps: StaticFlowNode[] = [];

  const visit = (node: StaticFlowNode): void => {
    // Transparent: recurse into children (generator, pipe wrappers)
    if (isTransparentRailwayNode(node)) {
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      for (const child of children) {
        visit(child);
      }
      return;
    }

    // Skip entirely: error handlers, transforms, streams, etc.
    if (isSkippedRailwayNode(node)) return;

    // Opaque: show as single box, don't recurse (loops, conditionals, parallel, etc.)
    if (isOpaqueRailwayStep(node)) {
      steps.push(node);
      return;
    }

    // Effect nodes: skip method definitions and anonymous constructors
    if (isSkippableEffectNode(node)) return;

    steps.push(node);
  };

  for (const node of nodes) {
    visit(node);
  }

  return steps;
}

/** Build railway step descriptors from flow nodes. */
function buildSteps(nodes: readonly StaticFlowNode[]): readonly RailwayStep[] {
  return nodes.map(node => ({
    label: computeLabel(node),
    errorTypes: collectErrorTypes(node),
  }));
}

/**
 * Render a railway-oriented Mermaid flowchart from an Effect IR.
 *
 * Happy path flows left-to-right with `-->|ok|` edges.
 * Steps with typed errors get `-->|err|` branches to error nodes.
 */
export function renderRailwayMermaid(
  ir: StaticEffectIR,
  options: RailwayOptions = {},
): string {
  const direction = options.direction ?? 'LR';
  const nodes = flattenNodesToSteps(ir.root.children);
  const steps = buildSteps(nodes);

  if (steps.length === 0) {
    return `flowchart ${direction}\n  Empty((No steps))`;
  }

  const lines: string[] = [`flowchart ${direction}`];
  const errorLines: string[] = [];

  const hasPerStepErrors = steps.some(s => s.errorTypes.length > 0);

  for (let i = 0; i < steps.length; i++) {
    const currentStep = steps[i];
    if (!currentStep) continue;
    const id = stepId(i);
    const label = escapeLabel(currentStep.label);

    if (i < steps.length - 1) {
      const nextStep = steps[i + 1];
      if (!nextStep) continue;
      const nextId = stepId(i + 1);
      const nextLabel = escapeLabel(nextStep.label);
      if (i === 0) {
        lines.push(`  ${id}[${label}] -->|ok| ${nextId}[${nextLabel}]`);
      } else {
        lines.push(`  ${id} -->|ok| ${nextId}[${nextLabel}]`);
      }
    } else {
      if (i === 0) {
        lines.push(`  ${id}[${label}] -->|ok| Done((Success))`);
      } else {
        lines.push(`  ${id} -->|ok| Done((Success))`);
      }
    }
  }

  if (hasPerStepErrors) {
    for (let i = 0; i < steps.length; i++) {
      const currentStep = steps[i];
      if (!currentStep) continue;
      const { errorTypes } = currentStep;
      if (errorTypes.length === 0) continue;

      const id = stepId(i);
      const errId = `${id}E`;
      const errLabel = escapeLabel(
        errorTypes.map(stripErrorSuffix).join(' / ')
      );
      errorLines.push(`  ${id} -->|err| ${errId}[${errLabel}]`);
    }
  } else if (ir.root.errorTypes.length > 0) {
    const lastId = stepId(steps.length - 1);
    const errLabel = escapeLabel(
      ir.root.errorTypes.map(stripErrorSuffix).join(' / ')
    );
    errorLines.push(`  ${lastId} -->|err| Errors[${errLabel}]`);
  }

  return [...lines, ...errorLines].join('\n');
}
