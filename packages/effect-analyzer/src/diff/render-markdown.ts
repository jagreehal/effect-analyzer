import type { ProgramDiff, DiffMarkdownOptions, StepDiffEntry } from './types';

const KIND_ICONS: Record<string, string> = {
  added: '+',
  removed: '-',
  unchanged: ' ',
  renamed: '~',
  moved: '>',
};

function formatStepLine(entry: StepDiffEntry): string {
  const icon = KIND_ICONS[entry.kind] ?? '?';
  const callee = entry.callee ?? entry.stepId;

  switch (entry.kind) {
    case 'renamed':
      return `${icon} **${callee}** (renamed from \`${entry.previousStepId}\` → \`${entry.stepId}\`)`;
    case 'moved':
      return `${icon} **${callee}** (moved from \`${entry.containerBefore}\` → \`${entry.containerAfter}\`)`;
    case 'added':
      return `${icon} **${callee}** (added, id: \`${entry.stepId}\`)`;
    case 'removed':
      return `${icon} **${callee}** (removed, id: \`${entry.stepId}\`)`;
    default:
      return `${icon} ${callee}`;
  }
}

export function renderDiffMarkdown(
  diff: ProgramDiff,
  options?: DiffMarkdownOptions,
): string {
  const showUnchanged = options?.showUnchanged ?? false;
  const title =
    options?.title ?? `Effect Program Diff: ${diff.beforeName} → ${diff.afterName}`;

  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Added | ${diff.summary.stepsAdded} |`);
  lines.push(`| Removed | ${diff.summary.stepsRemoved} |`);
  lines.push(`| Renamed | ${diff.summary.stepsRenamed} |`);
  lines.push(`| Moved | ${diff.summary.stepsMoved} |`);
  lines.push(`| Unchanged | ${diff.summary.stepsUnchanged} |`);
  lines.push(`| Structural changes | ${diff.summary.structuralChanges} |`);
  if (diff.summary.hasRegressions) {
    lines.push(`| **Regressions** | **Yes** |`);
  }
  lines.push('');

  // Step changes
  const visibleSteps = showUnchanged
    ? diff.steps
    : diff.steps.filter((s) => s.kind !== 'unchanged');

  if (visibleSteps.length > 0) {
    lines.push('## Step Changes');
    lines.push('');
    lines.push('```diff');
    for (const entry of visibleSteps) {
      lines.push(formatStepLine(entry));
    }
    lines.push('```');
    lines.push('');
  }

  // Structural changes
  if (diff.structuralChanges.length > 0) {
    lines.push('## Structural Changes');
    lines.push('');
    for (const sc of diff.structuralChanges) {
      const prefix = sc.kind === 'added' ? '+' : '-';
      lines.push(`- ${prefix} ${sc.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
