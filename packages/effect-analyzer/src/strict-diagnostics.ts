/**
 * Strict Mode Diagnostics for Effect IR
 *
 * Validates Effect programs against strict rules: error type declarations,
 * parallel/race error handling, and optional labelling.
 */

import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticEffectNode,
  SourceLocation,
} from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';
import { buildLayerDependencyGraph } from './layer-graph';

// =============================================================================
// Types
// =============================================================================

export interface StrictDiagnostic {
  rule: StrictRule;
  severity: 'error' | 'warning';
  message: string;
  fix?: string | undefined;
  location?: SourceLocation | undefined;
  nodeId?: string | undefined;
}

export type StrictRule =
  | 'missing-error-type'
  | 'unknown-error-type'
  | 'parallel-missing-errors'
  | 'race-missing-errors'
  | 'effect-without-handler'
  | 'fiber-potential-leak'
  | 'resource-missing-scope'
  | 'unbounded-concurrency'
  | 'unused-service'
  | 'dead-code-path';

export interface StrictValidationResult {
  valid: boolean;
  diagnostics: StrictDiagnostic[];
  errors: StrictDiagnostic[];
  warnings: StrictDiagnostic[];
}

export interface StrictValidationOptions {
  /** Require effect nodes to have a declared error type (not unknown/never when they can fail) */
  requireErrors?: boolean | undefined;
  /** Require effects in parallel/race to have error type */
  requireParallelErrors?: boolean | undefined;
  warningsAsErrors?: boolean | undefined;
}

const DEFAULT_OPTIONS: Required<
  Omit<StrictValidationOptions, 'warningsAsErrors'>
> & { warningsAsErrors: boolean } = {
  requireErrors: true,
  requireParallelErrors: true,
  warningsAsErrors: false,
};

// =============================================================================
// Validation
// =============================================================================

export function validateStrict(
  ir: StaticEffectIR,
  options: StrictValidationOptions = {},
): StrictValidationResult {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    requireErrors: options.requireErrors ?? true,
    requireParallelErrors: options.requireParallelErrors ?? true,
    warningsAsErrors: options.warningsAsErrors ?? false,
  };
  const diagnostics: StrictDiagnostic[] = [];

  validateNodes(ir.root.children, opts, diagnostics, false);

  // Extended validators (Phase 9)
  validateFiberLeaks(ir.root.children, diagnostics, new Set());
  validateResourceScopes(ir.root.children, diagnostics, false);
  validateConcurrencyBounds(ir.root.children, diagnostics);
  validateDeadCodePaths(ir.root.children, diagnostics);
  validateUnusedServices(ir, diagnostics);

  const errors = diagnostics.filter(
    (d) =>
      d.severity === 'error' ||
      (opts.warningsAsErrors && d.severity === 'warning'),
  );
  const warnings = diagnostics.filter(
    (d) => d.severity === 'warning' && !opts.warningsAsErrors,
  );

  return {
    valid: errors.length === 0,
    diagnostics,
    errors,
    warnings,
  };
}

function validateNodes(
  nodes: readonly StaticFlowNode[],
  opts: typeof DEFAULT_OPTIONS,
  diagnostics: StrictDiagnostic[],
  hasAncestorErrorHandler = false,
): void {
  for (const node of nodes) {
    const currentHasErrorHandler =
      hasAncestorErrorHandler || node.type === 'error-handler';

    if (node.type === 'effect') {
      const eff = node;
      validateEffectNode(eff, opts, diagnostics);
      // effect-without-handler: effect can fail but no handler on path from root
      const errorType = eff.typeSignature?.errorType?.trim();
      const canFail = errorType && errorType !== 'never';
      if (canFail && !hasAncestorErrorHandler) {
        diagnostics.push({
          rule: 'effect-without-handler',
          severity: 'warning',
          message: `Effect "${eff.callee}" can fail with "${errorType}" but has no error handler (catchAll/catchTag/orElse) on this path`,
          fix: 'Wrap in .pipe(Effect.catchAll(...)) or handle errors before this point',
          location: eff.location,
          nodeId: eff.id,
        });
      }
    }
    if (node.type === 'parallel' && opts.requireParallelErrors) {
      for (const child of node.children) {
        if (child.type === 'effect') {
          const eff = child;
          const errorType = eff.typeSignature?.errorType;
          if (
            !errorType ||
            errorType === 'unknown' ||
            errorType.trim() === ''
          ) {
            diagnostics.push({
              rule: 'parallel-missing-errors',
              severity: 'warning',
              message: `Parallel branch effect "${eff.callee}" does not declare error type`,
              fix: 'Add type signature or use Effect.mapError/catchTag to narrow errors',
              location: eff.location,
              nodeId: eff.id,
            });
          }
        }
      }
    }
    if (node.type === 'race' && opts.requireParallelErrors) {
      for (const child of node.children) {
        if (child.type === 'effect') {
          const eff = child;
          const errorType = eff.typeSignature?.errorType;
          if (
            !errorType ||
            errorType === 'unknown' ||
            errorType.trim() === ''
          ) {
            diagnostics.push({
              rule: 'race-missing-errors',
              severity: 'warning',
              message: `Race branch effect "${eff.callee}" does not declare error type`,
              fix: 'Add type signature or use Effect.mapError/catchTag to narrow errors',
              location: eff.location,
              nodeId: eff.id,
            });
          }
        }
      }
    }

    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      validateNodes(children, opts, diagnostics, currentHasErrorHandler);
    }
  }
}

