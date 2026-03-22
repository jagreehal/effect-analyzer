import { Option } from 'effect';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode } from '../types';

interface DecisionsOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

const DECISION_TYPES = new Set(['conditional', 'decision', 'switch', 'match']);

/** Escape characters that break Mermaid label syntax. */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\(/g, '#lpar;')
    .replace(/\)/g, '#rpar;');
}

/** Truncate text to a maximum length, appending ellipsis if needed. */
function truncate(text: string, max = 40): string {
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

/** Compute a display label for a flow node. */
function nodeLabel(node: StaticFlowNode): string {
  if (node.displayName) return node.displayName;
  if (node.name) return node.name;
  if (node.type === 'effect') return node.callee;
  return node.type;
}

interface DecisionInfo {
  readonly node: StaticFlowNode;
  readonly nodeId: string;
}

/** Recursively collect all decision-type nodes from the IR tree. */
function collectDecisionNodes(nodes: readonly StaticFlowNode[]): DecisionInfo[] {
  const result: DecisionInfo[] = [];
  let counter = 0;

  const visit = (node: StaticFlowNode): void => {
    if (DECISION_TYPES.has(node.type)) {
      result.push({ node, nodeId: `D${counter++}` });
    }

    // Walk into children from getStaticChildren
    const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
    for (const child of children) {
      visit(child);
    }

    // Also walk into branch-specific children not covered by getStaticChildren
    if (node.type === 'conditional') {
      const cond = node;
      visit(cond.onTrue);
      if (cond.onFalse) visit(cond.onFalse);
    } else if (node.type === 'decision') {
      const dec = node;
      for (const child of dec.onTrue) visit(child);
      if (dec.onFalse) for (const child of dec.onFalse) visit(child);
    } else if (node.type === 'switch') {
      const sw = node;
      for (const c of sw.cases) {
        for (const child of c.body) visit(child);
      }
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return result;
}

/** Find a decision info entry by node reference. */
function findDecisionInfo(decisions: DecisionInfo[], node: StaticFlowNode): DecisionInfo | undefined {
  return decisions.find(d => d.node === node);
}

/** Find the first decision node in a list of nodes. */
function findFirstDecision(decisions: DecisionInfo[], nodes: readonly StaticFlowNode[]): DecisionInfo | undefined {
  for (const node of nodes) {
    const found = findDecisionInfo(decisions, node);
    if (found) return found;
  }
  return undefined;
}

/** Render a terminal node ID and its definition line for a branch target. */
function renderBranchTarget(
  node: StaticFlowNode | undefined,
  decisions: DecisionInfo[],
  terminalCounter: { value: number },
): { targetId: string; extraLine?: string } {
  if (!node) {
    const tId = `T${terminalCounter.value++}`;
    return { targetId: tId, extraLine: `  ${tId}["..."]` };
  }

  const decInfo = findDecisionInfo(decisions, node);
  if (decInfo) {
    return { targetId: decInfo.nodeId };
  }

  const label = escapeLabel(nodeLabel(node));
  const tId = `T${terminalCounter.value++}`;
  return { targetId: tId, extraLine: `  ${tId}["${label}"]` };
}

/** Render a branch target from an array of nodes. */
function renderArrayBranchTarget(
  nodes: readonly StaticFlowNode[] | undefined,
  decisions: DecisionInfo[],
  terminalCounter: { value: number },
): { targetId: string; extraLine?: string } {
  if (!nodes || nodes.length === 0) {
    const tId = `T${terminalCounter.value++}`;
    return { targetId: tId, extraLine: `  ${tId}["..."]` };
  }

  // Check if any node in the array is a decision node
  const dec = findFirstDecision(decisions, nodes);
  if (dec) {
    return { targetId: dec.nodeId };
  }

  const firstNode = nodes[0];
  if (!firstNode) {
    const tId = `T${terminalCounter.value++}`;
    return { targetId: tId, extraLine: `  ${tId}["..."]` };
  }
  const label = escapeLabel(nodeLabel(firstNode));
  const tId = `T${terminalCounter.value++}`;
  return { targetId: tId, extraLine: `  ${tId}["${label}"]` };
}

/**
 * Render a decision-tree Mermaid flowchart from an Effect IR.
 *
 * Decision nodes (conditional, decision, switch, match) are rendered as
 * diamond-shaped nodes with labeled edges to their branches.
 */
export function renderDecisionsMermaid(
  ir: StaticEffectIR,
  options: DecisionsOptions = {},
): string {
  const direction = options.direction ?? 'TB';
  const decisions = collectDecisionNodes(ir.root.children);

  if (decisions.length === 0) {
    return `flowchart ${direction}\n  NoDec((No decisions))`;
  }

  const lines: string[] = [`flowchart ${direction}`];
  const terminalCounter = { value: 0 };

  for (const { node, nodeId } of decisions) {
    switch (node.type) {
      case 'conditional': {
        const cond = node;
        const condText = escapeLabel(truncate(cond.condition));
        lines.push(`  ${nodeId}{${condText}}`);

        const trueLabel = cond.trueEdgeLabel ?? 'true';
        const falseLabel = cond.falseEdgeLabel ?? 'false';

        const trueBranch = renderBranchTarget(cond.onTrue, decisions, terminalCounter);
        if (trueBranch.extraLine) lines.push(trueBranch.extraLine);
        lines.push(`  ${nodeId} -->|${trueLabel}| ${trueBranch.targetId}`);

        if (cond.onFalse) {
          const falseBranch = renderBranchTarget(cond.onFalse, decisions, terminalCounter);
          if (falseBranch.extraLine) lines.push(falseBranch.extraLine);
          lines.push(`  ${nodeId} -->|${falseLabel}| ${falseBranch.targetId}`);
        }
        break;
      }

      case 'decision': {
        const dec = node;
        const condText = escapeLabel(truncate(dec.condition));
        lines.push(`  ${nodeId}{${condText}}`);

        const trueBranch = renderArrayBranchTarget(dec.onTrue, decisions, terminalCounter);
        if (trueBranch.extraLine) lines.push(trueBranch.extraLine);
        lines.push(`  ${nodeId} -->|true| ${trueBranch.targetId}`);

        if (dec.onFalse) {
          const falseBranch = renderArrayBranchTarget(dec.onFalse, decisions, terminalCounter);
          if (falseBranch.extraLine) lines.push(falseBranch.extraLine);
          lines.push(`  ${nodeId} -->|false| ${falseBranch.targetId}`);
        }
        break;
      }

      case 'switch': {
        const sw = node;
        const exprText = escapeLabel(truncate(sw.expression));
        lines.push(`  ${nodeId}{${exprText}}`);

        for (const c of sw.cases) {
          const caseLabel = c.isDefault ? 'default' : c.labels.join(', ');
          const caseBranch = renderArrayBranchTarget(c.body, decisions, terminalCounter);
          if (caseBranch.extraLine) lines.push(caseBranch.extraLine);
          lines.push(`  ${nodeId} -->|${caseLabel}| ${caseBranch.targetId}`);
        }
        break;
      }

      case 'match': {
        const m = node;
        const matchLabel = escapeLabel(`Match.${m.matchOp}`);
        lines.push(`  ${nodeId}{${matchLabel}}`);

        if (m.matchedTags && m.matchedTags.length > 0) {
          for (const tag of m.matchedTags) {
            const tId = `T${terminalCounter.value++}`;
            lines.push(`  ${tId}["${escapeLabel(tag)}"]`);
            lines.push(`  ${nodeId} -->|${escapeLabel(tag)}| ${tId}`);
          }
        } else {
          const tId = `T${terminalCounter.value++}`;
          lines.push(`  ${tId}["..."]`);
          lines.push(`  ${nodeId} -->|match| ${tId}`);
        }
        break;
      }
    }
  }

  return lines.join('\n');
}
