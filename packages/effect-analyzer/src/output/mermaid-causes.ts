import { Option } from 'effect';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode } from '../types';

interface CausesOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
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

/** Replace non-alphanumeric characters with underscores for Mermaid node IDs. */
function sanitizeId(text: string): string {
  return text.replace(/[^a-zA-Z0-9]/g, '_');
}

/** Failure patterns for Effect callee matching. */
const EFFECT_FAILURE_CALLEES = new Set(['Effect.fail', 'Effect.die', 'Effect.interrupt']);

interface FailureNode {
  readonly id: string;
  readonly kind: 'fail' | 'die' | 'interrupt' | 'parallel' | 'sequential';
  readonly label: string;
  readonly children: readonly FailureNode[];
}

/** Extract error type label from an effect node. */
function getErrorTypeLabel(node: StaticFlowNode): string | undefined {
  if (node.type === 'effect') {
    const raw = node.typeSignature?.errorType ?? node.errorType;
    if (raw && raw !== 'never' && raw.trim() !== '') return raw;
  }
  return undefined;
}

/** Determine failure kind from an Effect callee. */
function calleeToKind(callee: string): 'fail' | 'die' | 'interrupt' {
  if (callee === 'Effect.die') return 'die';
  if (callee === 'Effect.interrupt') return 'interrupt';
  return 'fail';
}

/** Recursively collect failure-related nodes from the IR tree. */
function collectFailureNodes(node: StaticFlowNode): readonly FailureNode[] {
  const results: FailureNode[] = [];

  // Check if this node is a failure source
  if (node.type === 'cause' && node.isConstructor) {
    const op = node.causeOp;

    if (op === 'parallel' || op === 'sequential') {
      // Composite cause: collect children recursively
      const childFailures: FailureNode[] = [];
      const children = node.children ?? [];
      for (const child of children) {
        childFailures.push(...collectFailureNodes(child));
      }
      results.push({
        id: sanitizeId(node.id),
        kind: op,
        label: `Cause.${op}`,
        children: childFailures,
      });
      return results;
    }

    if (op === 'fail' || op === 'die' || op === 'interrupt') {
      results.push({
        id: sanitizeId(node.id),
        kind: op,
        label: `Cause.${op}`,
        children: [],
      });
      return results;
    }
  }

  if (node.type === 'exit' && node.isConstructor) {
    const op = node.exitOp;
    if (op === 'fail' || op === 'die' || op === 'interrupt') {
      results.push({
        id: sanitizeId(node.id),
        kind: op === 'fail' ? 'fail' : op === 'die' ? 'die' : 'interrupt',
        label: `Exit.${op}`,
        children: [],
      });
      return results;
    }
  }

  if (node.type === 'effect' && EFFECT_FAILURE_CALLEES.has(node.callee)) {
    const kind = calleeToKind(node.callee);
    const errorType = getErrorTypeLabel(node);
    const label = errorType ? `${node.callee}: ${errorType}` : node.callee;
    results.push({
      id: sanitizeId(node.id),
      kind,
      label,
      children: [],
    });
    return results;
  }

  // Recurse into children for non-failure nodes
  const children = Option.getOrElse(getStaticChildren(node), () => []);
  for (const child of children) {
    results.push(...collectFailureNodes(child));
  }

  return results;
}

/** Render a single failure node and its edges into Mermaid lines. */
function renderFailureNode(
  node: FailureNode,
  parentId: string | undefined,
  edgeLabel: string | undefined,
  lines: string[],
  styledNodes: Map<string, 'fail' | 'die' | 'interrupt' | 'composite'>,
  counter: { value: number },
): void {
  const nodeId = `N${counter.value++}`;
  const escaped = escapeLabel(node.label);

  if (node.kind === 'parallel' || node.kind === 'sequential') {
    // Composite node — light blue styling
    lines.push(`  ${nodeId}[${escaped}]`);
    styledNodes.set(nodeId, 'composite');

    if (parentId) {
      const edge = edgeLabel ? ` -->|${edgeLabel}| ` : ' --> ';
      lines.push(`  ${parentId}${edge}${nodeId}`);
    }

    const childEdgeLabel = node.kind === 'parallel' ? 'parallel' : 'then';
    for (const child of node.children) {
      renderFailureNode(child, nodeId, childEdgeLabel, lines, styledNodes, counter);
    }
  } else {
    // Leaf failure node
    if (node.kind === 'die') {
      lines.push(`  ${nodeId}[${escaped}]`);
      styledNodes.set(nodeId, 'die');
    } else if (node.kind === 'interrupt') {
      lines.push(`  ${nodeId}[${escaped}]`);
      styledNodes.set(nodeId, 'interrupt');
    } else {
      // fail — rounded rect
      lines.push(`  ${nodeId}(${escaped})`);
      styledNodes.set(nodeId, 'fail');
    }

    if (parentId) {
      const edge = edgeLabel ? ` -->|${edgeLabel}| ` : ' --> ';
      lines.push(`  ${parentId}${edge}${nodeId}`);
    }
  }
}

/**
 * Render a Cause-tree Mermaid flowchart from an Effect IR.
 *
 * Shows how errors compose: parallel failures, sequential failures,
 * defects vs expected errors.
 */
export function renderCausesMermaid(
  ir: StaticEffectIR,
  options: CausesOptions = {},
): string {
  const direction = options.direction ?? 'TB';

  // Collect all failure nodes from the IR
  const failureNodes: FailureNode[] = [];
  for (const child of ir.root.children) {
    failureNodes.push(...collectFailureNodes(child));
  }

  if (failureNodes.length === 0) {
    return `flowchart ${direction}\n  NoCauses((No failure causes))`;
  }

  const lines: string[] = [`flowchart ${direction}`];
  const styledNodes = new Map<string, 'fail' | 'die' | 'interrupt' | 'composite'>();
  const counter = { value: 0 };

  // Root node
  const rootId = 'Root';
  const programName = escapeLabel(ir.root.programName);
  lines.push(`  ${rootId}((${programName}))`);

  // Render each top-level failure node
  for (const node of failureNodes) {
    renderFailureNode(node, rootId, undefined, lines, styledNodes, counter);
  }

  // Style definitions
  lines.push('');
  lines.push('  classDef failStyle fill:#FFCDD2,stroke:#C62828');
  lines.push('  classDef dieStyle fill:#B71C1C,color:#fff');
  lines.push('  classDef interruptStyle fill:#FFE0B2,stroke:#E65100');
  lines.push('  classDef compositeStyle fill:#E3F2FD');

  // Apply styles
  const styleGroups: { failStyle: string[]; dieStyle: string[]; interruptStyle: string[]; compositeStyle: string[] } = {
    failStyle: [],
    dieStyle: [],
    interruptStyle: [],
    compositeStyle: [],
  };

  for (const [nodeId, kind] of styledNodes) {
    if (kind === 'fail') styleGroups.failStyle.push(nodeId);
    else if (kind === 'die') styleGroups.dieStyle.push(nodeId);
    else if (kind === 'interrupt') styleGroups.interruptStyle.push(nodeId);
    else styleGroups.compositeStyle.push(nodeId);
  }

  for (const [className, nodeIds] of Object.entries(styleGroups)) {
    if (nodeIds.length > 0) {
      lines.push(`  class ${nodeIds.join(',')} ${className}`);
    }
  }

  return lines.join('\n');
}