// =============================================================================
// Extended Rule Validators (Phase 9)
// =============================================================================

/**
 * Detect fiber forks without join/interrupt in scope.
 */
function validateFiberLeaks(
  nodes: readonly StaticFlowNode[],
  diagnostics: StrictDiagnostic[],
  joinPointsInScope: Set<string>,
): void {
  for (const node of nodes) {
    if (node.type === 'fiber') {
      const fiber = node;
      if (
        (fiber.operation === 'fork' || fiber.operation === 'forkAll') &&
        !fiber.isScoped &&
        !fiber.isDaemon
      ) {
        // Check if any join/interrupt exists in scope
        if (!joinPointsInScope.has('join') && !joinPointsInScope.has('interrupt') && !joinPointsInScope.has('await')) {
          diagnostics.push({
            rule: 'fiber-potential-leak',
            severity: 'warning',
            message: `Fiber.${fiber.operation} without join/interrupt in scope — potential fiber leak`,
            fix: 'Use Fiber.join, Fiber.interrupt, or forkScoped instead',
            location: fiber.location,
            nodeId: fiber.id,
          });
        }
      }
      // Track join points for scope
      if (fiber.operation === 'join' || fiber.operation === 'interrupt' || fiber.operation === 'await') {
        joinPointsInScope.add(fiber.operation);
      }
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      validateFiberLeaks(children, diagnostics, joinPointsInScope);
    }
  }
}

/**
 * Detect resource acquisitions without proper scoping.
 */
function validateResourceScopes(
  nodes: readonly StaticFlowNode[],
  diagnostics: StrictDiagnostic[],
  inScope: boolean,
): void {
  for (const node of nodes) {
    if (node.type === 'resource' && !inScope) {
      diagnostics.push({
        rule: 'resource-missing-scope',
        severity: 'warning',
        message: 'acquireRelease without visible Effect.scoped in scope',
        fix: 'Wrap resource usage in Effect.scoped',
        location: node.location,
        nodeId: node.id,
      });
    }

    // Track scope entry
    const isScope = node.type === 'effect' && node.callee === 'Effect.scoped';
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      validateResourceScopes(children, diagnostics, inScope || isScope);
    }
  }
}

/**
 * Detect unbounded concurrency: Effect.all/forEach without concurrency option.
 */
function validateConcurrencyBounds(
  nodes: readonly StaticFlowNode[],
  diagnostics: StrictDiagnostic[],
): void {
  for (const node of nodes) {
    if (node.type === 'parallel' && node.children.length > 5) {
      // Large parallel collections without explicit concurrency control
      const callee = node.callee || '';
      if (callee.includes('all') || callee.includes('forEach')) {
        diagnostics.push({
          rule: 'unbounded-concurrency',
          severity: 'warning',
          message: `${callee} with ${node.children.length} children — consider adding { concurrency } option`,
          fix: 'Add { concurrency: N } to limit concurrent execution',
          location: node.location,
          nodeId: node.id,
        });
      }
    }
    if (node.type === 'loop' && (node.loopType === 'forEach' || node.loopType === 'validate')) {
      // Large collection loops
      diagnostics.push({
        rule: 'unbounded-concurrency',
        severity: 'warning',
        message: `Effect.${node.loopType} may run unbounded — consider concurrency control`,
        fix: 'Add { concurrency: N } option',
        location: node.location,
        nodeId: node.id,
      });
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      validateConcurrencyBounds(children, diagnostics);
    }
  }
}

/**
 * Detect decision branches with const-resolvable conditions that always go one way.
 */
