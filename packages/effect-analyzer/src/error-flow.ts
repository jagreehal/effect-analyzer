/**
 * Error Flow Analysis for Effect IR
 *
 * Aggregates error types from effect nodes (typeSignature.errorType) and
 * error-handler nodes (catchTag, etc.) to build an error propagation view.
 */

import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticCauseNode,
} from './types';
import { getStaticChildren } from './types';
import { splitTopLevelUnion } from './type-extractor';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export interface StepErrorInfo {
  stepId: string;
  stepName?: string | undefined;
  errors: string[];
  location?: { line: number; column: number } | undefined;
}

/** Per-node error propagation: errors at this point and how handlers narrow (GAP 4) */
export interface ErrorPropagation {
  atNode: string;
  possibleErrors: string[];
  narrowedBy?: {
    handler: string;
    removedErrors: string[];
    addedErrors: string[];
  };
  defects: string[];
  interruptible: boolean;
}

export interface ErrorPropagationAnalysis {
  propagation: ErrorPropagation[];
  byNodeId: Map<string, ErrorPropagation>;
}

export interface ErrorFlowAnalysis {
  allErrors: string[];
  stepErrors: StepErrorInfo[];
  errorToSteps: Map<string, string[]>;
  stepsWithoutErrors: string[];
  allStepsDeclareErrors: boolean;
}

export interface ErrorFlowEdge {
  stepId: string;
  error: string;
}

export interface ErrorValidation {
  valid: boolean;
  unusedDeclared: string[];
  undeclaredErrors: string[];
  computedErrors: string[];
}

// =============================================================================
// Helpers: parse error type string (e.g. "A | B" or "never")
// =============================================================================

function parseErrorTypes(errorType: string): string[] {
  const t = errorType.trim();
  if (t === 'never' || t === 'unknown') {
    return [];
  }
  return splitTopLevelUnion(t);
}

// =============================================================================
// Collection
// =============================================================================

function collectEffectErrors(
  nodes: readonly StaticFlowNode[],
  result: StepErrorInfo[],
): void {
  for (const node of nodes) {
    if (node.type === 'effect') {
      const eff = node;
      const errors = eff.typeSignature?.errorType
        ? parseErrorTypes(eff.typeSignature.errorType)
        : [];
      result.push({
        stepId: eff.id,
        stepName: eff.callee,
        errors,
        location: eff.location
          ? { line: eff.location.line, column: eff.location.column }
          : undefined,
      });
    }

    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectEffectErrors(children, result);
    }
  }
}

// =============================================================================
// Analysis
// =============================================================================

export function analyzeErrorFlow(ir: StaticEffectIR): ErrorFlowAnalysis {
  const stepErrors: StepErrorInfo[] = [];
  const allErrorsSet = new Set<string>();
  const errorToSteps = new Map<string, string[]>();
  const stepsWithoutErrors: string[] = [];

  collectEffectErrors(ir.root.children, stepErrors);

  for (const step of stepErrors) {
    if (step.errors.length === 0) {
      stepsWithoutErrors.push(step.stepId);
    }
    for (const error of step.errors) {
      allErrorsSet.add(error);
      const steps = errorToSteps.get(error) ?? [];
      steps.push(step.stepId);
      errorToSteps.set(error, steps);
    }
  }

  return {
    allErrors: Array.from(allErrorsSet).sort(),
    stepErrors,
    errorToSteps,
    stepsWithoutErrors,
    allStepsDeclareErrors:
      stepsWithoutErrors.length === 0 && stepErrors.length > 0,
  };
}

// =============================================================================
// Error Propagation & Narrowing (GAP 4)
// =============================================================================

function unionErrors(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b])).sort();
}

function withoutErrors(current: string[], removed: string[]): string[] {
  const set = new Set(removed);
  return current.filter((e) => !set.has(e));
}

/** Collect error types from a subtree (effect nodes only). */
function collectErrorsFromSubtree(node: StaticFlowNode): string[] {
  const out: string[] = [];
  const visit = (n: StaticFlowNode) => {
    if (n.type === 'effect') {
      const err = (n).typeSignature?.errorType;
      if (err) out.push(...parseErrorTypes(err));
    }
    const children = Option.getOrElse(getStaticChildren(n), () => []);
    children.forEach(visit);
  };
  visit(node);
  return unionErrors([], out);
}

/** Find the causeKind of the first cause node in a subtree (for cause-aware mapped-error placeholders). */
function findCauseKindInSubtree(node: StaticFlowNode): StaticCauseNode['causeKind'] | undefined {
  if (node.type === 'cause') return (node).causeKind;
  const children = Option.getOrElse(getStaticChildren(node), () => []);
  for (const child of children) {
    const result = findCauseKindInSubtree(child);
    if (result) return result;
  }
  return undefined;
}

/**
 * Walk IR in execution order, propagating error types and applying narrowing at handlers.
 */
