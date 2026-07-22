/** Unambiguous measurements for a project coverage audit. */

export interface AuditDimension {
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number;
}

export interface AuditAssessment {
  /** Files containing at least one Effect program / all discovered files. */
  readonly effectAdoption: AuditDimension;
  /** Successfully analyzed Effect-bearing files / analyzed plus failed files. */
  readonly analysisSuccess: AuditDimension;
  /** Resolved IR nodes / all IR nodes. */
  readonly sourceResolution: AuditDimension;
}

export interface AuditAssessmentInput {
  readonly discoveredFiles: number;
  readonly effectFiles: number;
  readonly failedFiles: number;
  readonly totalNodes: number;
  readonly unresolvedNodes: number;
}

const dimension = (
  numerator: number,
  denominator: number,
  emptyRate: number,
): AuditDimension => ({
  numerator,
  denominator,
  rate: denominator === 0 ? emptyRate : numerator / denominator,
});

export const assessAudit = (input: AuditAssessmentInput): AuditAssessment => ({
  effectAdoption: dimension(input.effectFiles, input.discoveredFiles, 0),
  analysisSuccess: dimension(
    input.effectFiles,
    input.effectFiles + input.failedFiles,
    1,
  ),
  sourceResolution: dimension(
    input.totalNodes - input.unresolvedNodes,
    input.totalNodes,
    1,
  ),
});
