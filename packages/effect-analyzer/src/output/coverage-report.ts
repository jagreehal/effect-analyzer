/** Stable human, quiet, and JSON rendering for coverage audits. */

import { sep } from 'path';
import type { AuditPolicyDecision } from '../audit-policy';
import type { CoverageAuditResult } from '../project-analyzer';

export type CoverageReportMode = 'human' | 'quiet' | 'json';

export interface CoverageReportOptions {
  readonly mode: CoverageReportMode;
  readonly root: string;
  readonly decision?: AuditPolicyDecision | undefined;
  readonly pretty?: boolean | undefined;
  readonly showSuspiciousZeros?: boolean | undefined;
  readonly showTopUnknown?: boolean | undefined;
  readonly showTopUnknownReasons?: boolean | undefined;
  readonly showByFolder?: boolean | undefined;
  readonly timestamp?: string | undefined;
}

const percent = (rate: number, digits: number): string =>
  `${(rate * 100).toFixed(digits)}%`;

const ratio = (numerator: number, denominator: number): string =>
  `${String(numerator)}/${String(denominator)}`;

const renderViolations = (decision: AuditPolicyDecision | undefined): string[] =>
  decision?.violations.map((violation) => `  [${violation.kind}] ${violation.message}`) ?? [];

const renderQuiet = (
  audit: CoverageAuditResult,
  decision: AuditPolicyDecision | undefined,
): string => {
  const assessment = audit.assessment;
  const status = decision === undefined ? '' : `${decision.passed ? 'PASS' : 'FAIL'} | `;
  const summary = [
    `Coverage audit: ${status}${String(audit.discovered)} files`,
    `Effect adoption ${percent(assessment.effectAdoption.rate, 1)} (${ratio(assessment.effectAdoption.numerator, assessment.effectAdoption.denominator)})`,
    `analysis success ${percent(assessment.analysisSuccess.rate, 1)} (${ratio(assessment.analysisSuccess.numerator, assessment.analysisSuccess.denominator)})`,
    `source resolution ${percent(assessment.sourceResolution.rate, 2)} (${ratio(assessment.sourceResolution.numerator, assessment.sourceResolution.denominator)})`,
    `failed ${String(audit.failed)}`,
    `suspicious ${String(audit.suspiciousZeros.length)}`,
  ].join(' | ');
  const violations = renderViolations(decision);
  return violations.length === 0 ? summary : [summary, ...violations].join('\n');
};

