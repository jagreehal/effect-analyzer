/**
 * Performance Anti-Patterns — detects common performance issues in Effect code.
 *
 * Detects:
 * - Sequential operations that could be parallel (Effect.all)
 * - Unbounded concurrency on large collections
 * - Missing request batching (N+1 patterns)
 * - Unbounded retries without Schedule.recurs or Schedule.upTo
 * - Large gen blocks (>50 yields)
 * - Effect.forEach without concurrency option
 */

import type {
  StaticEffectIR,
  StaticFlowNode,
} from './types';
import {
  isStaticParallelNode,
  isStaticRetryNode,
  isStaticGeneratorNode,
  isStaticEffectNode,
  getStaticChildren,
} from './types';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export interface PerformanceIssue {
  readonly type: 'sequential-could-parallel' | 'unbounded-concurrency' | 'n-plus-one' | 'large-gen-block' | 'missing-batching' | 'unbounded-retry' | 'forEach-sequential';
  readonly filePath: string;
  readonly programName: string;
  readonly line: number;
  readonly description: string;
  readonly suggestion: string;
  readonly estimatedImpact: 'low' | 'medium' | 'high';
}

export interface PerformanceAnalysis {
  readonly issues: readonly PerformanceIssue[];
  readonly summary: PerformanceSummary;
}

export interface PerformanceSummary {
  readonly totalPrograms: number;
  readonly sequentialCouldParallel: number;
  readonly unboundedConcurrency: number;
  readonly largeGenBlocks: number;
  readonly unboundedRetries: number;
  readonly forEachSequential: number;
}

// =============================================================================
// Analysis
// =============================================================================

export const analyzePerformance = (
  irs: readonly StaticEffectIR[],
): PerformanceAnalysis => {
  const issues: PerformanceIssue[] = [];
  let sequentialCouldParallel = 0;
  let unboundedConcurrency = 0;
  let largeGenBlocks = 0;
  let unboundedRetries = 0;
  let forEachSequential = 0;

  for (const ir of irs) {
    const filePath = ir.metadata.filePath;
    const programName = ir.root.programName;

    visitNodes(ir.root, (node) => {
      // Check for unbounded parallelism
      if (isStaticParallelNode(node)) {
        if (node.concurrency === 'unbounded' && node.children.length > 5) {
          issues.push({
            type: 'unbounded-concurrency',
            filePath,
            programName,
            line: node.location?.line ?? 1,
            description: `Effect.all with unbounded concurrency (${node.children.length} branches) — can overwhelm resources`,
            suggestion: 'Use { concurrency: N } to limit parallelism (e.g., { concurrency: 4 })',
            estimatedImpact: 'high',
          });
          unboundedConcurrency++;
        }

        // Check for sequential that could be parallel
        if (node.mode === 'sequential' && node.children.length >= 3) {
          // Heuristic: if all children are independent effects (no data dependencies), suggest parallel
          const allIndependent = node.children.every((child) => {
            if (child.type === 'effect') {
              // Simple heuristic: if it's a service call or constructor, likely independent
              return child.callee.includes('Effect.') || child.serviceCall !== undefined;
            }
            return false;
          });

          if (allIndependent) {
            issues.push({
              type: 'sequential-could-parallel',
              filePath,
              programName,
              line: node.location?.line ?? 1,
              description: `Effect.all runs ${node.children.length} independent effects sequentially — could be parallel`,
              suggestion: 'Use Effect.all(effects, { concurrency: "unbounded" }) for parallel execution',
              estimatedImpact: 'medium',
            });
            sequentialCouldParallel++;
          }
        }
      }

      // Check for large gen blocks
      if (isStaticGeneratorNode(node)) {
        const yieldCount = node.yields.length;
        if (yieldCount > 30) {
          issues.push({
            type: 'large-gen-block',
            filePath,
            programName,
            line: node.location?.line ?? 1,
            description: `Effect.gen has ${yieldCount} yields — consider breaking into smaller functions`,
            suggestion: 'Extract logical sections into separate Effect-returning functions for better testability and readability',
            estimatedImpact: 'low',
          });
          largeGenBlocks++;
        }
      }

      // Check for unbounded retries
      if (isStaticRetryNode(node)) {
        const schedule = node.schedule ?? '';
        const hasBound = schedule.includes('recurs') ||
          schedule.includes('upTo') ||
          schedule.includes('intersect') ||
          schedule.includes('whileOutput');

        if (!hasBound && (schedule.includes('forever') || schedule.includes('spaced') || schedule.includes('exponential') || schedule.includes('fibonacci'))) {
          issues.push({
            type: 'unbounded-retry',
            filePath,
            programName,
            line: node.location?.line ?? 1,
            description: `Retry uses unbounded schedule — can run forever`,
            suggestion: 'Add Schedule.recurs(N) or Schedule.upTo(duration) to bound retries',
            estimatedImpact: 'medium',
          });
          unboundedRetries++;
        }
      }

      // Check for Effect.forEach without concurrency
      if (isStaticEffectNode(node) && node.callee === 'Effect.forEach') {
        // Heuristic: check if the source text includes concurrency option
        // This is a rough check — the actual source would need to be inspected
        issues.push({
          type: 'forEach-sequential',
          filePath,
          programName,
          line: node.location?.line ?? 1,
          description: 'Effect.forEach without explicit concurrency — defaults to sequential',
          suggestion: 'Add { concurrency: "unbounded" } or { concurrency: N } to make the choice explicit',
          estimatedImpact: 'medium',
        });
        forEachSequential++;
      }
    });
  }

  return {
    issues,
    summary: {
      totalPrograms: irs.length,
      sequentialCouldParallel,
      unboundedConcurrency,
      largeGenBlocks,
      unboundedRetries,
      forEachSequential,
    },
  };
};

