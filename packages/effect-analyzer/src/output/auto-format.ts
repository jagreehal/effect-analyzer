import { Option } from 'effect';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode, type MermaidDetailLevel } from '../types';
import { inferBestDiagramType } from './auto-diagram';
import { countMeaningfulNodes } from '../analysis-utils';

export type AutoFormat =
  | 'mermaid'
  | 'mermaid-railway'
  | 'mermaid-services'
  | 'mermaid-errors'
  | 'mermaid-concurrency'
  | 'mermaid-decisions'
  | 'mermaid-layers'
  | 'mermaid-retry'
  | 'mermaid-testability'
  | 'mermaid-dataflow'
  | 'mermaid-causes'
  | 'mermaid-timeline';

export interface FormatSelection {
  readonly format: AutoFormat | 'explain';
  readonly detail?: MermaidDetailLevel | undefined;
}

interface FormatScore {
  format: AutoFormat;
  score: number;
}

function hasCauseSignals(node: StaticFlowNode): boolean {
  if (node.type === 'cause' || node.type === 'exit') return true;
  if (node.type === 'effect' && (node.callee === 'Effect.cause' || node.callee === 'Effect.exit')) {
    return true;
  }

  const children = Option.getOrElse(getStaticChildren(node), () => []);
  return children.some(hasCauseSignals);
}

/**
 * Analyzes the IR and returns the most relevant formats to render.
 * Size-aware: large programs get explain + compact mermaid,
 * small programs get mermaid/railway + specialized diagrams.
 */
export function selectFormats(ir: StaticEffectIR): FormatSelection[] {
  const stats = ir.metadata.stats;
  const root = ir.root;
  const nodeCount = countMeaningfulNodes(root.children);

  const scores: FormatScore[] = [
    {
      format: 'mermaid-services',
      score: root.dependencies.length * 2 + (root.requiredServices?.length ?? 0),
    },
    {
      format: 'mermaid-concurrency',
      score: stats.parallelCount * 3 + stats.raceCount * 3,
    },
    {
      format: 'mermaid-errors',
      score: root.errorTypes.length > 0 ? root.errorTypes.length * 2 + stats.errorHandlerCount * 2 : 0,
    },
    {
      format: 'mermaid-retry',
      score: stats.retryCount * 4 + stats.timeoutCount * 3,
    },
    {
      format: 'mermaid-decisions',
      score: stats.conditionalCount + stats.decisionCount + stats.switchCount,
    },
    {
      format: 'mermaid-layers',
      score: stats.layerCount * 3,
    },
    {
      format: 'mermaid-dataflow',
      score: root.source === 'pipe' ? 5 : 0,
    },
    {
      format: 'mermaid-causes',
      score: root.children.some(hasCauseSignals) ? 4 : 0,
    },
    {
      format: 'mermaid-timeline',
      score: root.dependencies.length > 2 ? 3 : 0,
    },
    {
      format: 'mermaid-testability',
      score: (root.requiredServices?.length ?? 0) * 2,
    },
  ];

  const top: FormatSelection[] = scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => ({ format: s.format }));

  const baselineDiagramType: AutoFormat = inferBestDiagramType(ir) === 'railway' ? 'mermaid-railway' : 'mermaid';

  // Small programs: mermaid baseline, no explain
  if (nodeCount < 30) {
    return [{ format: baselineDiagramType }, ...top];
  }

  // Medium programs: explain first, then mermaid with standard detail
  if (nodeCount <= 80) {
    return [{ format: 'explain' }, { format: baselineDiagramType, detail: 'standard' }, ...top];
  }

  // Large programs: explain first, then mermaid with compact detail
  return [{ format: 'explain' }, { format: baselineDiagramType, detail: 'compact' }, ...top];
}
