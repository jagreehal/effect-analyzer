/**
 * Renders state-machine coverage results as a Markdown report (with a summary
 * table for multi-machine / directory runs) and provides pass/fail helpers for
 * CI gating, including an optional minimum-coverage threshold.
 */

import { basename } from 'node:path';
import type { StateMachineCoverage } from '../state-machine-coverage';

export interface CoverageReportOptions {
  /** Minimum coverage percent (0–100); machines below it fail the report. */
  readonly minCoverage?: number | undefined;
}

export interface CoverageSummary {
  readonly machineCount: number;
  readonly warningCount: number;
  readonly minCoverage: number | undefined;
  readonly belowThreshold: readonly string[];
  readonly passed: boolean;
}

const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;

function list(label: string, items: readonly string[]): string | undefined {
  if (items.length === 0) return undefined;
  return `- ${label}: ${items.map((i) => `\`${i}\``).join(', ')}`;
}

/** True when any machine has a warning-level finding (use for CI exit codes). */
export function hasCoverageWarnings(
  coverages: readonly StateMachineCoverage[],
): boolean {
  return coverages.some((c) =>
    c.findings.some((f) => f.severity === 'warning'),
  );
}

/** Aggregate pass/fail summary, factoring in an optional coverage threshold. */
export function summarizeCoverage(
  coverages: readonly StateMachineCoverage[],
  minCoverage?: number,
): CoverageSummary {
  const warningCount = coverages.reduce(
    (n, c) => n + c.findings.filter((f) => f.severity === 'warning').length,
    0,
  );
  const belowThreshold =
    minCoverage === undefined
      ? []
      : coverages
          .filter((c) => c.coverageRatio * 100 < minCoverage)
          .map((c) => c.machine);
  return {
    machineCount: coverages.length,
    warningCount,
    minCoverage,
    belowThreshold,
    passed: warningCount === 0 && belowThreshold.length === 0,
  };
}

export function renderCoverageReport(
  coverages: readonly StateMachineCoverage[],
  options: CoverageReportOptions = {},
): string {
  if (coverages.length === 0) {
    return '# State machine coverage\n\nNo state machines found.';
  }

  const { minCoverage } = options;
  const summary = summarizeCoverage(coverages, minCoverage);
  const belowSet = new Set(summary.belowThreshold);

  const lines: string[] = ['# State machine coverage', ''];
  lines.push(
    `${summary.machineCount} machine${summary.machineCount === 1 ? '' : 's'}, ${summary.warningCount} warning${summary.warningCount === 1 ? '' : 's'}.` +
      (minCoverage === undefined ? '' : ` Threshold: ${minCoverage}%.`),
    '',
  );

  // Summary table for multi-machine (e.g. directory) runs.
  if (coverages.length > 1) {
    lines.push('| Machine | File | Coverage | Warnings |');
    lines.push('|---------|------|----------|----------|');
    for (const c of coverages) {
      const warnings = c.findings.filter((f) => f.severity === 'warning').length;
      const flag = belowSet.has(c.machine) ? ' ⚠' : '';
      lines.push(
        `| ${c.machine} | ${c.file ? basename(c.file) : '—'} | ${pct(c.coverageRatio)}${flag} | ${warnings} |`,
      );
    }
    lines.push('');
  }

  for (const c of coverages) {
    const src = c.alphabetSource ? ` _(alphabet: ${c.alphabetSource})_` : '';
    lines.push(`## ${c.machine}${src}`, '');

    if (!c.alphabetKnown) {
      lines.push(
        '> Declared alphabet could not be resolved from the types — completeness was checked only against observed transitions.',
        '',
      );
    }

    lines.push(
      `Coverage: **${pct(c.coverageRatio)}** (${c.handledPairs}/${c.totalPairs} reachable state×event pairs handled)`,
      '',
    );

    const warningLines = [
      list('⚠ Unhandled events', c.unhandledEvents),
      list('⚠ Unreachable states', c.unreachableStates),
      list('⚠ Undeclared states', c.undeclaredStates),
      list('⚠ Undeclared events', c.undeclaredEvents),
    ].filter((x): x is string => x !== undefined);
    if (belowSet.has(c.machine) && minCoverage !== undefined) {
      warningLines.push(
        `- ⚠ Coverage ${pct(c.coverageRatio)} is below the ${minCoverage}% threshold`,
      );
    }
    const infoLines = [list('ℹ Final states', c.deadEndStates)].filter(
      (x): x is string => x !== undefined,
    );

    if (warningLines.length === 0) {
      lines.push('✓ No completeness warnings.', '');
    } else {
      lines.push(...warningLines, '');
    }
    if (infoLines.length > 0) lines.push(...infoLines, '');
  }

  return lines.join('\n').trimEnd() + '\n';
}
