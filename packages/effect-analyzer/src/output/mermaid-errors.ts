import type { StaticEffectIR } from '../types';
import { analyzeErrorFlow } from '../error-flow';
import { analyzeErrorPropagation, errorDisposition } from '../error-flow';
import type { ErrorDisposition } from '../error-flow';
import { escapeMermaidLabel as escapeLabel } from '../analysis-utils';

// =============================================================================
// Helpers
// =============================================================================

/** Replace non-alphanumeric characters with underscores for Mermaid node IDs. */
function sanitizeId(text: string): string {
  return text.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Strip a trailing "Error"/"Exception" from a type name — unless that is the
 * whole name after a qualifier (`A.Error`), which would leave `A.`.
 */
function stripErrorSuffix(name: string): string {
  return name.replace(/([^.])(Error|Exception)$/, '$1');
}

// =============================================================================
// Options
// =============================================================================

interface MermaidErrorsOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
  /**
   * `'informative'` (default) renders nothing when no handler touches the
   * error channel: every error simply reaches the caller, which the railway
   * diagram already shows per step, in flow order. `'always'` renders it
   * regardless — what an explicit `--format mermaid-errors` asks for.
   */
  readonly when?: 'informative' | 'always';
}

/** Edge label and node fill per disposition. */
const DISPOSITION_STYLE: Record<
  ErrorDisposition,
  { readonly edge: string; readonly className: string }
> = {
  handled: { edge: 'caught by', className: 'handledStyle' },
  transformed: { edge: 'mapped by', className: 'transformedStyle' },
  defect: { edge: 'dies at', className: 'defectStyle' },
  swallowed: { edge: 'swallowed by', className: 'swallowedStyle' },
};

// =============================================================================
// Renderer
// =============================================================================

/**
 * Render a Mermaid flowchart showing what happens to each error in `E`:
 * - Steps (left): which steps produce errors
 * - Error types (middle): the error type nodes
 * - Handlers (right): which handler takes which error, and what it does to it
 * - Channel: errors that reach the caller, still typed — the normal case
 * - Defect / swallowed: errors that left `E` without being dealt with
 *
 * An error reaching the caller is not a fault. `E` is a declared part of the
 * signature, and a caller that must handle `ValidationError` is the library
 * working. What deserves alarm is an error that leaves `E` without being
 * handled — `orDie` turning it into a defect that still kills the fiber, or
 * `ignore` turning a failure into a success.
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

  // Collect handler info from propagation analysis
  const handlerNodes: {
    id: string;
    label: string;
    removedErrors: string[];
    disposition: ErrorDisposition;
  }[] = [];
  const takenErrors = new Set<string>();

  for (const p of propagation.propagation) {
    // Only the errors this diagram draws count: a handler whose removed errors
    // are all outside `allErrors` would render as a box with no edges.
    const taken = p.narrowedBy
      ? p.narrowedBy.removedErrors.filter((e) => errorFlow.allErrors.includes(e))
      : [];
    if (p.narrowedBy && taken.length > 0) {
      const handlerId = `handler_${sanitizeId(p.atNode)}`;
      handlerNodes.push({
        id: handlerId,
        label: p.narrowedBy.handler,
        removedErrors: taken,
        disposition: errorDisposition(p.narrowedBy.handler),
      });
      for (const err of taken) {
        takenErrors.add(err);
      }
    }
  }

  // Nothing touches the channel: every error reaches the caller typed, which
  // the railway diagram already shows per step and in order.
  if (handlerNodes.length === 0 && (options.when ?? 'informative') === 'informative') {
    return `flowchart ${direction}\n  NoHandlers((No handlers - see railway))`;
  }

  const lines: string[] = [`flowchart ${direction}`];

  /** Errors nothing intercepts — they stay in `E` and reach the caller. */
  const channelErrors = errorFlow.allErrors.filter(e => !takenErrors.has(e));

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

  // --- Channel node: errors the caller receives, still typed ---
  if (channelErrors.length > 0) {
    lines.push('');
    lines.push(`  CHANNEL["${escapeLabel('E (reaches caller)')}"]`);
  }

  // --- Edges: step --produces--> error ---
  lines.push('');
  for (const step of stepsWithErrors) {
    for (const error of step.errors) {
      lines.push(`  step_${sanitizeId(step.stepId)} --produces--> err_${sanitizeId(error)}`);
    }
  }

  // --- Edges: error --> handler, labelled with what the handler does to it ---
  for (const handler of handlerNodes) {
    const { edge } = DISPOSITION_STYLE[handler.disposition];
    for (const error of handler.removedErrors) {
      if (errorFlow.allErrors.includes(error)) {
        lines.push(`  err_${sanitizeId(error)} --${edge}--> ${handler.id}`);
      }
    }
  }

  // --- Edges: errors that stay in the channel --> CHANNEL ---
  // Unlabelled: the sink already names the channel, and repeating one word on
  // every edge stacks label boxes that push mermaid into long bowed routes.
  for (const error of channelErrors) {
    lines.push(`  err_${sanitizeId(error)} --> CHANNEL`);
  }

  // --- Styling ---
  lines.push('');
  lines.push('  classDef stepStyle fill:#BBDEFB');
  lines.push('  classDef errorStyle fill:#FFE0B2');
  lines.push('  classDef handledStyle fill:#C8E6C9');
  lines.push('  classDef transformedStyle fill:#E0E0E0');
  lines.push('  classDef channelStyle fill:#E3F2FD,stroke:#1565C0');
  // Red is reserved for an error leaving `E` unhandled, never for one that
  // reaches the caller with its type intact.
  lines.push('  classDef defectStyle fill:#FFCDD2,stroke:#C62828');
  lines.push('  classDef swallowedStyle fill:#FFE082,stroke:#F9A825');

  // Apply styles
  for (const step of stepsWithErrors) {
    lines.push(`  class step_${sanitizeId(step.stepId)} stepStyle`);
  }
  for (const error of errorFlow.allErrors) {
    lines.push(`  class err_${sanitizeId(error)} errorStyle`);
  }
  for (const handler of handlerNodes) {
    lines.push(`  class ${handler.id} ${DISPOSITION_STYLE[handler.disposition].className}`);
  }
  if (channelErrors.length > 0) {
    lines.push('  class CHANNEL channelStyle');
  }

  return lines.join('\n');
}
