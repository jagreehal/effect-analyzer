/** Native CI policy evaluation for project coverage audits. */

import type { AuditAssessment } from './audit-assessment';

export type AuditPolicyViolationKind =
  | 'failed-files'
  | 'suspicious-zeros'
  | 'effect-adoption'
  | 'source-resolution';

export interface AuditPolicy {
  readonly maxFailedFiles?: number | undefined;
  readonly maxSuspiciousZeros?: number | undefined;
  readonly minEffectAdoption?: number | undefined;
  readonly minSourceResolution?: number | undefined;
}

export interface AuditPolicyFacts {
  readonly assessment: AuditAssessment;
  readonly failedFiles: number;
  readonly suspiciousZeros: number;
}

export interface AuditPolicyViolation {
  readonly kind: AuditPolicyViolationKind;
  readonly actual: number;
  readonly expected: number;
  readonly message: string;
}

export interface AuditPolicyDecision {
  readonly passed: boolean;
  readonly violations: readonly AuditPolicyViolation[];
}

export const evaluateAuditPolicy = (
  facts: AuditPolicyFacts,
  policy: AuditPolicy,
): AuditPolicyDecision => {
  const violations: AuditPolicyViolation[] = [];

  if (
    policy.maxFailedFiles !== undefined &&
    facts.failedFiles > policy.maxFailedFiles
  ) {
    violations.push({
      kind: 'failed-files',
      actual: facts.failedFiles,
      expected: policy.maxFailedFiles,
      message: `${String(facts.failedFiles)} analysis failures exceed the allowed ${String(policy.maxFailedFiles)}.`,
    });
  }
  if (
    policy.maxSuspiciousZeros !== undefined &&
    facts.suspiciousZeros > policy.maxSuspiciousZeros
  ) {
    violations.push({
      kind: 'suspicious-zeros',
      actual: facts.suspiciousZeros,
      expected: policy.maxSuspiciousZeros,
      message: `${String(facts.suspiciousZeros)} suspicious zero-program files exceed the allowed ${String(policy.maxSuspiciousZeros)}.`,
    });
  }
  if (
    policy.minEffectAdoption !== undefined &&
    facts.assessment.effectAdoption.rate < policy.minEffectAdoption
  ) {
    violations.push({
      kind: 'effect-adoption',
      actual: facts.assessment.effectAdoption.rate,
      expected: policy.minEffectAdoption,
      message: `Effect adoption ${(facts.assessment.effectAdoption.rate * 100).toFixed(1)}% is below the required ${(policy.minEffectAdoption * 100).toFixed(1)}%.`,
    });
  }
  if (
    policy.minSourceResolution !== undefined &&
    facts.assessment.sourceResolution.rate < policy.minSourceResolution
  ) {
    violations.push({
      kind: 'source-resolution',
      actual: facts.assessment.sourceResolution.rate,
      expected: policy.minSourceResolution,
      message: `IR source resolution ${(facts.assessment.sourceResolution.rate * 100).toFixed(2)}% is below the required ${(policy.minSourceResolution * 100).toFixed(2)}%.`,
    });
  }

  return { passed: violations.length === 0, violations };
};
