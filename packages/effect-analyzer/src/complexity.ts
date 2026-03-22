/**
 * Complexity Metrics Calculator
 *
 * Calculates complexity metrics for Effect programs including:
 * - Cyclomatic complexity (McCabe)
 * - Cognitive complexity (Sonar-style)
 * - Path count (bounded or unbounded)
 * - Depth and breadth metrics
 */

import { Option } from 'effect';
import { getStaticChildren } from './types';
import type {
  StaticEffectIR,
  StaticFlowNode,
  ComplexityMetrics,
  ComplexityThresholds,
} from './types';

// =============================================================================
// Default Thresholds
// =============================================================================

export const DEFAULT_THRESHOLDS: ComplexityThresholds = {
  cyclomaticWarning: 10,
  cyclomaticError: 20,
  pathCountWarning: 50,
  maxDepthWarning: 5,
};

// =============================================================================
// Main Calculator
// =============================================================================

export function calculateComplexity(ir: StaticEffectIR): ComplexityMetrics {
  const nodes = ir.root.children;

  const cyclomatic = calculateCyclomaticComplexity(nodes);
  const cognitive = calculateCognitiveComplexity(nodes);
  const pathCount = calculatePathCount(nodes);
  const maxDepth = calculateMaxDepth(nodes);
  const maxParallelBreadth = calculateMaxParallelBreadth(nodes);
  const decisionPoints = countDecisionPoints(nodes);

  return {
    cyclomaticComplexity: cyclomatic,
    cognitiveComplexity: cognitive,
    pathCount,
    maxDepth,
    maxParallelBreadth,
    decisionPoints,
  };
}

// =============================================================================
// Cyclomatic Complexity
// =============================================================================

function calculateCyclomaticComplexity(
  nodes: readonly StaticFlowNode[],
): number {
  let complexity = 1;
  for (const node of nodes) {
    complexity += countDecisionPointsInNode(node);
  }
  return complexity;
}

function countDecisionPointsInNode(node: StaticFlowNode): number {
  const children = getStaticChildren(node);
  const childList = Option.getOrElse(children, () => [] as readonly StaticFlowNode[]);

  let count = 0;

  switch (node.type) {
    case 'conditional':
      count += 1;
      for (const child of childList) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case 'race':
      count += Math.max(0, node.children.length - 1);
      for (const child of node.children) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case 'loop':
      count += 1;
      count += countDecisionPointsInNode(node.body);
      break;

    case 'generator':
    case 'pipe':
    case 'parallel':
    case 'error-handler':
    case 'retry':
    case 'timeout':
    case 'resource':
    case 'layer':
      for (const child of childList) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case 'decision':
      count += 1;
      for (const child of childList) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case 'switch':
      count += Math.max(0, node.cases.length - 1);
      for (const child of childList) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case 'try-catch':
      count += 1;
      for (const child of childList) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case 'terminal':
    case 'opaque':
      for (const child of childList) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case 'match':
      if (node.matchedTags && node.matchedTags.length > 1) {
        count += node.matchedTags.length - 1;
      }
      break;

    case 'interruption':
      if (node.handler) {
        count += 1;
        count += countDecisionPointsInNode(node.handler);
      }
      if (node.source) {
        count += countDecisionPointsInNode(node.source);
      }
      break;

    case 'cause':
      if (node.children) {
        for (const child of node.children) {
          count += countDecisionPointsInNode(child);
        }
      }
      break;

    case 'transform':
      if (node.source) {
        count += countDecisionPointsInNode(node.source);
      }
      break;

    case 'channel':
    case 'sink':
      if (node.source) {
        count += countDecisionPointsInNode(node.source);
      }
      break;

    case 'exit':
    case 'schedule':
    case 'effect':
    case 'unknown':
      break;
  }

  return count;
}

// =============================================================================
// Cognitive Complexity
// =============================================================================

function calculateCognitiveComplexity(
  nodes: readonly StaticFlowNode[],
): number {
  return calculateCognitiveForNodes(nodes, 0);
}