function walkPropagation(
  nodes: readonly StaticFlowNode[],
  errorsIn: string[],
  result: ErrorPropagation[],
): string[] {
  let current = [...errorsIn];
  for (const node of nodes) {
    if (node.type === 'effect') {
      const eff = node;
      const own = eff.typeSignature?.errorType
        ? parseErrorTypes(eff.typeSignature.errorType)
        : [];
      current = unionErrors(current, own);
      result.push({
        atNode: eff.id,
        possibleErrors: [...current],
        defects: [],
        interruptible: false,
      });
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      if (children.length > 0) {
        current = walkPropagation(children, current, result);
      }
    } else if (node.type === 'error-handler') {
      const handler = node;
      current = walkPropagation([handler.source], current, result);
      const sourceErrors = [...current];
      const removed: string[] = [];
      if (handler.handlerType === 'catchTag' && handler.errorTag) {
        removed.push(handler.errorTag);
      } else if (handler.handlerType === 'catchTags') {
        // Object-form catchTags: use extracted tag keys if available, otherwise
        // fall back to heuristic (names ending in Error or starting with uppercase).
        if (handler.errorTags && handler.errorTags.length > 0) {
          removed.push(
            ...sourceErrors.filter((e) =>
              handler.errorTags ? handler.errorTags.includes(e) : false,
            ),
          );
        } else {
          removed.push(...sourceErrors.filter((e) => /Error$|^[A-Z]/.test(e)));
        }
      } else if (
        handler.handlerType === 'catchIf' ||
        handler.handlerType === 'catchSome' ||
        handler.handlerType === 'catchSomeCause' ||
        handler.handlerType === 'catchSomeDefect'
      ) {
        // Predicate/selective catches remove a subset we cannot fully infer.
        removed.push(...sourceErrors.slice(0, Math.ceil(sourceErrors.length / 2)));
      } else if (
        handler.handlerType === 'catchAll' ||
        handler.handlerType === 'catchAllCause' ||
        handler.handlerType === 'catchAllDefect' ||
        handler.handlerType === 'orElse' ||
        handler.handlerType === 'orDie' ||
        handler.handlerType === 'orDieWith'
      ) {
        removed.push(...sourceErrors);
      } else if (
        handler.handlerType === 'mapError' ||
        handler.handlerType === 'mapErrorCause' ||
        handler.handlerType === 'mapBoth'
      ) {
        // Error type is transformed — remove original errors, add a placeholder
        // since we can't statically determine the mapped-to type without full inference.
        removed.push(...sourceErrors);
      } else if (
        handler.handlerType === 'sandbox'
      ) {
        // sandbox wraps error + defects into Cause — remove typed errors (they become Cause)
        removed.push(...sourceErrors);
      } else if (
        handler.handlerType === 'ignore' ||
        handler.handlerType === 'ignoreLogged'
      ) {
        // ignore silences all errors
        removed.push(...sourceErrors);
      } else if (
        handler.handlerType === 'orElseFail' ||
        handler.handlerType === 'orElseSucceed'
      ) {
        // orElseFail replaces all errors with a new error; orElseSucceed silences them
        removed.push(...sourceErrors);
      } else if (
        handler.handlerType === 'filterOrDie' ||
        handler.handlerType === 'filterOrDieMessage'
      ) {
        // filter predicates that fail convert to defects — remove typed errors
        removed.push(...sourceErrors);
      }
      const afterNarrow = withoutErrors(current, removed);
      let handlerErrors = handler.handler
        ? collectErrorsFromSubtree(handler.handler)
        : [];
      // For mapping transforms: errors are replaced, not eliminated — mark as transformed.
      // When the source includes a cause node with a known causeKind, use a more specific placeholder.
      if (
        (handler.handlerType === 'mapError' ||
          handler.handlerType === 'mapErrorCause' ||
          handler.handlerType === 'mapBoth') &&
        removed.length > 0 &&
        handlerErrors.length === 0
      ) {
        const causeKind = findCauseKindInSubtree(handler.source);
        if (causeKind === 'fail') handlerErrors = ['<mapped-fail>'];
        else if (causeKind === 'die') handlerErrors = ['<mapped-defect>'];
        else handlerErrors = ['<mapped-error>'];
      }
      current = unionErrors(afterNarrow, handlerErrors);
      result.push({
        atNode: handler.id,
        possibleErrors: [...current],
        narrowedBy: {
          handler: handler.handlerType,
          removedErrors: removed,
          addedErrors: handlerErrors,
        },
        defects: [],
        interruptible: false,
      });
      if (handler.handler) {
        current = walkPropagation([handler.handler], current, result);
      }
    } else if (node.type === 'parallel' || node.type === 'race') {
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      let branchErrors: string[] = [];
      for (const child of children) {
        const fromChild = walkPropagation([child], current, result);
        branchErrors = unionErrors(branchErrors, fromChild);
      }
      current = branchErrors;
    } else {
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      if (children.length > 0) {
        current = walkPropagation(children, current, result);
      }
    }
  }
  return current;
}

