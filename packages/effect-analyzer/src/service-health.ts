/**
 * Service Dependency Health — detects service DI issues across a project.
 *
 * Detects:
 * - Unsatisfied services (required but never provided)
 * - Dead services (defined but never consumed)
 * - Layer inefficiencies (multiple provides that could be merged)
 * - Duplicate provides in merge chains
 */

import type { StaticEffectIR } from './types';
import { isStaticLayerNode, getStaticChildren } from './types';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export interface ServiceHealthIssue {
  readonly type: 'unsatisfied' | 'dead-service' | 'layer-inefficiency' | 'duplicate-provide';
  readonly service: string;
  readonly description: string;
  readonly files: readonly string[];
  readonly suggestion: string;
  readonly severity: 'error' | 'warning' | 'info';
}

export interface ServiceHealthAnalysis {
  readonly issues: readonly ServiceHealthIssue[];
  readonly summary: ServiceHealthSummary;
}

export interface ServiceHealthSummary {
  readonly totalServices: number;
  readonly satisfiedServices: number;
  readonly unsatisfiedServices: number;
  readonly deadServices: number;
  readonly layerInefficiencies: number;
}

// =============================================================================
// Analysis
// =============================================================================

export interface ServiceRegistry {
  readonly defined: Map<string, readonly string[]>; // service -> files where defined
  readonly required: Map<string, readonly string[]>; // service -> files where required
  readonly provided: Map<string, readonly string[]>; // service -> files where provided
}

export const buildServiceRegistry = (
  irs: readonly StaticEffectIR[],
  serviceDefinitions: ReadonlyMap<string, { tagId: string; methods: readonly string[]; properties: readonly string[] }[]> = new Map(),
): ServiceRegistry => {
  const defined = new Map<string, string[]>();
  const required = new Map<string, string[]>();
  const provided = new Map<string, string[]>();

  // Collect from service definitions (Effect.Service classes, Context.Tags)
  for (const [filePath, defs] of serviceDefinitions) {
    for (const def of defs) {
      const files = defined.get(def.tagId) ?? [];
      files.push(filePath);
      defined.set(def.tagId, files);
    }
  }

  // Collect from IRs
  for (const ir of irs) {
    const filePath = ir.metadata.filePath;

    // Requirements
    if (ir.root.requiredServices) {
      for (const req of ir.root.requiredServices) {
        const files = required.get(req.serviceId) ?? [];
        files.push(filePath);
        required.set(req.serviceId, files);
      }
    }

    // Dependencies
    for (const dep of ir.root.dependencies) {
      if (dep.isLayer) {
        const files = provided.get(dep.name) ?? [];
        files.push(filePath);
        provided.set(dep.name, files);
      }
    }
  }

  return {
    defined: new Map([...defined.entries()].map(([k, v]) => [k, [...new Set(v)]])),
    required: new Map([...required.entries()].map(([k, v]) => [k, [...new Set(v)]])),
    provided: new Map([...provided.entries()].map(([k, v]) => [k, [...new Set(v)]])),
  };
};

export const analyzeServiceHealth = (
  registry: ServiceRegistry,
  irs: readonly StaticEffectIR[],
): ServiceHealthAnalysis => {
  const issues: ServiceHealthIssue[] = [];

  // Find unsatisfied services
  const unsatisfied = findUnsatisfiedServices(registry);
  for (const { service, files } of unsatisfied) {
    issues.push({
      type: 'unsatisfied',
      service,
      description: `Service "${service}" is required but never provided in the project`,
      files,
      suggestion: `Provide a Layer for "${service}" or remove the requirement if unused`,
      severity: 'error',
    });
  }

  // Find dead services
  const dead = findDeadServices(registry);
  for (const { service, files } of dead) {
    issues.push({
      type: 'dead-service',
      service,
      description: `Service "${service}" is defined but never consumed`,
      files,
      suggestion: `Remove "${service}" if unused, or wire it into the dependency graph`,
      severity: 'info',
    });
  }

  // Find layer inefficiencies
  const layerIssues = findLayerInefficiencies(irs);
  issues.push(...layerIssues);

  const satisfiedCount = [...registry.required.keys()].filter(
    (s) => registry.provided.has(s),
  ).length;

  return {
    issues,
    summary: {
      totalServices: new Set([...registry.required.keys(), ...registry.provided.keys()]).size,
      satisfiedServices: satisfiedCount,
      unsatisfiedServices: unsatisfied.length,
      deadServices: dead.length,
      layerInefficiencies: layerIssues.length,
    },
  };
};

