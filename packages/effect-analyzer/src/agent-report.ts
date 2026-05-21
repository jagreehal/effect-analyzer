/**
 * Agent Report — prioritized, actionable improvement backlog for coding agents.
 *
 * Combines lint findings, coverage audit, error channel analysis, service health,
 * and performance anti-patterns into a single structured report optimized for
 * agent consumption and automated fix application.
 */

import type { LintFinding } from './lint-session';
import type { StaticEffectIR } from './types';

// =============================================================================
// Types
// =============================================================================

export type AgentPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface AgentImprovement {
  readonly priority: AgentPriority;
  readonly category: string;
  readonly rule: string;
  readonly title: string;
  readonly description: string;
  readonly count: number;
  readonly files: readonly AgentFileRef[];
  readonly suggestion: string;
  readonly fix?: string | undefined;
  readonly exampleBefore?: string | undefined;
  readonly exampleAfter?: string | undefined;
  readonly estimatedEffort: 'trivial' | 'low' | 'medium' | 'high';
}

export interface AgentFileRef {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
}

export interface AgentErrorChannelIssue {
  readonly programName: string;
  readonly filePath: string;
  readonly errorType: string;
  readonly type: 'generic-error' | 'unhandled-error' | 'missing-catch-tag' | 'error-type-widening' | 'no-error-handlers';
  readonly description: string;
  readonly suggestion: string;
}

export interface AgentServiceHealthIssue {
  readonly type: 'unsatisfied' | 'dead-service' | 'layer-inefficiency' | 'duplicate-provide';
  readonly service: string;
  readonly description: string;
  readonly files: readonly string[];
  readonly suggestion: string;
}

export interface AgentPerformanceIssue {
  readonly type: 'sequential-could-parallel' | 'unbounded-concurrency' | 'n-plus-one' | 'large-gen-block' | 'missing-batching' | 'unbounded-retry' | 'forEach-sequential';
  readonly filePath: string;
  readonly programName: string;
  readonly line: number;
  readonly description: string;
  readonly suggestion: string;
  readonly estimatedImpact: 'low' | 'medium' | 'high';
}

export interface AgentReportSummary {
  readonly filesAnalyzed: number;
  readonly programsFound: number;
  readonly unknownNodeRate: number;
  readonly lintErrors: number;
  readonly lintWarnings: number;
  readonly lintInfos: number;
  readonly errorChannelIssues: number;
  readonly serviceHealthIssues: number;
  readonly performanceIssues: number;
  readonly totalImprovements: number;
}

export interface AgentReport {
  readonly summary: AgentReportSummary;
  readonly improvements: readonly AgentImprovement[];
  readonly errorChannelIssues: readonly AgentErrorChannelIssue[];
  readonly serviceHealthIssues: readonly AgentServiceHealthIssue[];
  readonly performanceIssues: readonly AgentPerformanceIssue[];
}

// =============================================================================
// Priority helpers
// =============================================================================

const priorityRank = (p: AgentPriority): number => {
  switch (p) {
    case 'P0': return 0;
    case 'P1': return 1;
    case 'P2': return 2;
    case 'P3': return 3;
  }
};

const severityToPriority = (severity: 'error' | 'warning' | 'info'): AgentPriority => {
  switch (severity) {
    case 'error': return 'P0';
    case 'warning': return 'P1';
    case 'info': return 'P2';
  }
};

const ruleToEffort = (rule: string): 'trivial' | 'low' | 'medium' | 'high' => {
  const trivial = new Set([
    'effect-fail-untagged',
    'raw-side-effect-in-gen',
    'array-push-spread',
    'console-log-in-effect',
    'promise-api-in-gen',
    'identity-catch',
    'empty-effect-all',
    'layer-duplicate-merge',
    'config-secret-without-redacted',
    'forEach-without-concurrency',
    'catchAll-vs-catchTag',
    'redundant-pipe',
    'dead-code',
    'untagged-yield',
  ]);
  const low = new Set([
    'schedule-unbounded',
    'run-effect-in-gen',
    'return-effect-from-sync',
    'runPromise-then-chain',
    'runSync-on-async',
    'yield-promise',
    'missing-error-handler',
    'swallowed-error',
    'ordie-on-recoverable',
    'error-type-too-wide',
  ]);
  if (trivial.has(rule)) return 'trivial';
  if (low.has(rule)) return 'low';
  return 'medium';
};