export function analyzeErrorPropagation(ir: StaticEffectIR): ErrorPropagationAnalysis {
  const propagation: ErrorPropagation[] = [];
  walkPropagation(ir.root.children, [], propagation);
  const byNodeId = new Map<string, ErrorPropagation>();
  for (const p of propagation) {
    byNodeId.set(p.atNode, p);
  }
  return { propagation, byNodeId };
}

// =============================================================================
// Error Propagation
// =============================================================================

export function getErrorsAtPoint(
  analysis: ErrorFlowAnalysis,
  afterStepId: string,
): string[] {
  const errors = new Set<string>();
  let found = false;

  for (const step of analysis.stepErrors) {
    for (const error of step.errors) {
      errors.add(error);
    }
    if (step.stepId === afterStepId) {
      found = true;
      break;
    }
  }

  if (!found) {
    return analysis.allErrors;
  }
  return Array.from(errors).sort();
}

export function getErrorProducers(
  analysis: ErrorFlowAnalysis,
  errorTag: string,
): StepErrorInfo[] {
  const stepIds = analysis.errorToSteps.get(errorTag) ?? [];
  return analysis.stepErrors.filter((s) => stepIds.includes(s.stepId));
}

// =============================================================================
// Validation
// =============================================================================

export function validateWorkflowErrors(
  analysis: ErrorFlowAnalysis,
  declaredErrors: string[],
): ErrorValidation {
  const declaredSet = new Set(declaredErrors);
  const computedSet = new Set(analysis.allErrors);

  const unusedDeclared = declaredErrors.filter((e) => !computedSet.has(e));
  const undeclaredErrors = analysis.allErrors.filter((e) => !declaredSet.has(e));

  return {
    valid:
      unusedDeclared.length === 0 && undeclaredErrors.length === 0,
    unusedDeclared,
    undeclaredErrors,
    computedErrors: analysis.allErrors,
  };
}

// =============================================================================
// Rendering
// =============================================================================

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function renderErrorFlowMermaid(analysis: ErrorFlowAnalysis): string {
  const lines: string[] = [];

  lines.push('flowchart LR');
  lines.push('');
  lines.push('  %% Error Flow Graph');
  lines.push('');

  lines.push('  subgraph Steps');
  for (const step of analysis.stepErrors) {
    const label = step.stepName ?? step.stepId;
    lines.push(`    ${sanitizeId(step.stepId)}["${label}"]`);
  }
  lines.push('  end');
  lines.push('');

  if (analysis.allErrors.length > 0) {
    lines.push('  subgraph Errors');
    for (const error of analysis.allErrors) {
      lines.push(`    err_${sanitizeId(error)}(["${error}"])`);
    }
    lines.push('  end');
    lines.push('');

    for (const step of analysis.stepErrors) {
      for (const error of step.errors) {
        lines.push(
          `  ${sanitizeId(step.stepId)} -.->|throws| err_${sanitizeId(error)}`,
        );
      }
    }
  }

  lines.push('');
  lines.push('  classDef error fill:#ffcdd2,stroke:#c62828');
  for (const error of analysis.allErrors) {
    lines.push(`  class err_${sanitizeId(error)} error`);
  }

  if (analysis.stepsWithoutErrors.length > 0) {
    lines.push('');
    lines.push('  classDef noErrors fill:#fff3cd,stroke:#856404');
    for (const stepId of analysis.stepsWithoutErrors) {
      lines.push(`  class ${sanitizeId(stepId)} noErrors`);
    }
  }

  return lines.join('\n');
}

export function formatErrorSummary(analysis: ErrorFlowAnalysis): string {
  const lines: string[] = [];

  lines.push('## Error Flow Summary');
  lines.push('');

  lines.push(`**Total Effects:** ${analysis.stepErrors.length}`);
  lines.push(`**Total Error Types:** ${analysis.allErrors.length}`);
  lines.push(
    `**Effects Without Declared Errors:** ${analysis.stepsWithoutErrors.length}`,
  );
  lines.push('');

  if (analysis.allErrors.length > 0) {
    lines.push('### Error Types');
    lines.push('');
    for (const error of analysis.allErrors) {
      const producers = analysis.errorToSteps.get(error) ?? [];
      lines.push(`- \`${error}\` - produced by: ${producers.join(', ')}`);
    }
    lines.push('');
  }

  if (analysis.stepsWithoutErrors.length > 0) {
    lines.push('### Effects Without Declared Errors');
    lines.push('');
    lines.push(
      'The following effects do not declare their error type (typeSignature.errorType):',
    );
    lines.push('');
    for (const stepId of analysis.stepsWithoutErrors) {
      lines.push(`- ${stepId}`);
    }
    lines.push('');
  }

  lines.push('### Effect Error Details');
  lines.push('');
  lines.push('| Effect | Errors |');
  lines.push('|--------|--------|');
  for (const step of analysis.stepErrors) {
    const name = step.stepName ?? step.stepId;
    const errors =
      step.errors.length > 0
        ? step.errors.map((e) => `\`${e}\``).join(', ')
        : '_none_';
    lines.push(`| ${name} | ${errors} |`);
  }

  return lines.join('\n');
}