function calculateCognitiveForNodes(
  nodes: readonly StaticFlowNode[],
  nestingDepth: number,
): number {
  let complexity = 0;
  for (const node of nodes) {
    complexity += calculateCognitiveForNode(node, nestingDepth);
  }
  return complexity;
}

function calculateCognitiveForNode(
  node: StaticFlowNode,
  nestingDepth: number,
): number {
  const children = getStaticChildren(node);
  const childList = Option.getOrElse(children, () => [] as readonly StaticFlowNode[]);

  let complexity = 0;

  switch (node.type) {
    case 'conditional':
      complexity += 1 + nestingDepth;
      complexity += calculateCognitiveForNode(node.onTrue, nestingDepth + 1);
      if (node.onFalse) {
        complexity += calculateCognitiveForNode(node.onFalse, nestingDepth + 1);
      }
      break;

    case 'loop':
      complexity += 1 + nestingDepth;
      complexity += calculateCognitiveForNode(node.body, nestingDepth + 1);
      break;

    case 'race':
      complexity += node.children.length;
      for (const child of node.children) {
        complexity += calculateCognitiveForNode(child, nestingDepth + 1);
      }
      break;

    case 'parallel':
      complexity += Math.max(0, node.children.length - 1);
      for (const child of node.children) {
        complexity += calculateCognitiveForNode(child, nestingDepth);
      }
      break;

    case 'generator':
    case 'pipe':
    case 'error-handler':
    case 'retry':
    case 'timeout':
    case 'resource':
    case 'layer':
      for (const child of childList) {
        complexity += calculateCognitiveForNode(child, nestingDepth);
      }
      break;

    case 'decision':
      complexity += 1 + nestingDepth;
      for (const child of node.onTrue) {
        complexity += calculateCognitiveForNode(child, nestingDepth + 1);
      }
      if (node.onFalse) {
        for (const child of node.onFalse) {
          complexity += calculateCognitiveForNode(child, nestingDepth + 1);
        }
      }
      break;

    case 'switch':
      complexity += 1 + nestingDepth;
      for (const caseItem of node.cases) {
        for (const child of caseItem.body) {
          complexity += calculateCognitiveForNode(child, nestingDepth + 1);
        }
      }
      break;

    case 'try-catch':
      complexity += 1 + nestingDepth;
      for (const child of childList) {
        complexity += calculateCognitiveForNode(child, nestingDepth + 1);
      }
      break;

    case 'terminal':
      if (node.value) {
        for (const child of node.value) {
          complexity += calculateCognitiveForNode(child, nestingDepth);
        }
      }
      break;

    case 'opaque':
      break;

    case 'match':
      if (node.matchedTags && node.matchedTags.length > 0) {
        complexity += 1 + nestingDepth;
      }
      break;

    case 'interruption':
      if (node.handler) {
        complexity += 1 + nestingDepth;
        complexity += calculateCognitiveForNode(node.handler, nestingDepth + 1);
      }
      if (node.source) {
        complexity += calculateCognitiveForNode(node.source, nestingDepth);
      }
      break;

    case 'cause':
      if (node.children) {
        for (const child of node.children) {
          complexity += calculateCognitiveForNode(child, nestingDepth);
        }
      }
      break;

    case 'transform':
      if (node.source) {
        complexity += calculateCognitiveForNode(node.source, nestingDepth);
      }
      break;

    case 'channel':
    case 'sink':
      if (node.source) {
        complexity += calculateCognitiveForNode(node.source, nestingDepth);
      }
      break;

    case 'exit':
    case 'schedule':
    case 'effect':
    case 'unknown':
      break;
  }

  return complexity;
}

// =============================================================================
// Path Count
// =============================================================================

function calculatePathCount(
  nodes: readonly StaticFlowNode[],
): number | 'unbounded' {
  let pathCount = 1;
  let hasUnbounded = false;

  for (const node of nodes) {
    const result = pathCountForNode(node);
    if (result === 'unbounded') {
      hasUnbounded = true;
    } else {
      pathCount *= result;
    }
  }

  return hasUnbounded ? 'unbounded' : pathCount;
}