const ruleToCategory = (rule: string): string => {
  const categories: Record<string, string> = {
    'effect-fail-untagged': 'error-handling',
    'untagged-throw': 'error-handling',
    'raw-side-effect-in-gen': 'side-effects',
    'console-log-in-effect': 'observability',
    'promise-api-in-gen': 'side-effects',
    'array-push-spread': 'performance',
    'schedule-unbounded': 'resilience',
    'identity-catch': 'dead-code',
    'empty-effect-all': 'dead-code',
    'layer-duplicate-merge': 'dependency-injection',
    'config-secret-without-redacted': 'security',
    'forEach-without-concurrency': 'performance',
    'catchAll-vs-catchTag': 'error-handling',
    'redundant-pipe': 'code-quality',
    'dead-code': 'dead-code',
    'untagged-yield': 'code-quality',
    'run-effect-in-gen': 'architecture',
    'return-effect-from-sync': 'architecture',
    'runPromise-then-chain': 'architecture',
    'runSync-on-async': 'correctness',
    'yield-promise': 'correctness',
    'missing-error-handler': 'error-handling',
    'swallowed-error': 'error-handling',
    'ordie-on-recoverable': 'error-handling',
    'error-type-too-wide': 'error-handling',
    'mutable-in-concurrent': 'correctness',
    'live-layer-in-test': 'testing',
    'nondeterministic-test-api': 'testing',
    'detached-fiber-in-test': 'testing',
    'sleep-without-testclock': 'testing',
    'unbounded-parallelism': 'performance',
    'complex-layer': 'dependency-injection',
    'large-gen-block': 'code-quality',
    'flatMap-chain': 'code-quality',
    'provide-merge-chain': 'dependency-injection',
    'sequential-fail': 'error-handling',
    'deferred-no-resolve': 'correctness',
  };
  return categories[rule] ?? 'general';
};

const ruleToTitle = (rule: string): string => {
  const titles: Record<string, string> = {
    'effect-fail-untagged': 'Replace Effect.fail(new Error(...)) with tagged errors',
    'untagged-throw': 'Replace throw new Error with Effect.fail(tagged error)',
    'raw-side-effect-in-gen': 'Wrap raw side effects in Effect.sync or use services',
    'console-log-in-effect': 'Replace console.* with Effect.log*',
    'promise-api-in-gen': 'Replace Promise.* with Effect.*',
    'array-push-spread': 'Replace arr.push(...xs) with loop or concat',
    'schedule-unbounded': 'Bound Schedule.forever/spaced with recurs or upTo',
    'identity-catch': 'Remove identity catch handlers',
    'empty-effect-all': 'Remove empty Effect.all calls',
    'layer-duplicate-merge': 'Remove duplicate layers in merge/provide',
    'config-secret-without-redacted': 'Use Config.redacted for secrets',
    'forEach-without-concurrency': 'Add explicit concurrency option to forEach',
    'catchAll-vs-catchTag': 'Use catchTag for tagged errors',
    'redundant-pipe': 'Remove redundant pipe with no transformations',
    'dead-code': 'Remove unused yield assignments',
    'untagged-yield': 'Assign yield results or use Effect.tap',
    'run-effect-in-gen': 'Compose with yield* instead of run* inside gen',
    'return-effect-from-sync': 'Use Effect.suspend or flatMap instead of sync returning Effect',
    'runPromise-then-chain': 'Use Effect combinators before runPromise',
    'runSync-on-async': 'Use runPromise for async effects',
    'yield-promise': 'Wrap Promise in Effect.promise for yield*',
    'missing-error-handler': 'Add error handler for failable effects',
    'swallowed-error': 'Handle or log errors instead of ignoring',
    'ordie-on-recoverable': 'Reserve orDie for unrecoverable errors',
    'error-type-too-wide': 'Use tagged errors instead of unknown/Error',
    'mutable-in-concurrent': 'Use Ref or Atomic for shared state in concurrent code',
    'live-layer-in-test': 'Use test doubles instead of Live layers',
    'nondeterministic-test-api': 'Use deterministic time/RNG in tests',
    'detached-fiber-in-test': 'Await fiber completion in tests',
    'sleep-without-testclock': 'Use TestClock for timing in tests',
    'unbounded-parallelism': 'Limit parallelism with bounded concurrency',
    'complex-layer': 'Simplify Layer composition',
    'large-gen-block': 'Break large gen blocks into smaller functions',
    'flatMap-chain': 'Use pipe/for-comprehension for long chains',
    'provide-merge-chain': 'Use Layer.mergeAll for multiple provides',
    'sequential-fail': 'Handle errors before sequential composition',
    'deferred-no-resolve': 'Ensure Deferred is resolved in all paths',
  };
  return titles[rule] ?? rule;
};

