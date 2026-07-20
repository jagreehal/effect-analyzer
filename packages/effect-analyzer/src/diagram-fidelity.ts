/** Diagram fidelity: whether the IR honestly represents the source program. */

import type { SourceLocation, StaticEffectIR, StaticFlowNode } from './types';
import { indexIR, runtimeSpanName, spanPathKey } from './ir';

export type DiagramFidelityIssueKind =
  | 'unknown-node'
  | 'opaque-node'
  | 'dynamic-span-name'
  | 'duplicate-span-path';

export interface DiagramFidelityIssue {
  readonly kind: DiagramFidelityIssueKind;
  readonly nodeId: string;
  readonly message: string;
  readonly suggestion: string;
  readonly location?: SourceLocation | undefined;
}

export interface DiagramFidelityReport {
  readonly exact: boolean;
  readonly score: number;
  readonly totalNodes: number;
  readonly exactRuntimeNodes: number;
  readonly staticOnlyNodes: number;
  readonly ambiguousRuntimeNodes: number;
  readonly unresolvedNodes: number;
  readonly issues: readonly DiagramFidelityIssue[];
}

const issueForNode = (
  node: StaticFlowNode,
): DiagramFidelityIssue | undefined => {
  if (node.type === 'unknown') {
    return {
      kind: 'unknown-node',
      nodeId: node.id,
      message: `The analyzer could not resolve this expression: ${node.reason}`,
      suggestion: 'Use a supported Effect v4 construct or extract the expression into a named Effect.fn operation.',
      location: node.location,
    };
  }
  if (node.type === 'opaque') {
    return {
      kind: 'opaque-node',
      nodeId: node.id,
      message: `The analyzer intentionally treats this source as opaque: ${node.reason}`,
      suggestion: 'Extract diagram-relevant work into a named Effect.fn operation or an explicit Effect.withSpan region.',
      location: node.location,
    };
  }
  if (
    node.spanNameDynamic === true ||
    (node.type === 'effect' &&
      node.callee.includes('withSpan') &&
      runtimeSpanName(node) === undefined)
  ) {
    return {
      kind: 'dynamic-span-name',
      nodeId: node.id,
      message: 'The runtime span name is computed, so a trace cannot be joined to this static node exactly.',
      suggestion: 'Use a literal Effect.withSpan name and put dynamic values in span attributes.',
      location: node.location,
    };
  }
  return undefined;
};

export const computeDiagramFidelity = (
  ir: StaticEffectIR,
): DiagramFidelityReport => {
  const index = indexIR(ir);
  const issues: DiagramFidelityIssue[] = [];
  const ambiguousIds = new Set<string>();

  for (const node of index.nodes) {
    const issue = issueForNode(node);
    if (issue) issues.push(issue);
  }

  for (const [key, ids] of index.idsBySpanPath) {
    if (ids.length < 2) continue;
    const printablePath = key.split('\u001f').join(' > ');
    for (const nodeId of ids) {
      ambiguousIds.add(nodeId);
      const node = index.byId.get(nodeId);
      issues.push({
        kind: 'duplicate-span-path',
        nodeId,
        message: `Multiple static nodes emit the runtime span path "${printablePath}".`,
        suggestion: 'Give sibling Effect.withSpan or Effect.fn regions distinct literal names.',
        location: node?.location,
      });
    }
  }

  const runtimeNodeIds = new Set(index.spanPathById.keys());
  const unresolvedIds = new Set(
    issues
      .filter((issue) => issue.kind === 'unknown-node' || issue.kind === 'opaque-node' || issue.kind === 'dynamic-span-name')
      .map((issue) => issue.nodeId),
  );
  const exactRuntimeNodes = [...runtimeNodeIds].filter(
    (id) => !ambiguousIds.has(id) && !unresolvedIds.has(id),
  ).length;
  const staticOnlyNodes = index.nodes.length - runtimeNodeIds.size;
  const penalized = new Set([...ambiguousIds, ...unresolvedIds]).size;
  const score = index.nodes.length === 0
    ? 100
    : Math.round(((index.nodes.length - penalized) / index.nodes.length) * 100);

  return {
    exact: issues.length === 0,
    score,
    totalNodes: index.nodes.length,
    exactRuntimeNodes,
    staticOnlyNodes,
    ambiguousRuntimeNodes: ambiguousIds.size,
    unresolvedNodes: unresolvedIds.size,
    issues,
  };
};

export const formatDiagramFidelity = (
  report: DiagramFidelityReport,
): string => {
  if (report.exact) {
    return `✓ Exact diagram fidelity (${String(report.score)}/100)`;
  }
  const lines = [
    `✗ Inexact diagram fidelity (${String(report.score)}/100): ${String(report.issues.length)} issue${report.issues.length === 1 ? '' : 's'}`,
    '',
  ];
  for (const issue of report.issues) {
    const location = issue.location
      ? `${issue.location.filePath}:${String(issue.location.line)}:${String(issue.location.column)}`
      : issue.nodeId;
    lines.push(`[${issue.kind}] ${location}`, `  ${issue.message}`, `  Fix: ${issue.suggestion}`, '');
  }
  return lines.join('\n').trimEnd();
};

export const findStaticNodesForSpanPath = (
  ir: StaticEffectIR,
  path: readonly string[],
): readonly string[] => indexIR(ir).idsBySpanPath.get(spanPathKey(path)) ?? [];
