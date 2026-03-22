/**
 * Effect-Specific Linter
 *
 * Detects common issues and anti-patterns in Effect code:
 * - Untagged yields (potential bugs)
 * - Missing error handlers
 * - Unhandled error types
 * - Complex Layer compositions that could be simplified
 * - Dead code (unused yields)
 */

import type { StaticEffectIR, StaticFlowNode, SourceLocation } from './types';
import {
  isStaticGeneratorNode,
  isStaticEffectNode,
  isStaticErrorHandlerNode,
  isStaticParallelNode,
  isStaticPipeNode,
  getStaticChildren,
} from './types';
import { Option } from 'effect';

// =============================================================================
// Lint Rule Types
// =============================================================================

export interface LintRule {
  readonly name: string;
  readonly description: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly check: (ir: StaticEffectIR) => readonly LintIssue[];
}

export interface LintIssue {
  readonly rule: string;
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly location?: SourceLocation | undefined;
  readonly nodeId?: string | undefined;
  /** Human-readable suggestion (shown in diagnostics) */
  readonly suggestion?: string | undefined;
  /** Optional code replacement for quick-fix (must be valid replacement text) */
  readonly fix?: string | undefined;
}

// =============================================================================
// Lint Rules
// =============================================================================

/**
 * Detect untagged yields in Effect.gen
 * A yield without storing the result is often a bug
 */
export const untaggedYieldRule: LintRule = {
  name: 'untagged-yield',
  description: 'Detects yields in Effect.gen that are not assigned to a variable',
  severity: 'warning',
  check: (ir) => {
    const issues: LintIssue[] = [];
    
    const checkNode = (node: StaticFlowNode, _parentId?: string) => {
      if (isStaticGeneratorNode(node)) {
        for (const yield_ of node.yields) {
          // Check if yield has no variable name
          if (!yield_.variableName && yield_.effect.type !== 'unknown') {
            issues.push({
              rule: 'untagged-yield',
              message: `Untagged yield detected: ${isStaticEffectNode(yield_.effect) ? yield_.effect.callee : 'Effect'}`,
              severity: 'warning',
              location: yield_.effect.location,
              nodeId: yield_.effect.id,
              suggestion: 'Assign yield result to a variable or use Effect.tap for side effects',
            });
          }
        }
      }
      
      // Recursively check children
      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) {
          checkNode(child, node.id);
        }
      }
    };
    
    for (const child of ir.root.children) {
      checkNode(child);
    }
    
    return issues;
  },
};

/**
 * Detect missing error handlers on Effects that can fail
 */
export const missingErrorHandlerRule: LintRule = {
  name: 'missing-error-handler',
  description: 'Detects Effect operations that can fail but have no error handling',
  severity: 'error',
  check: (ir) => {
    const issues: LintIssue[] = [];
    
    const checkNode = (node: StaticFlowNode, hasErrorHandler = false) => {
      // Track if this node has error handling
      const currentHasHandler = hasErrorHandler || isStaticErrorHandlerNode(node);
      
      if (isStaticEffectNode(node)) {
        // Check if effect can fail (error type is not 'never')
        const canFail = node.typeSignature && node.typeSignature.errorType !== 'never';
        
        if (canFail && !currentHasHandler) {
          // Check if it's a common error-throwing operation
          const errorProneOps = ['Effect.try', 'Effect.tryPromise', 'Effect.fail', 'Effect.catchAll'];
          const isErrorProne = errorProneOps.some(op => node.callee.includes(op));
          
          if (isErrorProne || node.typeSignature.errorType !== 'unknown') {
            issues.push({
              rule: 'missing-error-handler',
              message: `Effect "${node.callee}" can fail with error type "${node.typeSignature.errorType}" but has no error handler`,
              severity: 'error',
              location: node.location,
              nodeId: node.id,
              suggestion: 'Add .pipe(Effect.catchAll(...)) or handle the error appropriately',
            });
          }
        }
      }
      
      // Recursively check children
      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) {
          checkNode(child, currentHasHandler);
        }
      }
    };
    
    for (const child of ir.root.children) {
      checkNode(child);
    }
    
    return issues;
  },
};

