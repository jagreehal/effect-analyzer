/**
 * Documentation Generation for Effect IR
 *
 * Generates comprehensive markdown documentation from analyzed Effect programs:
 * workflow steps, service dependencies, complexity metrics, and embedded diagrams.
 */

import type { StaticEffectIR, StaticFlowNode } from '../types';
import { getStaticChildren } from '../types';
import { Option } from 'effect';
import { calculateComplexity } from '../complexity';
import { renderStaticMermaid } from './mermaid';
import { analyzeErrorFlow } from '../error-flow';
import { buildDataFlowGraph } from '../data-flow';
import { DEFAULT_LABEL_MAX, truncateDisplayText } from '../analysis-utils';

// =============================================================================
// Types
// =============================================================================

export interface DocSection {
  title: string;
  content: string;
}

export interface DocumentationOptions {
  /** Include Mermaid diagram in documentation */
  includeDiagram?: boolean | undefined;
  /** Include complexity metrics */
  includeComplexity?: boolean | undefined;
  /** Include service dependency table */
  includeServiceDeps?: boolean | undefined;
  /** Include error type documentation */
  includeErrors?: boolean | undefined;
  /** Include data flow information */
  includeDataFlow?: boolean | undefined;
}

const DEFAULT_DOC_OPTIONS: Required<DocumentationOptions> = {
  includeDiagram: true,
  includeComplexity: true,
  includeServiceDeps: true,
  includeErrors: true,
  includeDataFlow: true,
};

// =============================================================================
// Step Collection
// =============================================================================

interface WorkflowStep {
  name: string;
  type: string;
  description: string;
  depth: number;
}

function collectWorkflowSteps(
  nodes: readonly StaticFlowNode[],
  steps: WorkflowStep[],
  depth: number,
): void {
  for (const node of nodes) {
    const step = describeNode(node, depth);
    if (step) steps.push(step);

    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectWorkflowSteps(children, steps, depth + 1);
    }
  }
}

function describeNode(node: StaticFlowNode, depth: number): WorkflowStep | null {
  switch (node.type) {
    case 'effect':
      return {
        name: truncateDisplayText(node.callee || 'Effect', DEFAULT_LABEL_MAX),
        type: 'effect',
        description: truncateDisplayText(
          node.displayName ?? node.callee,
          DEFAULT_LABEL_MAX,
        ),
        depth,
      };
    case 'error-handler':
      return {
        name: node.handlerType,
        type: 'error-handler',
        description: `Error handler: ${node.handlerType}${node.errorTag ? ` (catches ${node.errorTag})` : ''}`,
        depth,
      };
    case 'parallel':
      return {
        name: node.callee || 'parallel',
        type: 'parallel',
        description: `Parallel execution of ${node.children.length} effects`,
        depth,
      };
    case 'race':
      return {
        name: node.callee || 'race',
        type: 'race',
        description: `Race between ${node.children.length} effects`,
        depth,
      };
    case 'retry':
      return {
        name: 'Retry',
        type: 'retry',
        description: `Retry${node.schedule ? ` with schedule: ${node.schedule}` : ''}`,
        depth,
      };
    case 'timeout':
      return {
        name: 'Timeout',
        type: 'timeout',
        description: `Timeout${node.duration ? ` after ${node.duration}` : ''}`,
        depth,
      };
    case 'resource':
      return {
        name: 'Resource',
        type: 'resource',
        description: 'Acquire/Release resource lifecycle',
        depth,
      };
    case 'conditional':
      return {
        name: node.conditionalType,
        type: 'conditional',
        description: truncateDisplayText(
          `Conditional: ${node.condition}`,
          DEFAULT_LABEL_MAX,
        ),
        depth,
      };
    case 'decision':
      return {
        name: node.label || 'decision',
        type: 'decision',
        description: `Decision: ${node.label || node.condition}`,
        depth,
      };
    case 'loop':
      return {
        name: node.loopType,
        type: 'loop',
        description: truncateDisplayText(
          `Loop: ${node.loopType}${node.iterSource ? ` over ${node.iterSource}` : ''}`,
          DEFAULT_LABEL_MAX,
        ),
        depth,
      };
    case 'layer':
      return {
        name: 'Layer',
        type: 'layer',
        description: `Layer${node.provides?.length ? ` providing: ${node.provides.join(', ')}` : ''}`,
        depth,
      };
    case 'stream':
      return {
        name: 'Stream',
        type: 'stream',
        description: truncateDisplayText(
          `Stream pipeline${node.pipeline.length > 0 ? `: ${node.pipeline.map(p => p.operation).join(' → ')}` : ''}`,
          DEFAULT_LABEL_MAX,
        ),
        depth,
      };
    case 'fiber':
      return {
        name: node.operation,
        type: 'fiber',
        description: `Fiber: ${node.operation}${node.isDaemon ? ' (daemon)' : ''}${node.isScoped ? ' (scoped)' : ''}`,
        depth,
      };
    default:
      return null;
  }
}

