/**
 * Improve Mode — generates actionable patches for improving Effect codebases.
 *
 * Combines all analyses and produces:
 * - Prioritized list of improvements
 * - Code patches for fixable issues
 * - Verification after applying fixes
 */

import * as fs from 'node:fs/promises';
import type { LintFinding } from './lint-session';
import type { CodeFix } from './fix-generators';
import type { AgentReport } from './agent-report';
import { generateAllFixes } from './fix-generators';

// =============================================================================
// Types
// =============================================================================

export interface ImprovePlan {
  readonly report: AgentReport;
  readonly fixes: readonly CodeFix[];
  readonly totalFixable: number;
  readonly totalUnfixable: number;
  readonly estimatedTime: string;
}

export interface ImproveOptions {
  readonly dryRun: boolean;
  readonly maxFixes?: number | undefined;
  readonly rules?: readonly string[] | undefined;
  readonly excludeRules?: readonly string[] | undefined;
  readonly minPriority?: 'P0' | 'P1' | 'P2' | 'P3' | undefined;
}

export interface ImproveResult {
  readonly applied: readonly CodeFix[];
  readonly skipped: readonly CodeFix[];
  readonly errors: readonly { readonly fix: CodeFix; readonly error: string }[];
}

// =============================================================================
// Plan generation
// =============================================================================

export const generateImprovePlan = (
  report: AgentReport,
  findings: readonly LintFinding[],
  sourceLines: ReadonlyMap<string, readonly string[]>,
  options: ImproveOptions = { dryRun: true },
): ImprovePlan => {
  // Filter findings based on options
  let filteredFindings = findings;

  if (options.rules && options.rules.length > 0) {
    filteredFindings = filteredFindings.filter((f) => options.rules!.includes(f.rule));
  }

  if (options.excludeRules && options.excludeRules.length > 0) {
    filteredFindings = filteredFindings.filter((f) => !options.excludeRules!.includes(f.rule));
  }

  if (options.minPriority) {
    const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const minRank = priorityRank[options.minPriority];
    filteredFindings = filteredFindings.filter((f) => {
      const sevRank = f.severity === 'error' ? 0 : f.severity === 'warning' ? 1 : 2;
      return sevRank <= minRank;
    });
  }

  // Generate fixes
  const allFixes = generateAllFixes(filteredFindings, sourceLines);

  // Limit fixes if requested
  const fixes = options.maxFixes
    ? allFixes.slice(0, options.maxFixes)
    : allFixes;

  // Estimate time
  const trivialCount = fixes.filter((f) => f.confidence === 'high').length;
  const mediumCount = fixes.filter((f) => f.confidence === 'medium').length;
  const lowCount = fixes.filter((f) => f.confidence === 'low').length;
  const estimatedMinutes = trivialCount * 0.5 + mediumCount * 2 + lowCount * 5;

  return {
    report,
    fixes,
    totalFixable: fixes.length,
    totalUnfixable: filteredFindings.length - fixes.length,
    estimatedTime: estimatedMinutes < 1
      ? '< 1 min'
      : estimatedMinutes < 60
        ? `${Math.round(estimatedMinutes)} min`
        : `${Math.round(estimatedMinutes / 60)}h ${Math.round(estimatedMinutes % 60)}min`,
  };
};

// =============================================================================
// Apply fixes
// =============================================================================

export const applyFixes = async (
  fixes: readonly CodeFix[],
  options: { dryRun: boolean } = { dryRun: true },
): Promise<ImproveResult> => {
  const applied: CodeFix[] = [];
  const skipped: CodeFix[] = [];
  const errors: { fix: CodeFix; error: string }[] = [];

  // Group fixes by file
  const byFile = new Map<string, CodeFix[]>();
  for (const fix of fixes) {
    const existing = byFile.get(fix.filePath) ?? [];
    existing.push(fix);
    byFile.set(fix.filePath, existing);
  }

  for (const [filePath, fileFixes] of byFile) {
    try {
      if (options.dryRun) {
        applied.push(...fileFixes);
        continue;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;

      // Sort fixes by line number in reverse order to avoid offset issues
      const sorted = [...fileFixes].sort((a, b) => b.line - a.line);

      for (const fix of sorted) {
        const lineIdx = fix.line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) {
          errors.push({ fix, error: `Line ${fix.line} out of range` });
          skipped.push(fix);
          continue;
        }

        const currentLine = lines[lineIdx];
        if (!currentLine || !currentLine.includes(fix.before.trim().slice(0, 50))) {
          // The line might have changed since analysis — skip
          errors.push({ fix, error: 'Source line mismatch — file may have changed' });
          skipped.push(fix);
          continue;
        }

        lines[lineIdx] = currentLine.replace(fix.before, fix.after);
        modified = true;
        applied.push(fix);
      }

      if (modified) {
        await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
      }
    } catch (err) {
      for (const fix of fileFixes) {
        errors.push({ fix, error: err instanceof Error ? err.message : String(err) });
        skipped.push(fix);
      }
    }
  }

  return { applied, skipped, errors };
};

// =============================================================================
// Renderers
// =============================================================================

export const renderImprovePlan = (plan: ImprovePlan): string => {
  const lines: string[] = [];

  lines.push('# Improve Plan\n');
  lines.push(`## Summary`);
  lines.push(`- Total improvements: ${plan.report.summary.totalImprovements}`);
  lines.push(`- Fixable: ${plan.totalFixable}`);
  lines.push(`- Requires manual fix: ${plan.totalUnfixable}`);
  lines.push(`- Estimated time: ${plan.estimatedTime}`);
  lines.push('');

  if (plan.fixes.length > 0) {
    lines.push('## Fixes\n');
    for (const fix of plan.fixes) {
      const confidenceIcon = fix.confidence === 'high' ? '✅' : fix.confidence === 'medium' ? '⚠️' : '❓';
      lines.push(`${confidenceIcon} **${fix.rule}** at \`${fix.filePath}:${fix.line}\``);
      lines.push(`   ${fix.description}`);
      lines.push('');
      lines.push('   ```diff');
      lines.push(`   - ${fix.before}`);
      lines.push(`   + ${fix.after}`);
      lines.push('   ```');
      lines.push('');
    }
  }

  return lines.join('\n');
};

export const renderImproveResult = (result: ImproveResult): string => {
  const lines: string[] = [];

  lines.push('# Improve Result\n');
  lines.push(`- Applied: ${result.applied.length}`);
  lines.push(`- Skipped: ${result.skipped.length}`);
  lines.push(`- Errors: ${result.errors.length}`);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push('## Errors\n');
    for (const { fix, error } of result.errors) {
      lines.push(`- \`${fix.rule}\` at \`${fix.filePath}:${fix.line}\`: ${error}`);
    }
    lines.push('');
  }

  if (result.skipped.length > 0) {
    lines.push('## Skipped\n');
    for (const fix of result.skipped) {
      lines.push(`- \`${fix.rule}\` at \`${fix.filePath}:${fix.line}\`: ${fix.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};