function validateDeadCodePaths(
  nodes: readonly StaticFlowNode[],
  diagnostics: StrictDiagnostic[],
): void {
  for (const node of nodes) {
    if (node.type === 'decision') {
      const label = node.label.trim();
      // If the label resolved to a literal boolean, it's a dead code path
      if (label === 'true' || label === 'false') {
        diagnostics.push({
          rule: 'dead-code-path',
          severity: 'warning',
          message: `Decision "${node.condition}" always resolves to ${label} — ${label === 'true' ? 'false' : 'true'} branch is dead code`,
          fix: 'Remove the dead branch or fix the condition',
          location: node.location,
          nodeId: node.id,
        });
      }
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      validateDeadCodePaths(children, diagnostics);
    }
  }
}

/**
 * Detect services provided by layers but never consumed by any effect.
 */
function validateUnusedServices(
  ir: StaticEffectIR,
  diagnostics: StrictDiagnostic[],
): void {
  const layerGraph = buildLayerDependencyGraph(ir);
  if (layerGraph.layers.length === 0) return;

  // Collect all services that are consumed (required) by any layer
  const consumedServices = new Set<string>();
  for (const layer of layerGraph.layers) {
    for (const req of layer.requires) {
      consumedServices.add(req);
    }
  }

  // Also collect services required by effects in the IR
  collectConsumedServicesFromNodes(ir.root.children, consumedServices);

  // Check which provided services are never consumed
  for (const layer of layerGraph.layers) {
    for (const svc of layer.provides) {
      if (!consumedServices.has(svc)) {
        diagnostics.push({
          rule: 'unused-service',
          severity: 'warning',
          message: `Service "${svc}" is provided by layer "${layer.name ?? layer.id}" but never consumed`,
          fix: 'Remove unused service provision or add a consumer',
          nodeId: layer.id,
        });
      }
    }
  }
}

function collectConsumedServicesFromNodes(
  nodes: readonly StaticFlowNode[],
  consumed: Set<string>,
): void {
  for (const node of nodes) {
    if (node.type === 'effect') {
      const reqs = node.requiredServices ?? [];
      for (const r of reqs) {
        consumed.add(r.serviceId);
      }
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectConsumedServicesFromNodes(children, consumed);
    }
  }
}

function validateEffectNode(
  node: StaticEffectNode,
  opts: typeof DEFAULT_OPTIONS,
  diagnostics: StrictDiagnostic[],
): void {
  if (!opts.requireErrors) return;

  const errorType = node.typeSignature?.errorType;
  if (!errorType) {
    diagnostics.push({
      rule: 'missing-error-type',
      severity: 'warning',
      message: `Effect "${node.callee}" has no extracted error type`,
      fix: 'Ensure type checker can infer Effect<A, E, R> or add explicit type',
      location: node.location,
      nodeId: node.id,
    });
    return;
  }

  const t = errorType.trim();
  if (t === 'unknown') {
    diagnostics.push({
      rule: 'unknown-error-type',
      severity: 'warning',
      message: `Effect "${node.callee}" has error type "unknown"`,
      fix: 'Use a concrete error type or branded errors for better validation',
      location: node.location,
      nodeId: node.id,
    });
  }
}

// =============================================================================
// Formatting
// =============================================================================

export function formatDiagnostics(result: StrictValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push('All strict mode checks passed');
    if (result.warnings.length > 0) {
      lines.push(
        `  (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`,
      );
    }
  } else {
    lines.push(
      `Strict validation failed: ${result.errors.length} error(s)`,
    );
  }

  lines.push('');

  for (const diag of result.diagnostics) {
    const icon = diag.severity === 'error' ? 'x' : '!';
    const loc = diag.location
      ? `:${diag.location.line}:${diag.location.column}`
      : '';
    lines.push(`[${icon}] [${diag.rule}]${loc}`);
    lines.push(`  ${diag.message}`);
    if (diag.fix) {
      lines.push(`  Fix: ${diag.fix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatDiagnosticsJSON(
  result: StrictValidationResult,
): string {
  return JSON.stringify(
    {
      valid: result.valid,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      diagnostics: result.diagnostics.map((d) => ({
        rule: d.rule,
        severity: d.severity,
        message: d.message,
        fix: d.fix,
        location: d.location
          ? {
              line: d.location.line,
              column: d.location.column,
            }
          : undefined,
        nodeId: d.nodeId,
      })),
    },
    null,
    2,
  );
}

export function getSummary(result: StrictValidationResult): string {
  if (result.valid && result.warnings.length === 0) {
    return 'All strict mode checks passed';
  }
  if (result.valid) {
    return `Passed with ${result.warnings.length} warning(s)`;
  }
  return `${result.errors.length} error(s), ${result.warnings.length} warning(s)`;
}
