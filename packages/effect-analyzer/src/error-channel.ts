/**
 * Error Channel Analysis — cross-file report of error handling quality.
 *
 * Detects:
 * - Programs with generic `E` error types instead of concrete errors
 * - Missing catchTag handlers for known tagged errors
 * - Error type widening patterns
 * - Unhandled error types across the project
 */

import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticErrorHandlerNode,
} from './types';
import {
  isStaticEffectNode,
  isStaticErrorHandlerNode,
  getStaticChildren,
} from './types';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export interface ErrorChannelIssue {
  readonly type: 'generic-error' | 'unhandled-error' | 'missing-catch-tag' | 'error-type-widening' | 'no-error-handlers';
  readonly programName: string;
  readonly filePath: string;
  readonly line: number;
  readonly errorType: string;
  readonly description: string;
  readonly suggestion: string;
  readonly severity: 'error' | 'warning' | 'info';
}

export interface ErrorChannelAnalysis {
  readonly issues: readonly ErrorChannelIssue[];
  readonly summary: ErrorChannelSummary;
}

export interface ErrorChannelSummary {
  readonly totalPrograms: number;
  readonly programsWithGenericError: number;
  readonly programsWithNoErrorHandlers: number;
  readonly programsWithUnhandledErrors: number;
  readonly uniqueErrorTypes: readonly string[];
  readonly topErrorTypes: readonly { readonly type: string; readonly count: number }[];
}

// =============================================================================
// Analysis
// =============================================================================

export const analyzeErrorChannels = (
  irs: readonly StaticEffectIR[],
): ErrorChannelAnalysis => {
  const issues: ErrorChannelIssue[] = [];
  const errorTypeCounts = new Map<string, number>();
  let programsWithGenericError = 0;
  let programsWithNoErrorHandlers = 0;
  let programsWithUnhandledErrors = 0;

  for (const ir of irs) {
    const programIssues = analyzeProgramErrorChannel(ir);
    issues.push(...programIssues);

    // Count error types
    for (const et of ir.root.errorTypes) {
      const normalized = et.trim();
      if (normalized && normalized !== 'never') {
        errorTypeCounts.set(normalized, (errorTypeCounts.get(normalized) ?? 0) + 1);
      }
    }

    // Check for generic error type
    const hasGenericError = ir.root.errorTypes.some(
      (e) => e.trim() === 'unknown' || e.trim() === 'Error' || e.trim() === 'E',
    );
    if (hasGenericError) {
      programsWithGenericError++;
    }

    // Check for error handlers
    const errorHandlerCount = countErrorHandlers(ir.root);
    if (errorHandlerCount === 0 && ir.root.errorTypes.some((e) => e.trim() !== 'never')) {
      programsWithNoErrorHandlers++;
    }
  }

  // Find programs with unhandled errors (error types not caught by any handler)
  for (const ir of irs) {
    const unhandled = findUnhandledErrors(ir);
    if (unhandled.length > 0) {
      programsWithUnhandledErrors++;
      for (const uh of unhandled) {
        issues.push({
          type: 'unhandled-error',
          programName: ir.root.programName,
          filePath: ir.metadata.filePath,
          line: ir.root.location?.line ?? 1,
          errorType: uh,
          description: `Error type "${uh}" is not handled in program "${ir.root.programName}"`,
          suggestion: `Add a catchTag("${uh}", handler) or catchAll handler for this error type`,
          severity: 'warning',
        });
      }
    }
  }

  const uniqueErrorTypes = [...errorTypeCounts.keys()].sort();
  const topErrorTypes = [...errorTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([type, count]) => ({ type, count }));

  return {
    issues,
    summary: {
      totalPrograms: irs.length,
      programsWithGenericError,
      programsWithNoErrorHandlers,
      programsWithUnhandledErrors,
      uniqueErrorTypes,
      topErrorTypes,
    },
  };
};

const analyzeProgramErrorChannel = (ir: StaticEffectIR): ErrorChannelIssue[] => {
  const issues: ErrorChannelIssue[] = [];

  // Check for generic error type on the program level
  for (const errorType of ir.root.errorTypes) {
    const normalized = errorType.trim();
    if (normalized === 'unknown') {
      issues.push({
        type: 'generic-error',
        programName: ir.root.programName,
        filePath: ir.metadata.filePath,
        line: ir.root.location?.line ?? 1,
        errorType: 'unknown',
        description: `Program "${ir.root.programName}" has unknown error type — all errors are possible`,
        suggestion: 'Define specific tagged errors and narrow the error channel',
        severity: 'warning',
      });
    } else if (normalized === 'Error') {
      issues.push({
        type: 'generic-error',
        programName: ir.root.programName,
        filePath: ir.metadata.filePath,
        line: ir.root.location?.line ?? 1,
        errorType: 'Error',
        description: `Program "${ir.root.programName}" has built-in Error type — catchTag cannot discriminate`,
        suggestion: 'Use Data.TaggedError for typed error channels',
        severity: 'warning',
      });
    }
  }

  // Check for error type widening (mapErrorCause, orElse, etc. that widen)
  visitNodes(ir.root, (node) => {
    if (isStaticErrorHandlerNode(node)) {
      checkErrorHandlerWidening(node, ir, issues);
    }
  });

  return issues;
};