/**
 * Collect identifier-like names that appear in a node subtree (callee or name).
 * Used as a heuristic for "variable is used" in dead-code detection.
 */
function collectUsedNamesInSubtree(node: StaticFlowNode): Set<string> {
  const used = new Set<string>();
  const visit = (n: StaticFlowNode) => {
    if (isStaticEffectNode(n)) {
      const callee = n.callee;
      // Simple identifier: no dots, no parens (e.g. "user" or "validateUser" but not "Effect.succeed")
      if (callee && !/\.|\(/.test(callee) && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callee)) {
        used.add(callee);
      }
      if (n.name) used.add(n.name);
    }
    const childrenOpt = getStaticChildren(n);
    if (Option.isSome(childrenOpt)) {
      for (const c of childrenOpt.value) visit(c);
    }
  };
  visit(node);
  return used;
}

/**
 * Detect dead code - yields whose results are never used in later yields or return
 */
export const deadCodeRule: LintRule = {
  name: 'dead-code',
  description: 'Detects yields whose results are never used',
  severity: 'warning',
  check: (ir) => {
    const issues: LintIssue[] = [];

    const checkNode = (node: StaticFlowNode) => {
      if (isStaticGeneratorNode(node)) {
        const yields = node.yields;
        for (let i = 0; i < yields.length; i++) {
          const yield_ = yields[i];
          if (!yield_) continue;
          const varName = yield_.variableName;
          if (!varName) continue;

          // Collect names used in any later yield or in the return node
          const usedLater = new Set<string>();
          for (let j = i + 1; j < yields.length; j++) {
            const laterYield = yields[j];
            if (!laterYield) continue;
            for (const name of collectUsedNamesInSubtree(laterYield.effect)) {
              usedLater.add(name);
            }
          }
          if (node.returnNode) {
            for (const name of collectUsedNamesInSubtree(node.returnNode)) {
              usedLater.add(name);
            }
          }

          if (!usedLater.has(varName)) {
            issues.push({
              rule: 'dead-code',
              message: `Yield result "${varName}" is never used in later steps or return`,
              severity: 'warning',
              location: yield_.effect.location,
              nodeId: yield_.effect.id,
              suggestion: 'Remove the variable assignment if not needed, or use the result in a subsequent step',
            });
          }
        }
      }

      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) {
          checkNode(child);
        }
      }
    };

    for (const child of ir.root.children) {
      checkNode(child);
    }

    return issues;
  },
};

/**
 * Detect complex Layer compositions that could be simplified
 */
export const complexLayerRule: LintRule = {
  name: 'complex-layer',
  description: 'Detects Layer compositions that might be overly complex',
  severity: 'warning',
  check: (ir) => {
    const issues: LintIssue[] = [];
    
    // Count Layer operations in the program
    let layerCount = 0;
    let layerProvideCount = 0;
    
    const countLayers = (node: StaticFlowNode) => {
      if (isStaticEffectNode(node)) {
        // Check for Layer operations or Effect provide operations
        if (node.callee.includes('Layer.') || node.callee.includes('.provide')) {
          layerCount++;
          if (node.callee.includes('provide') || node.callee.includes('provideService')) {
            layerProvideCount++;
          }
        }
      }
      
      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) {
          countLayers(child);
        }
      }
    };

    for (const child of ir.root.children) {
      countLayers(child);
    }

    // Warn if there are too many layer operations
    if (layerCount > 10) {
      issues.push({
        rule: 'complex-layer',
        message: `Program has ${layerCount} Layer operations, which may be overly complex`,
        severity: 'warning',
        suggestion: 'Consider grouping related services into a single AppLayer, or using Layer.mergeAll for parallel composition',
      });
    }
    
    // Warn about deep Layer.provide chains
    if (layerProvideCount > 5) {
      issues.push({
        rule: 'complex-layer',
        message: `Program has ${layerProvideCount} Layer.provide calls, suggesting deep dependency nesting`,
        severity: 'warning',
        suggestion: 'Consider flattening your Layer hierarchy or using Layer.mergeAll instead of nested provides',
      });
    }
    
    return issues;
  },
};