function pathCountForNode(node: StaticFlowNode): number | 'unbounded' {
  const children = getStaticChildren(node);
  const childList = Option.getOrElse(children, () => [] as readonly StaticFlowNode[]);

  switch (node.type) {
    case 'conditional': {
      const truePaths = pathCountForNodes([node.onTrue]);
      const falsePaths = node.onFalse
        ? pathCountForNodes([node.onFalse])
        : 1;
      if (truePaths === 'unbounded' || falsePaths === 'unbounded') {
        return 'unbounded';
      }
      return truePaths + falsePaths;
    }

    case 'race': {
      let total = 0;
      for (const child of node.children) {
        const childPaths = pathCountForNode(child);
        if (childPaths === 'unbounded') return 'unbounded';
        total += childPaths;
      }
      return Math.max(1, total);
    }

    case 'parallel': {
      let product = 1;
      for (const child of node.children) {
        const childPaths = pathCountForNode(child);
        if (childPaths === 'unbounded') return 'unbounded';
        product *= childPaths;
      }
      return product;
    }

    case 'loop':
      return 'unbounded';

    case 'generator':
    case 'pipe':
    case 'error-handler':
    case 'retry':
    case 'timeout':
    case 'resource':
    case 'layer':
      return pathCountForNodes(childList);

    case 'effect':
    case 'unknown':
    case 'opaque':
      return 1;

    case 'decision': {
      const truePaths = pathCountForNodes([...node.onTrue]);
      const falsePaths = node.onFalse
        ? pathCountForNodes([...node.onFalse])
        : 1;
      if (truePaths === 'unbounded' || falsePaths === 'unbounded') {
        return 'unbounded';
      }
      return truePaths + falsePaths;
    }

    case 'switch': {
      let total = 0;
      for (const c of node.cases) {
        const casePaths = pathCountForNodes([...c.body]);
        if (casePaths === 'unbounded') return 'unbounded';
        total += casePaths;
      }
      return Math.max(1, total);
    }

    case 'try-catch':
    case 'terminal':
    case 'stream':
    case 'concurrency-primitive':
    case 'fiber':
    case 'interruption':
    case 'transform':
    case 'match':
    case 'cause':
    case 'exit':
    case 'schedule':
    case 'channel':
    case 'sink':
      return pathCountForNodes(childList);
  }
}

function pathCountForNodes(
  nodes: readonly StaticFlowNode[],
): number | 'unbounded' {
  let product = 1;
  for (const node of nodes) {
    const paths = pathCountForNode(node);
    if (paths === 'unbounded') return 'unbounded';
    product *= paths;
  }
  return product;
}

// =============================================================================
// Depth
// =============================================================================

function calculateMaxDepth(nodes: readonly StaticFlowNode[]): number {
  let maxDepth = 0;
  for (const node of nodes) {
    maxDepth = Math.max(maxDepth, depthOfNode(node, 0));
  }
  return maxDepth;
}