// =============================================================================
// Rendering
// =============================================================================

/**
 * Generate comprehensive markdown documentation from an analyzed Effect IR.
 */
export function renderDocumentation(
  ir: StaticEffectIR,
  options?: Partial<DocumentationOptions>,
): string {
  const opts = { ...DEFAULT_DOC_OPTIONS, ...options };
  const sections: string[] = [];

  // Title
  sections.push(`# ${ir.root.programName}`);
  sections.push('');

  // Description
  if (ir.root.jsdocDescription) {
    sections.push(ir.root.jsdocDescription);
    sections.push('');
  }

  // Overview
  sections.push('## Overview');
  sections.push('');
  sections.push(`- **Source**: \`${ir.metadata.filePath}\``);
  sections.push(`- **Entry**: ${ir.root.source}`);
  if (ir.root.typeSignature) {
    const sig = ir.root.typeSignature;
    sections.push(`- **Type**: \`Effect<${sig.successType}, ${sig.errorType}, ${sig.requirementsType}>\``);
  }
  sections.push('');

  // Workflow Steps
  const steps: WorkflowStep[] = [];
  collectWorkflowSteps(ir.root.children, steps, 0);
  if (steps.length > 0) {
    sections.push('## Workflow Steps');
    sections.push('');
    for (const step of steps) {
      const indent = '  '.repeat(step.depth);
      sections.push(`${indent}- **${step.name}** _(${step.type})_: ${step.description}`);
    }
    sections.push('');
  }

  // Service Dependencies
  if (opts.includeServiceDeps && ir.root.dependencies.length > 0) {
    sections.push('## Service Dependencies');
    sections.push('');
    sections.push('| Service | Type | Layer |');
    sections.push('|---------|------|-------|');
    for (const dep of ir.root.dependencies) {
      sections.push(`| ${dep.name} | ${dep.typeSignature ?? '-'} | ${dep.isLayer ? 'Yes' : 'No'} |`);
    }
    sections.push('');
  }

  // Error Types
  if (opts.includeErrors) {
    const errorFlow = analyzeErrorFlow(ir);
    if (errorFlow.allErrors.length > 0) {
      sections.push('## Error Types');
      sections.push('');
      for (const error of errorFlow.allErrors) {
        const producers = errorFlow.errorToSteps.get(error) ?? [];
        sections.push(`- **${error}**: produced by ${producers.length} step(s)`);
      }
      sections.push('');
    }
  }

  // Complexity
  if (opts.includeComplexity) {
    const complexity = calculateComplexity(ir);
    sections.push('## Complexity Metrics');
    sections.push('');
    sections.push(`| Metric | Value |`);
    sections.push(`|--------|-------|`);
    sections.push(`| Cyclomatic Complexity | ${complexity.cyclomaticComplexity} |`);
    sections.push(`| Cognitive Complexity | ${complexity.cognitiveComplexity} |`);
    sections.push(`| Max Depth | ${complexity.maxDepth} |`);
    sections.push(`| Decision Points | ${complexity.decisionPoints} |`);
    sections.push(`| Max Parallel Breadth | ${complexity.maxParallelBreadth} |`);
    sections.push('');
  }

  // Data Flow
  if (opts.includeDataFlow) {
    const dataFlow = buildDataFlowGraph(ir);
    if (dataFlow.undefinedReads.length > 0 || dataFlow.duplicateWrites.length > 0) {
      sections.push('## Data Flow Warnings');
      sections.push('');
      for (const read of dataFlow.undefinedReads) {
        sections.push(`- **Undefined read**: \`${read.key}\` read by ${read.readerName ?? read.readerId}`);
      }
      for (const dup of dataFlow.duplicateWrites) {
        sections.push(`- **Duplicate write**: \`${dup.key}\` written by ${dup.writerIds.join(', ')}`);
      }
      sections.push('');
    }
  }

  // Diagram
  if (opts.includeDiagram) {
    sections.push('## Flow Diagram');
    sections.push('');
    sections.push('```mermaid');
    sections.push(renderStaticMermaid(ir));
    sections.push('```');
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Generate documentation for multiple programs.
 */
export function renderMultiProgramDocs(
  irs: readonly StaticEffectIR[],
  options?: Partial<DocumentationOptions>,
): string {
  const sections: string[] = [];

  sections.push('# Effect Program Documentation');
  sections.push('');
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push('');

  // Table of contents
  sections.push('## Programs');
  sections.push('');
  for (const ir of irs) {
    sections.push(`- [${ir.root.programName}](#${ir.root.programName.toLowerCase().replace(/[^a-z0-9]/g, '-')})`);
  }
  sections.push('');

  // Each program
  for (const ir of irs) {
    sections.push('---');
    sections.push('');
    sections.push(renderDocumentation(ir, options));
    sections.push('');
  }

  return sections.join('\n');
}