/**
 * Detect catchAll when catchTag would be more appropriate
 */
export const catchAllVsCatchTagRule: LintRule = {
  name: 'catchAll-vs-catchTag',
  description: 'Suggests using catchTag instead of catchAll when error type is tagged',
  severity: 'info',
  check: (ir) => {
    const issues: LintIssue[] = [];
    
    const checkNode = (node: StaticFlowNode) => {
      if (isStaticErrorHandlerNode(node)) {
        if (node.handlerType === 'catchAll') {
          // Check if source has a tagged error type
          // This is a heuristic - we'd need type info to be certain
          issues.push({
            rule: 'catchAll-vs-catchTag',
            message: 'Using catchAll - consider catchTag if error type has _tag discriminator',
            severity: 'info',
            location: node.location,
            nodeId: node.id,
            suggestion: 'Use Effect.catchTag("ErrorTag", handler) for better type safety',
          });
        }
      }
      
      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) {
          checkNode(child);
        }
      }
    };
    
    for (const child of ir.root.children) {
      checkNode(child);
    }
    
    return issues;
  },
};

// =============================================================================
// Advanced Lint Rules (GAP 26)
// =============================================================================

/** Error channel is unknown or Error instead of tagged errors */
export const errorTypeTooWideRule: LintRule = {
  name: 'error-type-too-wide',
  description: 'Warns when error type is unknown or Error instead of tagged errors',
  severity: 'warning',
  check: (ir) => {
    const issues: LintIssue[] = [];
    const checkNode = (node: StaticFlowNode) => {
      if (isStaticEffectNode(node)) {
        const err = node.typeSignature?.errorType.trim();
        if (err === 'unknown' || err === 'Error') {
          issues.push({
            rule: 'error-type-too-wide',
            message: `Effect "${node.callee}" has wide error type "${err}"`,
            severity: 'warning',
            location: node.location,
            nodeId: node.id,
            suggestion: 'Use branded/tagged errors (e.g. { _tag: "NotFound" }) for better handling',
          });
        }
      }
      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) checkNode(child);
      }
    };
    for (const child of ir.root.children) checkNode(child);
    return issues;
  },
};

/** Effect.all with concurrency "unbounded" on potentially large collections */
export const unboundedParallelismRule: LintRule = {
  name: 'unbounded-parallelism',
  description: 'Warns when Effect.all uses unbounded concurrency',
  severity: 'warning',
  check: (ir) => {
    const issues: LintIssue[] = [];
    const checkNode = (node: StaticFlowNode) => {
      if (isStaticParallelNode(node) && node.concurrency === 'unbounded') {
        issues.push({
          rule: 'unbounded-parallelism',
          message: `Parallel effect uses unbounded concurrency (${node.children.length} branches)`,
          severity: 'warning',
          location: node.location,
          nodeId: node.id,
          suggestion: 'Consider { concurrency: N } to limit parallelism',
        });
      }
      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) checkNode(child);
      }
    };
    for (const child of ir.root.children) checkNode(child);
    return issues;
  },
};

/** .pipe() with only one transformation */
export const redundantPipeRule: LintRule = {
  name: 'redundant-pipe',
  description: 'pipe() with single transformation could be inlined',
  severity: 'info',
  check: (ir) => {
    const issues: LintIssue[] = [];
    const checkNode = (node: StaticFlowNode) => {
      if (isStaticPipeNode(node) && node.transformations.length === 0) {
        issues.push({
          rule: 'redundant-pipe',
          message: 'Pipe has no transformations (only initial effect)',
          severity: 'info',
          location: node.location,
          nodeId: node.id,
          suggestion: 'Use the effect directly or add transformations',
        });
      }
      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) checkNode(child);
      }
    };
    for (const child of ir.root.children) checkNode(child);
    return issues;
  },
};