function depthOfNode(node: StaticFlowNode, currentDepth: number): number {
  const children = getStaticChildren(node);
  const childList = Option.getOrElse(children, () => [] as readonly StaticFlowNode[]);

  let maxChildDepth = currentDepth;

  switch (node.type) {
    case 'conditional':
      maxChildDepth = Math.max(
        maxChildDepth,
        depthOfNode(node.onTrue, currentDepth + 1),
      );
      if (node.onFalse) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(node.onFalse, currentDepth + 1),
        );
      }
      break;

    case 'loop':
      maxChildDepth = Math.max(
        maxChildDepth,
        depthOfNode(node.body, currentDepth + 1),
      );
      break;

    case 'parallel':
    case 'race':
      for (const child of node.children) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(child, currentDepth + 1),
        );
      }
      break;

    case 'generator':
    case 'pipe':
    case 'error-handler':
    case 'retry':
    case 'timeout':
    case 'resource':
    case 'layer':
      for (const child of childList) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(child, currentDepth),
        );
      }
      break;

    case 'decision':
      for (const child of node.onTrue) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(child, currentDepth + 1),
        );
      }
      if (node.onFalse) {
        for (const child of node.onFalse) {
          maxChildDepth = Math.max(
            maxChildDepth,
            depthOfNode(child, currentDepth + 1),
          );
        }
      }
      break;

    case 'switch':
      for (const caseItem of node.cases) {
        for (const child of caseItem.body) {
          maxChildDepth = Math.max(
            maxChildDepth,
            depthOfNode(child, currentDepth + 1),
          );
        }
      }
      break;

    case 'try-catch':
      for (const child of childList) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(child, currentDepth + 1),
        );
      }
      break;

    case 'terminal':
      if (node.value) {
        for (const child of node.value) {
          maxChildDepth = Math.max(
            maxChildDepth,
            depthOfNode(child, currentDepth),
          );
        }
      }
      break;

    case 'opaque':
      break;

    case 'match':
      break;

    case 'interruption':
      if (node.source) {
        maxChildDepth = Math.max(maxChildDepth, depthOfNode(node.source, currentDepth + 1));
      }
      if (node.handler) {
        maxChildDepth = Math.max(maxChildDepth, depthOfNode(node.handler, currentDepth + 1));
      }
      break;

    case 'cause':
      if (node.children) {
        for (const child of node.children) {
          maxChildDepth = Math.max(maxChildDepth, depthOfNode(child, currentDepth));
        }
      }
      break;

    case 'transform':
      if (node.source) {
        maxChildDepth = Math.max(maxChildDepth, depthOfNode(node.source, currentDepth));
      }
      break;

    case 'channel':
    case 'sink':
      if (node.source) {
        maxChildDepth = Math.max(maxChildDepth, depthOfNode(node.source, currentDepth));
      }
      break;

    case 'exit':
    case 'schedule':
    case 'effect':
    case 'unknown':
      break;
  }

  return maxChildDepth;
}

// =============================================================================
// Parallel Breadth
// =============================================================================

function calculateMaxParallelBreadth(
  nodes: readonly StaticFlowNode[],
): number {
  let maxBreadth = 0;
  for (const node of nodes) {
    maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(node));
  }
  return maxBreadth;
}

function parallelBreadthOfNode(node: StaticFlowNode): number {
  const children = getStaticChildren(node);
  const childList = Option.getOrElse(children, () => [] as readonly StaticFlowNode[]);

  let maxBreadth = 0;

  switch (node.type) {
    case 'parallel':
    case 'race':
      maxBreadth = node.children.length;
      for (const child of node.children) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      break;

    case 'conditional':
      maxBreadth = Math.max(
        parallelBreadthOfNode(node.onTrue),
        node.onFalse ? parallelBreadthOfNode(node.onFalse) : 0,
      );
      break;

    case 'loop':
      maxBreadth = parallelBreadthOfNode(node.body);
      break;

    case 'generator':
    case 'pipe':
    case 'error-handler':
    case 'retry':
    case 'timeout':
    case 'resource':
    case 'layer':
      for (const child of childList) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      break;

    case 'decision':
      for (const child of node.onTrue) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      if (node.onFalse) {
        for (const child of node.onFalse) {
          maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
        }
      }
      break;

    case 'switch':
      for (const caseItem of node.cases) {
        for (const child of caseItem.body) {
          maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
        }
      }
      break;

    case 'try-catch':
      for (const child of childList) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      break;

    case 'terminal':
      if (node.value) {
        for (const child of node.value) {
          maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
        }
      }
      break;

    case 'opaque':
      break;

    case 'interruption':
      if (node.source) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(node.source));
      }
      if (node.handler) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(node.handler));
      }
      break;

    case 'cause':
      if (node.children) {
        for (const child of node.children) {
          maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
        }
      }
      break;

    case 'transform':
      if (node.source) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(node.source));
      }
      break;

    case 'channel':
    case 'sink':
      if (node.source) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(node.source));
      }
      break;

    case 'match':
    case 'exit':
    case 'schedule':
    case 'effect':
    case 'unknown':
      break;
  }

  return maxBreadth;
}

// =============================================================================
// Decision Points
// =============================================================================

function countDecisionPoints(nodes: readonly StaticFlowNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += countDecisionPointsInNode(node);
  }
  return count;
}

// =============================================================================
// Assessment
// =============================================================================