const renderHuman = (
  audit: CoverageAuditResult,
  options: CoverageReportOptions,
): string => {
  const assessment = audit.assessment;
  const lines = [
    `Coverage audit for ${options.root}`,
    `Files discovered:      ${String(audit.discovered)}`,
    `Effect-bearing files:  ${String(audit.analyzed)}`,
    `No Effect programs:    ${String(audit.zeroPrograms)}`,
    `Analysis failures:     ${String(audit.failed)}`,
    `Suspicious zero files: ${String(audit.suspiciousZeros.length)}`,
    `Effect adoption:       ${percent(assessment.effectAdoption.rate, 1)} (${ratio(assessment.effectAdoption.numerator, assessment.effectAdoption.denominator)} discovered files)`,
    `Analysis success:      ${percent(assessment.analysisSuccess.rate, 1)} (${ratio(assessment.analysisSuccess.numerator, assessment.analysisSuccess.denominator)} relevant files)`,
    `IR source resolution:  ${percent(assessment.sourceResolution.rate, 2)} (${ratio(assessment.sourceResolution.numerator, assessment.sourceResolution.denominator)} IR nodes)`,
    ...(audit.durationMs === undefined ? [] : [`Duration:              ${String(audit.durationMs)}ms`]),
    `Zero categories: barrel/index=${String(audit.zeroProgramCategoryCounts.barrel_or_index)}, config/build=${String(audit.zeroProgramCategoryCounts.config_or_build)}, test/dtslint=${String(audit.zeroProgramCategoryCounts.test_or_dtslint)}, type-only=${String(audit.zeroProgramCategoryCounts.type_only)}, suspicious=${String(audit.zeroProgramCategoryCounts.suspicious)}, other=${String(audit.zeroProgramCategoryCounts.other)}`,
  ];

  if (options.decision) {
    lines.push('', `Policy: ${options.decision.passed ? 'PASS' : 'FAIL'}`);
    lines.push(...renderViolations(options.decision));
  }

  if (options.showByFolder && audit.outcomes.length > 0) {
    const byFolder = new Map<string, { ok: number; zero: number; fail: number }>();
    for (const outcome of audit.outcomes) {
      const relative = outcome.file.replace(options.root, '').replace(/^[/\\]+/, '');
      const folder = relative.split(sep)[0] ?? '(root)';
      const counts = byFolder.get(folder) ?? { ok: 0, zero: 0, fail: 0 };
      counts[outcome.status]++;
      byFolder.set(folder, counts);
    }
    lines.push('', 'By top-level folder:');
    for (const [folder, counts] of [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${folder}: ok=${String(counts.ok)} zero=${String(counts.zero)} fail=${String(counts.fail)}`);
    }
  }

  const failures = audit.outcomes.filter((outcome) => outcome.status === 'fail');
  if (failures.length > 0) {
    lines.push('', 'Analysis failures:');
    for (const failure of failures) {
      lines.push(`  ${failure.file}: ${failure.error ?? 'Unknown analysis failure'}`);
    }
  }

  if (audit.suspiciousZeros.length > 0) {
    const suspicious = options.showSuspiciousZeros
      ? audit.suspiciousZeros
      : audit.suspiciousZeros.slice(0, 10);
    lines.push('', options.showSuspiciousZeros ? 'Suspicious zero-program files:' : 'Suspicious zero-program files (sample):');
    lines.push(...suspicious.map((file) => `  ${file}`));
    if (suspicious.length < audit.suspiciousZeros.length) {
      lines.push(`  ... and ${String(audit.suspiciousZeros.length - suspicious.length)} more (use --show-suspicious-zeros)`);
    }
  }

  if (options.showTopUnknown) {
    const unknownNodes = audit.fidelityFindings.filter(
      (finding) => finding.kind === 'unknown-node',
    );
    const findings = unknownNodes.slice(0, 10);
    if (findings.length > 0) {
      const header =
        findings.length < unknownNodes.length
          ? `Located unknown nodes (showing ${String(findings.length)} of ${String(unknownNodes.length)}):`
          : 'Located unknown nodes:';
      lines.push('', header);
      for (const finding of findings) {
        const location = finding.location
          ? `${finding.location.filePath}:${String(finding.location.line)}:${String(finding.location.column)}`
          : `${finding.file} (${finding.nodeId})`;
        lines.push(`  ${location}: ${finding.reason ?? finding.message}`);
      }
    }
  }
  if (options.showTopUnknownReasons && audit.topUnknownReasons && audit.topUnknownReasons.length > 0) {
    lines.push('', 'Top unknown node reasons:');
    lines.push(...audit.topUnknownReasons.map(({ reason, count }) => `  ${String(count)}\t${reason}`));
  }

  lines.push('', 'Detection is heuristic. Fidelity findings identify unresolved source explicitly.');
  return lines.join('\n');
};

export const renderCoverageReport = (
  audit: CoverageAuditResult,
  options: CoverageReportOptions,
): string => {
  if (options.mode === 'quiet') return renderQuiet(audit, options.decision);
  if (options.mode === 'json') {
    return JSON.stringify({
      ...audit,
      policy: options.decision,
      timestamp: options.timestamp ?? new Date().toISOString(),
      dirPath: options.root,
    }, null, options.pretty ? 2 : undefined);
  }
  return renderHuman(audit, options);
};