/** orDie used - may convert recoverable errors to defects */
export const orDieWarningRule: LintRule = {
  name: 'ordie-on-recoverable',
  description: 'orDie converts errors to defects; ensure only used for unrecoverable cases',
  severity: 'info',
  check: (ir) => {
    const issues: LintIssue[] = [];
    const checkNode = (node: StaticFlowNode) => {
      if (isStaticErrorHandlerNode(node) && node.handlerType === 'orDie') {
        issues.push({
          rule: 'ordie-on-recoverable',
          message: 'orDie used - typed errors become defects',
          severity: 'info',
          location: node.location,
          nodeId: node.id,
          suggestion: 'Reserve orDie for truly unrecoverable cases; handle recoverable errors with catchTag/catchAll',
        });
      }
      const childrenOpt = getStaticChildren(node);
      if (Option.isSome(childrenOpt)) {
        for (const child of childrenOpt.value) checkNode(child);
      }
    };
    for (const child of ir.root.children) checkNode(child);
    return issues;
  },
};

// =============================================================================
// Lint Runner
// =============================================================================

export const DEFAULT_LINT_RULES: readonly LintRule[] = [
  untaggedYieldRule,
  missingErrorHandlerRule,
  deadCodeRule,
  complexLayerRule,
  catchAllVsCatchTagRule,
  errorTypeTooWideRule,
  unboundedParallelismRule,
  redundantPipeRule,
  orDieWarningRule,
];

export interface LintResult {
  readonly issues: readonly LintIssue[];
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
    readonly total: number;
  };
}

/**
 * Run all lint rules on an Effect IR
 */
export const lintEffectProgram = (
  ir: StaticEffectIR,
  rules: readonly LintRule[] = DEFAULT_LINT_RULES,
): LintResult => {
  const allIssues: LintIssue[] = [];
  
  for (const rule of rules) {
    const issues = rule.check(ir);
    allIssues.push(...issues);
  }
  
  const errors = allIssues.filter(i => i.severity === 'error').length;
  const warnings = allIssues.filter(i => i.severity === 'warning').length;
  const infos = allIssues.filter(i => i.severity === 'info').length;
  
  return {
    issues: allIssues,
    summary: {
      errors,
      warnings,
      infos,
      total: allIssues.length,
    },
  };
};

/**
 * Format lint issues as a readable report
 */
export const formatLintReport = (result: LintResult, programName: string): string => {
  const lines: string[] = [];
  
  lines.push(`# Lint Report: ${programName}`);
  lines.push('');
  
  // Summary
  lines.push(`## Summary`);
  lines.push(`- **Errors**: ${result.summary.errors}`);
  lines.push(`- **Warnings**: ${result.summary.warnings}`);
  lines.push(`- **Info**: ${result.summary.infos}`);
  lines.push(`- **Total Issues**: ${result.summary.total}`);
  lines.push('');
  
  // Issues by severity
  if (result.issues.length > 0) {
    lines.push(`## Issues`);
    lines.push('');
    
    for (const issue of result.issues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      lines.push(`${icon} **${issue.rule}** (${issue.severity})`);
      lines.push(`   ${issue.message}`);
      
      if (issue.location) {
        lines.push(`   at ${issue.location.filePath}:${issue.location.line}`);
      }
      
      if (issue.suggestion) {
        lines.push(`   💡 ${issue.suggestion}`);
      }
      
      lines.push('');
    }
  } else {
    lines.push('## ✅ No Issues Found');
    lines.push('');
  }
  
  return lines.join('\n');
};
