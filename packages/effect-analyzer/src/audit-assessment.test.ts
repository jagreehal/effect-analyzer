import { describe, expect, it } from 'vitest';
import { assessAudit } from './audit-assessment';
import { evaluateAuditPolicy } from './audit-policy';

describe('audit assessment and policy', () => {
  it('keeps adoption, analysis success, and source resolution denominators explicit', () => {
    const assessment = assessAudit({
      discoveredFiles: 64,
      effectFiles: 23,
      failedFiles: 0,
      totalNodes: 100,
      unresolvedNodes: 6,
    });

    expect(assessment.effectAdoption).toEqual({ numerator: 23, denominator: 64, rate: 23 / 64 });
    expect(assessment.analysisSuccess).toEqual({ numerator: 23, denominator: 23, rate: 1 });
    expect(assessment.sourceResolution).toEqual({ numerator: 94, denominator: 100, rate: 0.94 });
  });

  it('returns typed violations for every failed CI expectation', () => {
    const assessment = assessAudit({
      discoveredFiles: 10,
      effectFiles: 4,
      failedFiles: 2,
      totalNodes: 20,
      unresolvedNodes: 3,
    });
    const decision = evaluateAuditPolicy({
      assessment,
      failedFiles: 2,
      suspiciousZeros: 3,
    }, {
      maxFailedFiles: 0,
      maxSuspiciousZeros: 1,
      minEffectAdoption: 0.5,
      minSourceResolution: 0.9,
    });

    expect(decision.passed).toBe(false);
    expect(decision.violations.map((violation) => violation.kind)).toEqual([
      'failed-files',
      'suspicious-zeros',
      'effect-adoption',
      'source-resolution',
    ]);
  });
});