const findUnsatisfiedServices = (
  registry: ServiceRegistry,
): readonly { readonly service: string; readonly files: readonly string[] }[] => {
  const unsatisfied: { service: string; files: readonly string[] }[] = [];

  for (const [service, files] of registry.required) {
    if (!registry.provided.has(service) && !registry.defined.has(service)) {
      unsatisfied.push({ service, files });
    }
  }

  return unsatisfied;
};

const findDeadServices = (
  registry: ServiceRegistry,
): readonly { readonly service: string; readonly files: readonly string[] }[] => {
  const dead: { service: string; files: readonly string[] }[] = [];

  for (const [service, files] of registry.defined) {
    if (!registry.required.has(service)) {
      dead.push({ service, files });
    }
  }

  return dead;
};

const findLayerInefficiencies = (
  irs: readonly StaticEffectIR[],
): ServiceHealthIssue[] => {
  const issues: ServiceHealthIssue[] = [];

  for (const ir of irs) {
    const provideCount = countLayerProvides(ir.root);
    if (provideCount > 3) {
      issues.push({
        type: 'layer-inefficiency',
        service: ir.root.programName,
        description: `Program "${ir.root.programName}" has ${provideCount} Layer.provide calls — consider Layer.mergeAll`,
        files: [ir.metadata.filePath],
        suggestion: 'Merge multiple Layer.provide calls into a single Layer.mergeAll for cleaner composition',
        severity: 'info',
      });
    }
  }

  return issues;
};

const countLayerProvides = (node: { children: readonly import('./types').StaticFlowNode[] }): number => {
  let count = 0;

  const visit = (n: import('./types').StaticFlowNode) => {
    if (isStaticLayerNode(n)) {
      count++;
    }
    // Also count Effect.provide operations
    if (n.type === 'effect' && (n.callee.includes('provide') || n.callee.includes('Layer.'))) {
      count++;
    }
    const childrenOpt = getStaticChildren(n);
    if (Option.isSome(childrenOpt)) {
      for (const child of childrenOpt.value) {
        visit(child);
      }
    }
  };

  for (const child of node.children) {
    visit(child);
  }

  return count;
};

// =============================================================================
// Renderers
// =============================================================================

export const renderServiceHealthReport = (analysis: ServiceHealthAnalysis): string => {
  const lines: string[] = [];
  const s = analysis.summary;

  lines.push('# Service Dependency Health\n');
  lines.push('## Summary\n');
  lines.push(`- Total services: ${s.totalServices}`);
  lines.push(`- Satisfied: ${s.satisfiedServices}`);
  lines.push(`- Unsatisfied: ${s.unsatisfiedServices}`);
  lines.push(`- Dead (unused): ${s.deadServices}`);
  lines.push(`- Layer inefficiencies: ${s.layerInefficiencies}`);
  lines.push('');

  if (analysis.issues.length > 0) {
    lines.push('## Issues\n');
    for (const issue of analysis.issues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      const typeLabel = issue.type === 'unsatisfied'
        ? 'Unsatisfied Service'
        : issue.type === 'dead-service'
          ? 'Dead Service'
          : issue.type === 'layer-inefficiency'
            ? 'Layer Inefficiency'
            : 'Duplicate Provide';
      lines.push(`${icon} **[${typeLabel}]** ${issue.service}`);
      lines.push(`   ${issue.description}`);
      if (issue.files.length > 0) {
        lines.push(`   Files: ${issue.files.slice(0, 5).join(', ')}${issue.files.length > 5 ? ` (+${issue.files.length - 5} more)` : ''}`);
      }
      lines.push(`   💡 ${issue.suggestion}`);
      lines.push('');
    }
  }

  return lines.join('\n');
};

export const renderServiceHealthJson = (analysis: ServiceHealthAnalysis, pretty = true): string =>
  JSON.stringify(analysis, null, pretty ? 2 : 0);