// =============================================================================
// Group findings by rule for consolidated improvements
// =============================================================================

interface GroupedFinding {
  readonly rule: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly suggestion: string;
  readonly files: readonly AgentFileRef[];
}

const groupFindingsByRule = (findings: readonly LintFinding[]): readonly GroupedFinding[] => {
  const map = new Map<string, {
    rule: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion: string;
    files: AgentFileRef[];
  }>();

  for (const f of findings) {
    const key = `${f.rule}|${f.message}`;
    const existing = map.get(key);
    if (existing) {
      existing.files.push({ filePath: f.filePath, line: f.line, column: f.column });
      // Upgrade severity if needed
      if (f.severity === 'error' && existing.severity !== 'error') {
        existing.severity = 'error';
      } else if (f.severity === 'warning' && existing.severity === 'info') {
        existing.severity = 'warning';
      }
    } else {
      map.set(key, {
        rule: f.rule,
        severity: f.severity,
        message: f.message,
        suggestion: f.suggestion ?? '',
        files: [{ filePath: f.filePath, line: f.line, column: f.column }],
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    const pCmp = priorityRank(severityToPriority(a.severity)) - priorityRank(severityToPriority(b.severity));
    if (pCmp !== 0) return pCmp;
    return b.files.length - a.files.length;
  });
};

// =============================================================================
// Main report builder
// =============================================================================

export interface BuildAgentReportOptions {
  readonly findings: readonly LintFinding[];
  readonly irs?: readonly StaticEffectIR[] | undefined;
  readonly coverageAudit?: {
    readonly discovered: number;
    readonly analyzed: number;
    readonly unknownNodeRate: number;
  } | undefined;
  readonly errorChannelIssues?: readonly AgentErrorChannelIssue[] | undefined;
  readonly serviceHealthIssues?: readonly AgentServiceHealthIssue[] | undefined;
  readonly performanceIssues?: readonly AgentPerformanceIssue[] | undefined;
}

export const buildAgentReport = (options: BuildAgentReportOptions): AgentReport => {
  const {
    findings,
    irs = [],
    coverageAudit,
    errorChannelIssues = [],
    serviceHealthIssues = [],
    performanceIssues = [],
  } = options;

  const grouped = groupFindingsByRule(findings);

  const improvements: AgentImprovement[] = grouped.map((g) => ({
    priority: severityToPriority(g.severity),
    category: ruleToCategory(g.rule),
    rule: g.rule,
    title: ruleToTitle(g.rule),
    description: g.message,
    count: g.files.length,
    files: g.files.slice(0, 20), // cap for readability
    suggestion: g.suggestion,
    estimatedEffort: ruleToEffort(g.rule),
  }));

  // Add error channel issues as improvements
  for (const ec of errorChannelIssues) {
    improvements.push({
      priority: ec.type === 'unhandled-error' ? 'P0' : 'P1',
      category: 'error-handling',
      rule: `error-channel:${ec.type}`,
      title: `Error channel: ${ec.type}`,
      description: ec.description,
      count: 1,
      files: [{ filePath: ec.filePath, line: 1, column: 1 }],
      suggestion: ec.suggestion,
      estimatedEffort: 'medium',
    });
  }

  // Add service health issues as improvements
  for (const sh of serviceHealthIssues) {
    improvements.push({
      priority: sh.type === 'unsatisfied' ? 'P0' : 'P2',
      category: 'dependency-injection',
      rule: `service-health:${sh.type}`,
      title: `Service: ${sh.type === 'unsatisfied' ? 'Unsatisfied' : sh.type === 'dead-service' ? 'Dead' : 'Inefficient'} — ${sh.service}`,
      description: sh.description,
      count: sh.files.length,
      files: sh.files.slice(0, 20).map((f) => ({ filePath: f, line: 1, column: 1 })),
      suggestion: sh.suggestion,
      estimatedEffort: sh.type === 'layer-inefficiency' ? 'trivial' : 'medium',
    });
  }

  // Add performance issues as improvements
  for (const pp of performanceIssues) {
    improvements.push({
      priority: pp.estimatedImpact === 'high' ? 'P1' : 'P2',
      category: 'performance',
      rule: `performance:${pp.type}`,
      title: `Performance: ${pp.type}`,
      description: pp.description,
      count: 1,
      files: [{ filePath: pp.filePath, line: pp.line, column: 1 }],
      suggestion: pp.suggestion,
      estimatedEffort: 'medium',
    });
  }

  // Sort by priority, then count (most impactful first)
  improvements.sort((a, b) => {
    const pCmp = priorityRank(a.priority) - priorityRank(b.priority);
    if (pCmp !== 0) return pCmp;
    return b.count - a.count;
  });

  const lintErrors = findings.filter((f) => f.severity === 'error').length;
  const lintWarnings = findings.filter((f) => f.severity === 'warning').length;
  const lintInfos = findings.filter((f) => f.severity === 'info').length;

  const summary: AgentReportSummary = {
    filesAnalyzed: coverageAudit?.analyzed ?? irs.length,
    programsFound: irs.length,
    unknownNodeRate: coverageAudit?.unknownNodeRate ?? 0,
    lintErrors,
    lintWarnings,
    lintInfos,
    errorChannelIssues: errorChannelIssues.length,
    serviceHealthIssues: serviceHealthIssues.length,
    performanceIssues: performanceIssues.length,
    totalImprovements: improvements.length,
  };

  return { summary, improvements, errorChannelIssues, serviceHealthIssues, performanceIssues };
};

// =============================================================================
// Renderers
// =============================================================================

export const renderAgentReportJson = (report: AgentReport, pretty = true): string =>
  JSON.stringify(report, null, pretty ? 2 : 0);

export const renderAgentReportMarkdown = (report: AgentReport): string => {
  const lines: string[] = [];

  lines.push('# Effect Analyzer — Agent Report\n');

  // Summary
  lines.push('## Summary\n');
  const s = report.summary;
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files analyzed | ${s.filesAnalyzed} |`);
  lines.push(`| Programs found | ${s.programsFound} |`);
  lines.push(`| Unknown node rate | ${(s.unknownNodeRate * 100).toFixed(1)}% |`);
  lines.push(`| Lint errors | ${s.lintErrors} |`);
  lines.push(`| Lint warnings | ${s.lintWarnings} |`);
  lines.push(`| Lint infos | ${s.lintInfos} |`);
  lines.push(`| Error channel issues | ${s.errorChannelIssues} |`);
  lines.push(`| Service health issues | ${s.serviceHealthIssues} |`);
  lines.push(`| Performance issues | ${s.performanceIssues} |`);
  lines.push(`| **Total improvements** | **${s.totalImprovements}** |`);
  lines.push('');

  // Improvements by priority
  const byPriority = new Map<AgentPriority, AgentImprovement[]>();
  for (const imp of report.improvements) {
    const existing = byPriority.get(imp.priority) ?? [];
    existing.push(imp);
    byPriority.set(imp.priority, existing);
  }

  for (const [priority, imps] of [['P0', byPriority.get('P0')], ['P1', byPriority.get('P1')], ['P2', byPriority.get('P2')], ['P3', byPriority.get('P3')]] as [AgentPriority, AgentImprovement[] | undefined][]) {
    if (!imps || imps.length === 0) continue;
    lines.push(`## ${priority} — ${priority === 'P0' ? 'Critical' : priority === 'P1' ? 'Important' : priority === 'P2' ? 'Recommended' : 'Nice to have'}\n`);
    for (const imp of imps) {
      lines.push(`### ${imp.title}`);
      lines.push('');
      lines.push(`- **Rule**: \`${imp.rule}\``);
      lines.push(`- **Category**: ${imp.category}`);
      lines.push(`- **Count**: ${imp.count} occurrence(s)`);
      lines.push(`- **Effort**: ${imp.estimatedEffort}`);
      lines.push(`- **Description**: ${imp.description}`);
      lines.push(`- **Suggestion**: ${imp.suggestion}`);
      if (imp.files.length > 0) {
        lines.push(`- **Files**:`);
        for (const f of imp.files.slice(0, 10)) {
          lines.push(`  - \`${f.filePath}:${f.line}\``);
        }
        if (imp.files.length > 10) {
          lines.push(`  - ... and ${imp.files.length - 10} more`);
        }
      }
      if (imp.exampleBefore) {
        lines.push('');
        lines.push('**Before:**');
        lines.push('```typescript');
        lines.push(imp.exampleBefore);
        lines.push('```');
      }
      if (imp.exampleAfter) {
        lines.push('');
        lines.push('**After:**');
        lines.push('```typescript');
        lines.push(imp.exampleAfter);
        lines.push('```');
      }
      lines.push('');
    }
  }

  return lines.join('\n');
};

// =============================================================================
// Quick summary for CLI
// =============================================================================

export const renderAgentReportSummary = (report: AgentReport): string => {
  const lines: string[] = [];
  const s = report.summary;

  lines.push(`Agent Report Summary`);
  lines.push(`====================`);
  lines.push(`Files: ${s.filesAnalyzed} | Programs: ${s.programsFound} | Unknown: ${(s.unknownNodeRate * 100).toFixed(1)}%`);
  lines.push(`Lint: ${s.lintErrors} errors, ${s.lintWarnings} warnings, ${s.lintInfos} infos`);
  lines.push(`Error channel: ${s.errorChannelIssues} | Service health: ${s.serviceHealthIssues} | Performance: ${s.performanceIssues}`);
  lines.push(`Total improvements: ${s.totalImprovements}`);
  lines.push('');

  const byPriority = new Map<AgentPriority, number>();
  for (const imp of report.improvements) {
    byPriority.set(imp.priority, (byPriority.get(imp.priority) ?? 0) + 1);
  }

  for (const p of ['P0', 'P1', 'P2', 'P3'] as AgentPriority[]) {
    const count = byPriority.get(p) ?? 0;
    if (count > 0) {
      const label = p === 'P0' ? 'Critical' : p === 'P1' ? 'Important' : p === 'P2' ? 'Recommended' : 'Nice to have';
      lines.push(`  ${p} (${label}): ${count}`);
    }
  }

  lines.push('');

  // Top 10 improvements
  lines.push('Top improvements:');
  for (const imp of report.improvements.slice(0, 10)) {
    lines.push(`  [${imp.priority}] ${imp.title} (${imp.count}x, ${imp.estimatedEffort})`);
  }

  return lines.join('\n');
};
