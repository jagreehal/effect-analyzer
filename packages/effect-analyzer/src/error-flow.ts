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
  StaticErrorHandlerNode,
} from './types';
import { getStaticChildren } from './types';
import { splitTopLevelUnion } from './type-extractor';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

/**
 * What a handler does to the errors it takes off the channel. `catchTag` and
 * `orDie` both make `E` smaller, but one recovers from the error and the other
 * turns it into a defect that still crashes the fiber behind an `E` of `never`.
 */
export type ErrorDisposition =
  /** Dealt with — the error is recovered from. */
  | 'handled'
  /** Still in `E`, under a different type (mapError, orElseFail, sandbox). */
  | 'transformed'
  /** Left `E` as a defect — `E` says `never`, the fiber can still die. */
  | 'defect'
  /** Silently became a success (ignore, orElseSucceed). */
  | 'swallowed';

/**
 * Which of the incoming errors a handler takes. `'none'` covers the `filter*`
 * operators: they test the success value, so they add to `E` (or add a defect)
 * without removing anything — `filterOrFail` is `Effect<A, E, R> => Effect<B, E2 | E, R>`.
 */
type HandlerScope = 'all' | 'tags' | 'partial' | 'none';

interface HandlerEntry {
  readonly disposition: ErrorDisposition;
  readonly scope: HandlerScope;
  /** For operators that always take one known error, whatever `E` holds. */
  readonly tags?: readonly string[];
}

const HANDLER_TABLE: Record<StaticErrorHandlerNode['handlerType'], HandlerEntry> = {
  catch: { disposition: 'handled', scope: 'all' },
  catchCause: { disposition: 'handled', scope: 'all' },
  catchDefect: { disposition: 'handled', scope: 'all' },
  catchEager: { disposition: 'handled', scope: 'all' },
  catchTag: { disposition: 'handled', scope: 'tags' },
  catchTags: { disposition: 'handled', scope: 'tags' },
  catchIf: { disposition: 'handled', scope: 'partial' },
  catchSome: { disposition: 'handled', scope: 'partial' },
  catchSomeCause: { disposition: 'handled', scope: 'partial' },
  catchSomeDefect: { disposition: 'handled', scope: 'partial' },
  catchFilter: { disposition: 'handled', scope: 'partial' },
  catchCauseIf: { disposition: 'handled', scope: 'partial' },
  catchCauseFilter: { disposition: 'handled', scope: 'partial' },
  catchReason: { disposition: 'handled', scope: 'partial' },
  catchReasons: { disposition: 'handled', scope: 'partial' },
  // Exclude<E, Cause.NoSuchElementError> — one named error, never a share of
  // whatever else `E` happens to hold. (Effect 3 spells it NoSuchElementException.)
  catchNoSuchElement: {
    disposition: 'handled',
    scope: 'tags',
    tags: ['NoSuchElementError', 'NoSuchElementException'],
  },
  orElse: { disposition: 'handled', scope: 'all' },
  filterOrElse: { disposition: 'handled', scope: 'none' },
  firstSuccessOf: { disposition: 'handled', scope: 'all' },
  match: { disposition: 'handled', scope: 'all' },
  matchCause: { disposition: 'handled', scope: 'all' },
  matchEffect: { disposition: 'handled', scope: 'all' },
  matchCauseEffect: { disposition: 'handled', scope: 'all' },
  eventually: { disposition: 'handled', scope: 'all' },
  mapError: { disposition: 'transformed', scope: 'all' },
  mapErrorCause: { disposition: 'transformed', scope: 'all' },
  mapBoth: { disposition: 'transformed', scope: 'all' },
  orElseFail: { disposition: 'transformed', scope: 'all' },
  filterOrFail: { disposition: 'transformed', scope: 'none' },
  sandbox: { disposition: 'transformed', scope: 'all' },
  unsandbox: { disposition: 'transformed', scope: 'all' },
  parallelErrors: { disposition: 'transformed', scope: 'all' },
  flip: { disposition: 'transformed', scope: 'all' },
  orDie: { disposition: 'defect', scope: 'all' },
  orDieWith: { disposition: 'defect', scope: 'all' },
  filterOrDie: { disposition: 'defect', scope: 'none' },
  filterOrDieMessage: { disposition: 'defect', scope: 'none' },
  ignore: { disposition: 'swallowed', scope: 'all' },
  ignoreLogged: { disposition: 'swallowed', scope: 'all' },
  orElseSucceed: { disposition: 'swallowed', scope: 'all' },
};

/** What this handler does to the errors it removes from the channel. */
export const errorDisposition = (
  handlerType: StaticErrorHandlerNode['handlerType'],
): ErrorDisposition => lookupHandler(handlerType)?.disposition ?? 'handled';

/** IR can arrive from JSON, so a handler type this build does not know is possible. */
const lookupHandler = (
  handlerType: StaticErrorHandlerNode['handlerType'],
): HandlerEntry | undefined =>
  (HANDLER_TABLE as Partial<Record<string, HandlerEntry>>)[handlerType];

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
    handler: StaticErrorHandlerNode['handlerType'];
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
  /**
   * Every error type raised somewhere in the body, not the declared error
   * channel of the program's signature. A step that raises `SchemaError` and
   * maps it to `ValidationError` before returning is reported as `SchemaError`;
   * for the channel, use `analyzeErrorChannels`.
   */
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

/**
 * Does a handler's tag name this error? Tags are bare (`'NoSuchElementError'`,
 * a `catchTag` literal); the checker may print the error qualified
 * (`Cause.NoSuchElementError` — a namespace member, `import * as`, Effect 3's
 * `declare namespace Cause`). Compare with the qualifier dropped, but keep the
 * qualified name as the error's identity everywhere else: `A.Error` and
 * `B.Error` are two errors, not one.
 */
const matchesTag = (error: string, tag: string): boolean =>
  error === tag ||
  error.replace(/^(?:[A-Za-z_$][\w$]*\.)+(?=[A-Za-z_$])/, '') === tag;

const matchingAny = (errors: readonly string[], tags: readonly string[]): string[] =>
  errors.filter((e) => tags.some((tag) => matchesTag(e, tag)));

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
      const entry = lookupHandler(handler.handlerType);
      const scope = entry?.scope ?? 'all';
      const fixedTags = entry?.tags;
      if (scope === 'tags') {
        if (handler.handlerType === 'catchTag' && handler.errorTag) {
          // Remove the error under the spelling it is carried in; fall back to
          // the bare tag when the source's errors could not be resolved at all.
          const matched = matchingAny(sourceErrors, [handler.errorTag]);
          removed.push(...(matched.length > 0 ? matched : [handler.errorTag]));
        } else if (handler.errorTags && handler.errorTags.length > 0) {
          removed.push(...matchingAny(sourceErrors, handler.errorTags));
        } else if (fixedTags) {
          removed.push(...matchingAny(sourceErrors, fixedTags));
        } else if (handler.handlerType === 'catchTags') {
          // Object-form catchTags without extracted keys: fall back to the
          // heuristic that error-like names are the ones being caught.
          removed.push(...sourceErrors.filter((e) => /Error$|^[A-Z]/.test(e)));
        }
        // A catchTag whose tag is not a literal removes nothing rather than guessing.
      } else if (scope === 'partial') {
        // Predicate/reason catches remove a subset we cannot infer.
        removed.push(...sourceErrors.slice(0, Math.ceil(sourceErrors.length / 2)));
      } else if (scope !== 'none') {
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
