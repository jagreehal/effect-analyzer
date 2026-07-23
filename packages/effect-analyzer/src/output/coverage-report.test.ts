import { describe, expect, it } from 'vitest';
import type { CoverageAuditResult } from '../project-analyzer';
import { renderCoverageReport } from './coverage-report';

const audit: CoverageAuditResult = {
  discovered: 4,
  analyzed: 2,
  zeroPrograms: 2,
  failed: 0,
  assessment: {
    effectAdoption: { numerator: 2, denominator: 4, rate: 0.5 },
    analysisSuccess: { numerator: 2, denominator: 2, rate: 1 },
    sourceResolution: { numerator: 9, denominator: 10, rate: 0.9 },
  },
  outcomes: [
    { file: '/repo/src/program.ts', status: 'ok', programCount: 1 },
    { file: '/repo/src/another.ts', status: 'ok', programCount: 1 },
    { file: '/repo/src/types.ts', status: 'zero', programCount: 0 },
    { file: '/repo/src/index.ts', status: 'zero', programCount: 0 },
  ],
  unknownNodeRate: 0.1,
  totalNodes: 10,
  unknownNodes: 1,
  fidelityFindings: [],
  suspiciousZeros: [],
  zeroProgramCategoryCounts: {
    barrel_or_index: 1,
    config_or_build: 0,
    test_or_dtslint: 0,
    type_only: 1,
    suspicious: 0,
    other: 0,
  },
  zeroProgramClassifications: [],
  topUnknownFiles: ['/repo/src/program.ts'],
  unknownReasonCounts: { unresolved: 1 },
  topUnknownReasons: [{ reason: 'unresolved', count: 1 }],
  durationMs: 20,
};

describe('coverage report', () => {
  it('renders quiet mode as one decision-oriented line without file details', () => {
    const output = renderCoverageReport(audit, {
      mode: 'quiet',
      root: '/repo/src',
    });

    expect(output.split('\n')).toHaveLength(1);
    expect(output).toContain('Effect adoption 50.0% (2/4)');
    expect(output).toContain('analysis success 100.0% (2/2)');
    expect(output).not.toContain('program.ts');
    expect(output).not.toContain('index.ts');
  });

  it('names each human metric and omits expected zero files', () => {
    const output = renderCoverageReport(audit, {
      mode: 'human',
      root: '/repo/src',
    });

    expect(output).toContain('Effect adoption:');
    expect(output).toContain('Analysis success:');
    expect(output).toContain('IR source resolution:');
    expect(output).not.toContain('/repo/src/types.ts');
    expect(output).not.toContain('/repo/src/index.ts');
  });

  it('flags truncation when more unknown nodes exist than are listed', () => {
    const findings = Array.from({ length: 14 }, (_, index) => ({
      kind: 'unknown-node' as const,
      nodeId: `n${String(index)}`,
      message: 'unresolved',
      suggestion: 'extract',
      reason: 'unresolved',
      location: { filePath: `/repo/src/f${String(index)}.ts`, line: index + 1, column: 1 },
    }));
    const output = renderCoverageReport(
      { ...audit, fidelityFindings: findings },
      { mode: 'human', root: '/repo/src', showTopUnknown: true },
    );

    expect(output).toContain('Located unknown nodes (showing 10 of 14):');
  });

  it('omits the truncation note when every unknown node is listed', () => {
    const findings = Array.from({ length: 3 }, (_, index) => ({
      kind: 'unknown-node' as const,
      nodeId: `n${String(index)}`,
      message: 'unresolved',
      suggestion: 'extract',
      reason: 'unresolved',
      location: { filePath: `/repo/src/f${String(index)}.ts`, line: index + 1, column: 1 },
    }));
    const output = renderCoverageReport(
      { ...audit, fidelityFindings: findings },
      { mode: 'human', root: '/repo/src', showTopUnknown: true },
    );

    expect(output).toContain('Located unknown nodes:');
    expect(output).not.toContain('showing');
  });

  it('includes the typed policy decision in JSON output', () => {
    const output = renderCoverageReport(audit, {
      mode: 'json',
      root: '/repo/src',
      timestamp: '2026-07-22T00:00:00.000Z',
      decision: {
        passed: false,
        violations: [{
          kind: 'source-resolution',
          actual: 0.9,
          expected: 0.95,
          message: 'Source resolution is below policy.',
        }],
      },
    });

    expect(JSON.parse(output)).toMatchObject({
      policy: {
        passed: false,
        violations: [{ kind: 'source-resolution' }],
      },
    });
  });
});
