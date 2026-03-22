import { Option } from 'effect';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode } from '../types';

interface ConcurrencyOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

type ConcurrencyNode =
  | { kind: 'parallel'; node: Extract<StaticFlowNode, { type: 'parallel' }> }
  | { kind: 'race'; node: Extract<StaticFlowNode, { type: 'race' }> }
  | { kind: 'fiber'; node: Extract<StaticFlowNode, { type: 'fiber' }> }
  | { kind: 'primitive'; node: Extract<StaticFlowNode, { type: 'concurrency-primitive' }> };

/** Escape characters that break Mermaid label syntax. */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\(/g, '#lpar;')
    .replace(/\)/g, '#rpar;');
}

/** Generate a short node ID. */
function nodeId(prefix: string, index: number): string {
  return `${prefix}${index}`;
}

/** Compute a display label for a child flow node. */
function childLabel(node: StaticFlowNode, index: number): string {
  if (node.displayName) return node.displayName;
  if (node.name) return node.name;
  if (node.type === 'effect') return node.callee;
  return `child_${index}`;
}

/** Capitalize a primitive name. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Recursively collect concurrency-related nodes from the IR. */
function collectConcurrencyNodes(nodes: readonly StaticFlowNode[]): ConcurrencyNode[] {
  const result: ConcurrencyNode[] = [];

  const visit = (node: StaticFlowNode): void => {
    switch (node.type) {
      case 'parallel':
        result.push({ kind: 'parallel', node });
        break;
      case 'race':
        result.push({ kind: 'race', node });
        break;
      case 'fiber':
        result.push({ kind: 'fiber', node });
        break;
      case 'concurrency-primitive':
        result.push({ kind: 'primitive', node });
        break;
    }

    const children = Option.getOrElse(getStaticChildren(node), () => []);
    for (const child of children) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return result;
}

/**
 * Render a concurrency-focused Mermaid flowchart from an Effect IR.
 *
 * Shows parallel execution, races, fiber forks/joins, and concurrency primitives.
 */
export function renderConcurrencyMermaid(
  ir: StaticEffectIR,
  options: ConcurrencyOptions = {},
): string {
  const direction = options.direction ?? 'TB';
  const collected = collectConcurrencyNodes(ir.root.children);

  if (collected.length === 0) {
    return `flowchart ${direction}\n  NoConcurrency((No concurrency))`;
  }

  const lines: string[] = [`flowchart ${direction}`];
  const styleLines: string[] = [];
  let globalIdx = 0;

  // Track node IDs for execution-order connections
  const orderedIds: string[] = [];

  for (const entry of collected) {
    switch (entry.kind) {
      case 'parallel': {
        const pNode = entry.node;
        const pId = nodeId('P', globalIdx++);
        const count = pNode.children.length;
        const modeLabel = pNode.mode === 'parallel' ? 'parallel' : 'sequential';
        const label = escapeLabel(`${pNode.callee} #lpar;${count} effects, ${modeLabel}#rpar;`);
        lines.push(`  ${pId}[${label}]`);
        styleLines.push(`  style ${pId} fill:#E3F2FD`);

        // Fork to children
        const joinId = nodeId('PJ', globalIdx++);
        for (let i = 0; i < pNode.children.length; i++) {
          const child = pNode.children[i];
          if (!child) continue;
          const cId = nodeId('PC', globalIdx++);
          const cLabel = escapeLabel(
            pNode.branchLabels?.[i] ?? childLabel(child, i),
          );
          const branchLabel = pNode.branchLabels?.[i];
          const edgeLabel = branchLabel
            ? escapeLabel(branchLabel)
            : undefined;
          lines.push(`  ${cId}[${cLabel}]`);
          if (edgeLabel) {
            lines.push(`  ${pId} -->|${edgeLabel}| ${cId}`);
          } else {
            lines.push(`  ${pId} --> ${cId}`);
          }
          lines.push(`  ${cId} --> ${joinId}`);
        }

        lines.push(`  ${joinId}([Join])`);
        styleLines.push(`  style ${joinId} fill:#E3F2FD`);
        orderedIds.push(pId);
        orderedIds.push(joinId);
        break;
      }

      case 'race': {
        const rNode = entry.node;
        const rId = nodeId('R', globalIdx++);
        lines.push(`  ${rId}{Race}`);
        styleLines.push(`  style ${rId} fill:#FFF3E0`);

        const winnerId = nodeId('RW', globalIdx++);
        for (let i = 0; i < rNode.children.length; i++) {
          const child = rNode.children[i];
          if (!child) continue;
          const cId = nodeId('RC', globalIdx++);
          const cLabel = escapeLabel(
            rNode.raceLabels?.[i] ?? childLabel(child, i),
          );
          lines.push(`  ${cId}[${cLabel}]`);
          lines.push(`  ${rId} -->|competes| ${cId}`);
          lines.push(`  ${cId} -.->|winner?| ${winnerId}`);
        }

        lines.push(`  ${winnerId}([First to complete])`);
        styleLines.push(`  style ${winnerId} fill:#FFF3E0`);
        orderedIds.push(rId);
        orderedIds.push(winnerId);
        break;
      }

      case 'fiber': {
        const fNode = entry.node;
        const fId = nodeId('F', globalIdx++);
        const op = fNode.operation;

        if (op === 'fork' || op === 'forkScoped' || op === 'forkDaemon' || op === 'forkAll' || op === 'forkIn' || op === 'forkWithErrorHandler') {
          const sourceLabel = fNode.fiberSource?.displayName ?? fNode.fiberSource?.name ?? 'effect';
          const label = escapeLabel(`${op}#lpar;${sourceLabel}#rpar;`);
          lines.push(`  ${fId}[${label}]`);

          if (op === 'forkScoped') {
            styleLines.push(`  style ${fId} fill:#C8E6C9`);
          } else if (op === 'forkDaemon') {
            styleLines.push(`  style ${fId} fill:#FFE0B2`);
          } else {
            styleLines.push(`  style ${fId} fill:#FFF9C4`);
          }
        } else if (op === 'join' || op === 'await') {
          const label = escapeLabel(op);
          lines.push(`  ${fId}[${label}]`);
          styleLines.push(`  style ${fId} fill:#BBDEFB`);
        } else {
          const label = escapeLabel(`Fiber.${op}`);
          lines.push(`  ${fId}[${label}]`);
          styleLines.push(`  style ${fId} fill:#BBDEFB`);
        }

        orderedIds.push(fId);
        break;
      }

      case 'primitive': {
        const cpNode = entry.node;
        const cpId = nodeId('CP', globalIdx++);
        const primName = capitalize(cpNode.primitive);
        const label = escapeLabel(`${primName}.${cpNode.operation}`);
        // Hexagon shape: {{...}}
        lines.push(`  ${cpId}{{${label}}}`);
        styleLines.push(`  style ${cpId} fill:#F3E5F5`);
        orderedIds.push(cpId);
        break;
      }
    }
  }

  // Connect nodes in execution order
  for (let i = 0; i < orderedIds.length - 1; i++) {
    const from = orderedIds[i];
    const to = orderedIds[i + 1];
    if (!from || !to) continue;
    lines.push(`  ${from} --> ${to}`);
  }

  return [...lines, ...styleLines].join('\n');
}
