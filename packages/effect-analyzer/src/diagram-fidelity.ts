/** Diagram fidelity: whether the IR honestly represents the source program. */

import type { SourceLocation, StaticEffectIR } from './types';
import { indexIR, spanPathKey } from './ir';
import {
  assessIRFidelity,
  type FidelityFindingKind,
} from './fidelity-findings';

export type DiagramFidelityIssueKind = FidelityFindingKind;

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

export const computeDiagramFidelity = (
  ir: StaticEffectIR,
): DiagramFidelityReport => {
  const assessment = assessIRFidelity(ir);
  const issues: readonly DiagramFidelityIssue[] = assessment.findings;

  return {
    exact: assessment.exact,
    score: assessment.score,
    totalNodes: assessment.sourceRepresentation.total,
    exactRuntimeNodes: assessment.runtimeJoinability.resolved,
    staticOnlyNodes: assessment.staticOnlyNodes,
    ambiguousRuntimeNodes: new Set(issues
      .filter((issue) => issue.kind === 'duplicate-span-path')
      .map((issue) => issue.nodeId)).size,
    unresolvedNodes: new Set(issues
      .filter((issue) => issue.kind !== 'duplicate-span-path')
      .map((issue) => issue.nodeId)).size,
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
