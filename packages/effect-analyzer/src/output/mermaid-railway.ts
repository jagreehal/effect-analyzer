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

/**
 * Compute a display label for a flow node. `binding` is the generator variable
 * the step's result was yielded into — it lives on the yield, not on the node,
 * so it has to be threaded in.
 */
function computeLabel(node: StaticFlowNode, binding?: string): string {
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
  const labelled = binding === undefined ? raw : `${binding} <- ${raw}`;
  return truncateDisplayText(labelled, DEFAULT_LABEL_MAX);
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
 * A declaration rather than a step: a service method definition or a type
 * declaration. Never appears in the railway however it was reached.
 */
function isDefinitionNode(node: StaticFlowNode): boolean {
  if (node.type !== 'effect') return false;
  const callee = (node as { callee?: string }).callee ?? '';
  return (
    callee === 'Effect.fn' ||
    callee.startsWith('Effect.fn(') ||
    callee.startsWith('Schema.') ||
    callee.startsWith('Data.')
  );
}

/**
 * An effect node the source never named — no display name and no variable. On
 * its own that is setup plumbing, not a step the reader cares about.
 */
function isAnonymousEffect(node: StaticFlowNode): boolean {
  if (node.type !== 'effect') return false;
  const name = node.displayName ?? node.name ?? '';
  return !name || name === node.type;
}

/**
 * How the walk reached a node. A generator `yield*` is the program awaiting a
 * step, so it counts whether or not its result was bound to a name; anything
 * else is only a step if the source named it.
 */
type Arrival =
  | { readonly kind: 'yielded'; readonly binding: string | undefined }
  | { readonly kind: 'nested' };

const NESTED: Arrival = { kind: 'nested' };

const bindingOf = (arrival: Arrival): string | undefined =>
  arrival.kind === 'yielded' ? arrival.binding : undefined;

/** A concrete railway step and the generator binding that named it, if any. */
interface FlatStep {
  readonly node: StaticFlowNode;
  readonly binding?: string;
}

/** Flatten IR children to a linear list of concrete steps for the railway diagram. */
function flattenNodesToSteps(nodes: readonly StaticFlowNode[]): readonly FlatStep[] {
  const steps: FlatStep[] = [];

  const visit = (node: StaticFlowNode, arrival: Arrival): void => {
    // A generator's bindings live on its yields, so recurse over those directly
    // rather than through `getStaticChildren`, which drops the variable name.
    if (node.type === 'generator') {
      for (const yielded of node.yields) {
        visit(yielded.effect, { kind: 'yielded', binding: yielded.variableName });
      }
      return;
    }

    // Transparent: recurse into children (pipe wrappers). The arrival belongs to
    // the pipe's subject — its first child — not to its transformations.
    if (isTransparentRailwayNode(node)) {
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      children.forEach((child, index) => {
        visit(child, index === 0 ? arrival : NESTED);
      });
      return;
    }

    // Skip entirely: error handlers, transforms, streams, etc.
    if (isSkippedRailwayNode(node)) return;

    const binding = bindingOf(arrival);
    const push = (): void => {
      steps.push({ node, ...(binding !== undefined ? { binding } : {}) });
    };

    // Opaque: shown as a single box, never recursed into (loops, conditionals,
    // parallel, race, retry, timeout, resource).
    if (isOpaqueRailwayStep(node)) {
      push();
      return;
    }

    // Declarations are never steps; unnamed effects are steps only when a
    // generator awaited them.
    if (isDefinitionNode(node)) return;
    if (arrival.kind === 'nested' && isAnonymousEffect(node)) return;

    push();
  };

  for (const node of nodes) {
    visit(node, NESTED);
  }

  return steps;
}

/** Build railway step descriptors from flow nodes. */
function buildSteps(flat: readonly FlatStep[]): readonly RailwayStep[] {
  return flat.map(({ node, binding }) => ({
    label: computeLabel(node, binding),
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
        lines.push(`  ${id}["${label}"] -->|ok| ${nextId}["${nextLabel}"]`);
      } else {
        lines.push(`  ${id} -->|ok| ${nextId}["${nextLabel}"]`);
      }
    } else {
      if (i === 0) {
        lines.push(`  ${id}["${label}"] -->|ok| Done((Success))`);
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
      errorLines.push(`  ${id} -->|err| ${errId}["${errLabel}"]`);
    }
  } else if (ir.root.errorTypes.length > 0) {
    const lastId = stepId(steps.length - 1);
    const errLabel = escapeLabel(
      ir.root.errorTypes.map(stripErrorSuffix).join(' / ')
    );
    errorLines.push(`  ${lastId} -->|err| Errors["${errLabel}"]`);
  }

  return [...lines, ...errorLines].join('\n');
}