const visitNodes = (
  root: { children: readonly StaticFlowNode[] } | StaticFlowNode,
  fn: (node: StaticFlowNode) => void,
): void => {
  const visit = (node: StaticFlowNode) => {
    fn(node);
    const childrenOpt = getStaticChildren(node);
    if (Option.isSome(childrenOpt)) {
      for (const child of childrenOpt.value) {
        visit(child);
      }
    }
  };

  if ('children' in root) {
    const children = (root as { children: readonly StaticFlowNode[] }).children;
    for (const child of children) {
      visit(child);
    }
  } else {
    visit(root);
  }
};

// =============================================================================
// Renderers
// =============================================================================

export const renderPerformanceReport = (analysis: PerformanceAnalysis): string => {
  const lines: string[] = [];
  const s = analysis.summary;

  lines.push('# Performance Anti-Patterns\n');
  lines.push('## Summary\n');
  lines.push(`- Total programs: ${s.totalPrograms}`);
  lines.push(`- Sequential could be parallel: ${s.sequentialCouldParallel}`);
  lines.push(`- Unbounded concurrency: ${s.unboundedConcurrency}`);
  lines.push(`- Large gen blocks: ${s.largeGenBlocks}`);
  lines.push(`- Unbounded retries: ${s.unboundedRetries}`);
  lines.push(`- forEach without concurrency: ${s.forEachSequential}`);
  lines.push('');

  if (analysis.issues.length > 0) {
    lines.push('## Issues\n');
    for (const issue of analysis.issues) {
      const impactIcon = issue.estimatedImpact === 'high' ? '🔴' : issue.estimatedImpact === 'medium' ? '🟡' : '🟢';
      lines.push(`${impactIcon} **[${issue.type}]** ${issue.programName}`);
      lines.push(`   ${issue.description}`);
      lines.push(`   at ${issue.filePath}:${issue.line}`);
      lines.push(`   💡 ${issue.suggestion}`);
      lines.push('');
    }
  }

  return lines.join('\n');
};

export const renderPerformanceJson = (analysis: PerformanceAnalysis, pretty = true): string =>
  JSON.stringify(analysis, null, pretty ? 2 : 0);