export interface ComplexityAssessment {
  level: 'low' | 'medium' | 'high' | 'very-high';
  warnings: ComplexityWarning[];
  recommendations: string[];
}

export interface ComplexityWarning {
  type: 'cyclomatic' | 'cognitive' | 'paths' | 'depth' | 'breadth';
  message: string;
  severity: 'warning' | 'error';
}

export function assessComplexity(
  metrics: ComplexityMetrics,
  thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS,
): ComplexityAssessment {
  const warnings: ComplexityWarning[] = [];
  const recommendations: string[] = [];

  if (metrics.cyclomaticComplexity >= thresholds.cyclomaticError) {
    warnings.push({
      type: 'cyclomatic',
      message: `Cyclomatic complexity (${metrics.cyclomaticComplexity}) exceeds error threshold (${thresholds.cyclomaticError})`,
      severity: 'error',
    });
    recommendations.push(
      'Consider breaking this program into smaller effects',
    );
  } else if (metrics.cyclomaticComplexity >= thresholds.cyclomaticWarning) {
    warnings.push({
      type: 'cyclomatic',
      message: `Cyclomatic complexity (${metrics.cyclomaticComplexity}) exceeds warning threshold (${thresholds.cyclomaticWarning})`,
      severity: 'warning',
    });
    recommendations.push(
      'Consider simplifying conditional logic or extracting sub-effects',
    );
  }

  if (metrics.pathCount === 'unbounded') {
    warnings.push({
      type: 'paths',
      message: 'Program has unbounded paths due to loops',
      severity: 'warning',
    });
    recommendations.push(
      'Ensure loop termination conditions are well-tested',
    );
  } else if (metrics.pathCount >= thresholds.pathCountWarning) {
    warnings.push({
      type: 'paths',
      message: `Path count (${metrics.pathCount}) exceeds threshold (${thresholds.pathCountWarning})`,
      severity: 'warning',
    });
    recommendations.push(
      'High path count makes exhaustive testing difficult - consider simplifying',
    );
  }

  if (metrics.maxDepth >= thresholds.maxDepthWarning) {
    warnings.push({
      type: 'depth',
      message: `Nesting depth (${metrics.maxDepth}) exceeds threshold (${thresholds.maxDepthWarning})`,
      severity: 'warning',
    });
    recommendations.push(
      'Deep nesting reduces readability - consider flattening or extracting',
    );
  }

  let level: ComplexityAssessment['level'] = 'low';
  const hasError = warnings.some((w) => w.severity === 'error');
  const hasWarning = warnings.some((w) => w.severity === 'warning');

  if (hasError) {
    level = 'very-high';
  } else if (hasWarning) {
    level = warnings.length >= 2 ? 'high' : 'medium';
  }

  return {
    level,
    warnings,
    recommendations,
  };
}

// =============================================================================
// Summary
// =============================================================================

export function formatComplexitySummary(
  metrics: ComplexityMetrics,
  assessment: ComplexityAssessment,
): string {
  const lines: string[] = [];

  lines.push('## Effect Program Complexity Report');
  lines.push('');
  lines.push(`**Overall Complexity:** ${assessment.level.toUpperCase()}`);
  lines.push('');
  lines.push('### Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Cyclomatic Complexity | ${metrics.cyclomaticComplexity} |`);
  lines.push(`| Cognitive Complexity | ${metrics.cognitiveComplexity} |`);
  lines.push(`| Unique Paths | ${metrics.pathCount} |`);
  lines.push(`| Max Nesting Depth | ${metrics.maxDepth} |`);
  lines.push(`| Max Parallel Breadth | ${metrics.maxParallelBreadth} |`);
  lines.push(`| Decision Points | ${metrics.decisionPoints} |`);
  lines.push('');

  if (assessment.warnings.length > 0) {
    lines.push('### Warnings');
    lines.push('');
    for (const warning of assessment.warnings) {
      const icon = warning.severity === 'error' ? 'ERROR' : 'WARNING';
      lines.push(`- **${icon}:** ${warning.message}`);
    }
    lines.push('');
  }

  if (assessment.recommendations.length > 0) {
    lines.push('### Recommendations');
    lines.push('');
    for (const rec of assessment.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
