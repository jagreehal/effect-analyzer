import type { StaticEffectIR } from '../types';
import { analyzeErrorFlow } from '../error-flow';
import { analyzeErrorPropagation } from '../error-flow';

// =============================================================================
// Helpers
// =============================================================================

/** Escape characters that break Mermaid label syntax. */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\(/g, '#lpar;')
    .replace(/\)/g, '#rpar;');
}

/** Replace non-alphanumeric characters with underscores for Mermaid node IDs. */
function sanitizeId(text: string): string {
  return text.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** Strip trailing "Error" or "Exception" suffix from a type name. */
function stripErrorSuffix(name: string): string {
  return name.replace(/(Error|Exception)$/, '');
}

// =============================================================================
// Options
// =============================================================================

interface MermaidErrorsOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

// =============================================================================
// Renderer
// =============================================================================

/**
 * Render a Mermaid flowchart showing error propagation:
 * - Steps (left): which steps produce errors
 * - Error types (middle): the error type nodes
 * - Handlers (right): which handlers catch which errors
 * - Unhandled: errors that are never caught
 */
export function renderErrorsMermaid(
  ir: StaticEffectIR,
  options: MermaidErrorsOptions = {},
): string {
  const direction = options.direction ?? 'LR';
  const errorFlow = analyzeErrorFlow(ir);
  const propagation = analyzeErrorPropagation(ir);

  // No errors at all → simple empty output
  if (errorFlow.allErrors.length === 0) {
    return `flowchart ${direction}\n  NoErrors((No errors))`;
  }

  const lines: string[] = [`flowchart ${direction}`];

  // Collect handler info from propagation analysis
  const handlerNodes: { id: string; label: string; removedErrors: string[] }[] = [];
  const handledErrors = new Set<string>();

  for (const p of propagation.propagation) {
    if (p.narrowedBy && p.narrowedBy.removedErrors.length > 0) {
      const handlerId = `handler_${sanitizeId(p.atNode)}`;
      handlerNodes.push({
        id: handlerId,
        label: p.narrowedBy.handler,
        removedErrors: p.narrowedBy.removedErrors,
      });
      for (const err of p.narrowedBy.removedErrors) {
        handledErrors.add(err);
      }
    }
  }

  // Determine unhandled errors
  const unhandledErrors = errorFlow.allErrors.filter(e => !handledErrors.has(e));

  // --- Steps subgraph (left column) ---
  const stepsWithErrors = errorFlow.stepErrors.filter(s => s.errors.length > 0);
  if (stepsWithErrors.length > 0) {
    lines.push('');
    lines.push('  subgraph Steps');
    for (const step of stepsWithErrors) {
      const label = escapeLabel(step.stepName ?? step.stepId);
      lines.push(`    step_${sanitizeId(step.stepId)}["${label}"]`);
    }
    lines.push('  end');
  }

  // --- Error types subgraph (middle column) ---
  lines.push('');
  lines.push('  subgraph Errors');
  for (const error of errorFlow.allErrors) {
    const label = escapeLabel(stripErrorSuffix(error));
    lines.push(`    err_${sanitizeId(error)}("${label}")`);
  }
  lines.push('  end');

  // --- Handlers subgraph (right column) ---
  if (handlerNodes.length > 0) {
    lines.push('');
    lines.push('  subgraph Handlers');
    for (const handler of handlerNodes) {
      const label = escapeLabel(handler.label);
      lines.push(`    ${handler.id}["${label}"]`);
    }
    lines.push('  end');
  }

  // --- Unhandled node ---
  if (unhandledErrors.length > 0) {
    lines.push('');
    lines.push('  UNHANDLED["UNHANDLED"]');
  }

  // --- Edges: step --produces--> error ---
  lines.push('');
  for (const step of stepsWithErrors) {
    for (const error of step.errors) {
      lines.push(`  step_${sanitizeId(step.stepId)} --produces--> err_${sanitizeId(error)}`);
    }
  }

  // --- Edges: error --caught by--> handler ---
  for (const handler of handlerNodes) {
    for (const error of handler.removedErrors) {
      if (errorFlow.allErrors.includes(error)) {
        lines.push(`  err_${sanitizeId(error)} --caught by--> ${handler.id}`);
      }
    }
  }

  // --- Edges: unhandled errors --> UNHANDLED ---
  for (const error of unhandledErrors) {
    lines.push(`  err_${sanitizeId(error)} --unhandled--> UNHANDLED`);
  }

  // --- Styling ---
  lines.push('');
  lines.push('  classDef stepStyle fill:#BBDEFB');
  lines.push('  classDef errorStyle fill:#FFE0B2');
  lines.push('  classDef handlerStyle fill:#C8E6C9');
  lines.push('  classDef unhandledStyle fill:#FFCDD2');

  // Apply styles
  for (const step of stepsWithErrors) {
    lines.push(`  class step_${sanitizeId(step.stepId)} stepStyle`);
  }
  for (const error of errorFlow.allErrors) {
    lines.push(`  class err_${sanitizeId(error)} errorStyle`);
  }
  for (const handler of handlerNodes) {
    lines.push(`  class ${handler.id} handlerStyle`);
  }
  if (unhandledErrors.length > 0) {
    lines.push('  class UNHANDLED unhandledStyle');
  }

  return lines.join('\n');
}
