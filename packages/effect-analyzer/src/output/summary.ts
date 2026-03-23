/**
 * Summary Output Module
 *
 * Produces ultra-compact one-liner-per-program output for quick overview
 * of Effect program characteristics.
 */

import type { StaticEffectIR } from '../types';
import { calculateComplexity } from '../complexity';

// =============================================================================
// Source Kind Abbreviations
// =============================================================================

const SOURCE_ABBREVIATIONS: Record<StaticEffectIR['root']['source'], string> = {
  generator: 'gen',
  direct: 'direct',
  pipe: 'pipe',
  run: 'run',
  'workflow-execute': 'wf-exec',
  class: 'class',
  classProperty: 'classProp',
  classMethod: 'classMeth',
  functionDeclaration: 'fnDecl',
};

function abbreviateSource(source: StaticEffectIR['root']['source']): string {
  return SOURCE_ABBREVIATIONS[source];
}

// =============================================================================
// Single Program Summary
// =============================================================================

/**
 * Render a one-line summary for a single Effect program IR.
 *
 * Format:
 *   programName | gen | 6 steps | 2 services | 0 errors | 1 handler | complexity: 2
 */
export function renderSummary(ir: StaticEffectIR): string {
  const name = ir.root.programName;
  const kind = abbreviateSource(ir.root.source);
  const steps = ir.metadata.stats.totalEffects;
  const services = ir.root.dependencies.length;
  const errors = ir.root.errorTypes.length;
  const handlers = ir.metadata.stats.errorHandlerCount;
  const complexity = calculateComplexity(ir).cyclomaticComplexity;

  return [
    name,
    kind,
    `${steps} steps`,
    `${services} services`,
    `${errors} errors`,
    `${handlers} ${handlers === 1 ? 'handler' : 'handlers'}`,
    `complexity: ${complexity}`,
  ].join(' | ');
}

// =============================================================================
// Multiple Program Summary Table
// =============================================================================

interface SummaryRow {
  readonly program: string;
  readonly kind: string;
  readonly steps: number;
  readonly services: number;
  readonly errors: number;
  readonly handlers: number;
  readonly complexity: number;
}

function extractRow(ir: StaticEffectIR): SummaryRow {
  return {
    program: ir.root.programName,
    kind: abbreviateSource(ir.root.source),
    steps: ir.metadata.stats.totalEffects,
    services: ir.root.dependencies.length,
    errors: ir.root.errorTypes.length,
    handlers: ir.metadata.stats.errorHandlerCount,
    complexity: calculateComplexity(ir).cyclomaticComplexity,
  };
}

/**
 * Render a formatted, column-aligned table summarizing multiple Effect program IRs.
 *
 * Example output:
 *   Program          | Kind | Steps | Services | Errors | Handlers | Complexity
 *   -----------------+------+-------+----------+--------+----------+-----------
 *   serviceProgram   | gen  |     6 |        2 |      0 |        0 |          2
 *   databaseProgram  | gen  |     5 |        2 |      1 |        1 |          3
 */
export function renderMultipleSummaries(irs: readonly StaticEffectIR[]): string {
  if (irs.length === 0) {
    return '(no programs)';
  }

  const rows = irs.map(extractRow);

  // Header labels
  const headers = {
    program: 'Program',
    kind: 'Kind',
    steps: 'Steps',
    services: 'Services',
    errors: 'Errors',
    handlers: 'Handlers',
    complexity: 'Complexity',
  };

  // Calculate column widths: max of header width and all row values
  const widths = {
    program: Math.max(headers.program.length, ...rows.map((r) => r.program.length)),
    kind: Math.max(headers.kind.length, ...rows.map((r) => r.kind.length)),
    steps: Math.max(headers.steps.length, ...rows.map((r) => String(r.steps).length)),
    services: Math.max(headers.services.length, ...rows.map((r) => String(r.services).length)),
    errors: Math.max(headers.errors.length, ...rows.map((r) => String(r.errors).length)),
    handlers: Math.max(headers.handlers.length, ...rows.map((r) => String(r.handlers).length)),
    complexity: Math.max(headers.complexity.length, ...rows.map((r) => String(r.complexity).length)),
  };

  const padRight = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  const padLeft = (s: string, w: number) => ' '.repeat(Math.max(0, w - s.length)) + s;

  // Header line
  const headerLine = [
    padRight(headers.program, widths.program),
    padRight(headers.kind, widths.kind),
    padRight(headers.steps, widths.steps),
    padRight(headers.services, widths.services),
    padRight(headers.errors, widths.errors),
    padRight(headers.handlers, widths.handlers),
    padRight(headers.complexity, widths.complexity),
  ].join(' | ');

  // Separator line
  const separatorLine = [
    '-'.repeat(widths.program),
    '-'.repeat(widths.kind),
    '-'.repeat(widths.steps),
    '-'.repeat(widths.services),
    '-'.repeat(widths.errors),
    '-'.repeat(widths.handlers),
    '-'.repeat(widths.complexity),
  ].join('-+-');

  // Data rows: program left-aligned, numeric columns right-aligned
  const dataLines = rows.map((row) =>
    [
      padRight(row.program, widths.program),
      padRight(row.kind, widths.kind),
      padLeft(String(row.steps), widths.steps),
      padLeft(String(row.services), widths.services),
      padLeft(String(row.errors), widths.errors),
      padLeft(String(row.handlers), widths.handlers),
      padLeft(String(row.complexity), widths.complexity),
    ].join(' | '),
  );

  return [headerLine, separatorLine, ...dataLines].join('\n');
}