const checkErrorHandlerWidening = (
  node: StaticErrorHandlerNode,
  ir: StaticEffectIR,
  issues: ErrorChannelIssue[],
): void => {
  // orDie converts typed errors to defects (widening)
  if (node.handlerType === 'orDie' || node.handlerType === 'orDieWith') {
    issues.push({
      type: 'error-type-widening',
      programName: ir.root.programName,
      filePath: ir.metadata.filePath,
      line: node.location?.line ?? 1,
      errorType: 'defect',
      description: `${node.handlerType} converts typed errors to defects — loses type safety`,
      suggestion: 'Reserve orDie for truly unrecoverable errors; use catchTag for recoverable ones',
      severity: 'info',
    });
  }

  // ignore/ignoreLogged swallows errors
  if (node.handlerType === 'ignore' || node.handlerType === 'ignoreLogged') {
    issues.push({
      type: 'error-type-widening',
      programName: ir.root.programName,
      filePath: ir.metadata.filePath,
      line: node.location?.line ?? 1,
      errorType: 'void',
      description: `${node.handlerType} swallows errors — recovery is impossible`,
      suggestion: 'Ensure errors are truly ignorable; consider Effect.logError + Effect.succeed for observable swallowing',
      severity: 'warning',
    });
  }

  // eventually retries forever — can mask errors
  if (node.handlerType === 'eventually') {
    issues.push({
      type: 'error-type-widening',
      programName: ir.root.programName,
      filePath: ir.metadata.filePath,
      line: node.location?.line ?? 1,
      errorType: 'never',
      description: 'eventually retries forever — errors are never surfaced',
      suggestion: 'Use retry with a bounded schedule (Schedule.recurs, Schedule.upTo) for observable retry behavior',
      severity: 'info',
    });
  }
};

const findUnhandledErrors = (ir: StaticEffectIR): readonly string[] => {
  const caughtTags = new Set<string>();
  const hasCatchAll = { value: false };

  visitNodes(ir.root, (node) => {
    if (isStaticErrorHandlerNode(node)) {
      if (node.handlerType === 'catchAll' || node.handlerType === 'catchAllCause') {
        hasCatchAll.value = true;
      }
      if (node.handlerType === 'catchTag' && node.errorTag) {
        caughtTags.add(node.errorTag);
      }
      if (node.handlerType === 'catchTags' && node.errorTags) {
        for (const tag of node.errorTags) {
          caughtTags.add(tag);
        }
      }
    }
  });

  // If there's a catchAll, all errors are handled (albeit generically)
  if (hasCatchAll.value) return [];

  // Collect error types from effect nodes that aren't caught
  const unhandled: string[] = [];
  visitNodes(ir.root, (node) => {
    if (isStaticEffectNode(node) && node.typeSignature) {
      const errType = node.typeSignature.errorType.trim();
      if (errType && errType !== 'never' && errType !== 'unknown' && errType !== 'Error') {
        // Check if this looks like a tagged error (has _tag pattern)
        const tagMatch = /\{.*_tag.*:.*"([^"]+)".*\}/.exec(errType);
        if (tagMatch && tagMatch[1]) {
          const tag = tagMatch[1];
          if (!caughtTags.has(tag)) {
            unhandled.push(tag);
          }
        }
      }
    }
  });

  return [...new Set(unhandled)];
};

const countErrorHandlers = (node: StaticFlowNode | { children: readonly StaticFlowNode[] }): number => {
  let count = 0;

  const visit = (n: StaticFlowNode) => {
    if (isStaticErrorHandlerNode(n)) {
      count++;
    }
    const childrenOpt = getStaticChildren(n);
    if (Option.isSome(childrenOpt)) {
      for (const child of childrenOpt.value) {
        visit(child);
      }
    }
  };

  if ('children' in node) {
    const children = (node as { children: readonly StaticFlowNode[] }).children;
    for (const child of children) {
      visit(child);
    }
  } else {
    visit(node);
  }

  return count;
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

export const renderErrorChannelReport = (analysis: ErrorChannelAnalysis): string => {
  const lines: string[] = [];
  const s = analysis.summary;

  lines.push('# Error Channel Analysis\n');
  lines.push('## Summary\n');
  lines.push(`- Total programs: ${s.totalPrograms}`);
  lines.push(`- Programs with generic error: ${s.programsWithGenericError}`);
  lines.push(`- Programs with no error handlers: ${s.programsWithNoErrorHandlers}`);
  lines.push(`- Programs with unhandled errors: ${s.programsWithUnhandledErrors}`);
  lines.push('');

  if (s.topErrorTypes.length > 0) {
    lines.push('## Top Error Types\n');
    lines.push('| Error Type | Count |');
    lines.push('|------------|-------|');
    for (const { type, count } of s.topErrorTypes) {
      lines.push(`| \`${type}\` | ${count} |`);
    }
    lines.push('');
  }

  if (analysis.issues.length > 0) {
    lines.push('## Issues\n');
    for (const issue of analysis.issues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      lines.push(`${icon} **[${issue.type}]** ${issue.programName}`);
      lines.push(`   Error: \`${issue.errorType}\``);
      lines.push(`   ${issue.description}`);
      lines.push(`   at ${issue.filePath}:${issue.line}`);
      lines.push(`   💡 ${issue.suggestion}`);
      lines.push('');
    }
  }

  return lines.join('\n');
};

export const renderErrorChannelJson = (analysis: ErrorChannelAnalysis, pretty = true): string =>
  JSON.stringify(analysis, null, pretty ? 2 : 0);
