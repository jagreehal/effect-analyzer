/**
 * Mermaid renderer for the R channel (service/dependency) graph.
 *
 * Two modes:
 * - Single-file: `renderServicesMermaid(ir)` — shows required vs provided services for one program.
 * - Project-wide: `renderServicesMermaidFromMap(serviceMap)` — shows the full service dependency graph.
 */

import type { StaticEffectIR, ProjectServiceMap } from '../types';
import { analyzeServiceFlow } from '../service-flow';

interface ServicesOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

function escapeLabel(text: string): string {
  return text
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\(/g, '#lpar;')
    .replace(/\)/g, '#rpar;');
}

function sanitizeId(text: string): string {
  return text.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Render a Mermaid flowchart showing the R channel for a single IR.
 *
 * - Program node as a rectangle
 * - Required services as blue hexagons with `requires` edges
 * - Provided services as green hexagons with `provides` edges
 */
export function renderServicesMermaid(
  ir: StaticEffectIR,
  options: ServicesOptions = {},
): string {
  const direction = options.direction ?? 'LR';
  const { requiredServices, providedServices } = analyzeServiceFlow(ir);

  // Also collect dependencies from the IR root (includes environment yields)
  const depsFromIR = ir.root.dependencies;
  const allServiceIds = new Set<string>();
  for (const req of requiredServices) allServiceIds.add(req.serviceId);
  for (const dep of depsFromIR) allServiceIds.add(dep.name);

  if (allServiceIds.size === 0 && providedServices.length === 0) {
    return `flowchart ${direction}\n  NoServices((No services))`;
  }

  const lines: string[] = [`flowchart ${direction}`];
  const programName = escapeLabel(ir.root.programName);

  lines.push(`  prog["${programName}"]`);
  lines.push('');

  // Required services — hexagon nodes with requires edges
  // Combine from analyzeServiceFlow and IR root dependencies
  for (const serviceId of allServiceIds) {
    const id = `svc_${sanitizeId(serviceId)}`;
    const label = escapeLabel(serviceId);
    lines.push(`  ${id}{{"${label}"}}`);
    lines.push(`  prog -->|requires| ${id}`);
  }

  // Provided services — hexagon nodes with provides edges
  for (const prov of providedServices) {
    const id = `prov_${sanitizeId(prov.serviceId)}`;
    const label = escapeLabel(prov.serviceId);
    lines.push(`  ${id}{{"${label}"}}`);
    lines.push(`  ${id} -->|provides| prog`);
  }

  lines.push('');

  // Styling
  lines.push('  classDef required fill:#E3F2FD,stroke:#1565C0,stroke-width:2px');
  lines.push('  classDef provided fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px');
  for (const req of requiredServices) {
    lines.push(`  class svc_${sanitizeId(req.serviceId)} required`);
  }
  for (const prov of providedServices) {
    lines.push(`  class prov_${sanitizeId(prov.serviceId)} provided`);
  }

  return lines.join('\n');
}

/**
 * Render a Mermaid flowchart for a project-wide service dependency graph.
 *
 * - Each service is a hexagon node
 * - Edges show layer dependencies
 * - Unresolved services are dashed
 */
export function renderServicesMermaidFromMap(
  serviceMap: ProjectServiceMap,
  options: ServicesOptions = {},
): string {
  const direction = options.direction ?? 'TB';
  const lines: string[] = [`flowchart ${direction}`];
  lines.push('');
  lines.push('  %% Service Dependency Graph');
  lines.push('');

  // Service nodes (hexagon shape)
  for (const [serviceId, artifact] of serviceMap.services) {
    const id = sanitizeId(serviceId);
    const methodCount = artifact.definition.methods.length;
    const label =
      methodCount > 0
        ? `${serviceId}\\n(${methodCount} method${methodCount === 1 ? '' : 's'})`
        : serviceId;
    lines.push(`  ${id}{{"${label}"}}`);
  }

  // Unresolved services (dashed)
  for (const serviceId of serviceMap.unresolvedServices) {
    const id = `unresolved_${sanitizeId(serviceId)}`;
    lines.push(`  ${id}["? ${serviceId}"]`);
  }
  lines.push('');

  // Edges: service requires other services (via layers)
  const edgesAdded = new Set<string>();
  for (const [serviceId, artifact] of serviceMap.services) {
    for (const layer of artifact.layerImplementations) {
      for (const req of layer.requires) {
        const edgeKey = `${serviceId}->${req}`;
        if (edgesAdded.has(edgeKey)) continue;
        edgesAdded.add(edgeKey);

        const fromId = sanitizeId(serviceId);
        const toId = serviceMap.services.has(req)
          ? sanitizeId(req)
          : `unresolved_${sanitizeId(req)}`;
        lines.push(`  ${fromId} -->|"${layer.name}"| ${toId}`);
      }
    }
  }
  lines.push('');

  // Styling
  lines.push('  classDef service fill:#E3F2FD,stroke:#1565C0,stroke-width:2px');
  lines.push('  classDef unresolved fill:#FFF3CD,stroke:#856404,stroke-dasharray:5');
  for (const serviceId of serviceMap.services.keys()) {
    lines.push(`  class ${sanitizeId(serviceId)} service`);
  }
  for (const serviceId of serviceMap.unresolvedServices) {
    lines.push(`  class unresolved_${sanitizeId(serviceId)} unresolved`);
  }

  return lines.join('\n');
}
