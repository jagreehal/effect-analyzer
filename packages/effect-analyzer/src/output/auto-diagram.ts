import { Option } from 'effect';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode } from '../types';
import { calculateComplexity } from '../complexity';

export type DiagramType = 'mermaid' | 'railway';

/**
 * Infer the best diagram type for an Effect program.
 *
 * Decision order:
 * 1. Hard rules: parallel/race/switch/loop/conditional/decision → mermaid
 * 2. Soft heuristics: low complexity → railway, otherwise mermaid
 */
export function inferBestDiagramType(ir: StaticEffectIR): DiagramType {
  const nodes = ir.root.children;

  // Hard rules: structural nodes that railway cannot represent
  if (hasNodeType(nodes, 'parallel')) return 'mermaid';
  if (hasNodeType(nodes, 'race')) return 'mermaid';
  if (hasNodeType(nodes, 'switch')) return 'mermaid';
  if (hasNodeType(nodes, 'loop')) return 'mermaid';
  if (hasNodeType(nodes, 'conditional')) return 'mermaid';
  if (hasNodeType(nodes, 'decision')) return 'mermaid';

  // Check stats for structural indicators that may not appear as IR nodes
  // (e.g., when the analyzer records counts but the IR is simplified)
  const stats = ir.metadata.stats;
  if (
    stats.decisionCount > 2 ||
    stats.switchCount > 0 ||
    stats.conditionalCount > 2
  ) {
    return 'mermaid';
  }

  // Soft heuristics based on complexity metrics
  const metrics = calculateComplexity(ir);

  if (
    metrics.cyclomaticComplexity <= 3 &&
    metrics.decisionPoints <= 1 &&
    metrics.maxDepth <= 2
  ) {
    return 'railway';
  }

  return 'mermaid';
}

function hasNodeType(
  nodes: readonly StaticFlowNode[],
  type: StaticFlowNode['type'],
): boolean {
  for (const node of nodes) {
    if (node.type === type) return true;
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0 && hasNodeType(children, type)) return true;
  }
  return false;
}
