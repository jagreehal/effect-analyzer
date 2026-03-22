import type { StaticEffectIR } from '../types';
import { buildLayerDependencyGraph } from '../layer-graph';

interface LayersOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

/** Sanitize an ID for use as a Mermaid node identifier. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Render a layered architecture Mermaid flowchart from an Effect IR.
 *
 * Shows which layers provide which services and their dependencies.
 * - Layer nodes are rectangles with name and lifecycle info.
 * - Service nodes are hexagons.
 * - Provides edges are solid green arrows.
 * - Requires edges are dashed blue arrows.
 * - Merge edges are gray arrows.
 */
export function renderLayersMermaid(
  ir: StaticEffectIR,
  options: LayersOptions = {},
): string {
  const direction = options.direction ?? 'TB';
  const graph = buildLayerDependencyGraph(ir);

  if (graph.layers.length === 0) {
    return `flowchart ${direction}\n  NoLayers((No layers))`;
  }

  const lines: string[] = [`flowchart ${direction}`];

  // Collect all unique services
  const allServices = new Set<string>();
  for (const layer of graph.layers) {
    for (const svc of layer.provides) allServices.add(svc);
    for (const req of layer.requires) allServices.add(req);
  }

  // Track merged layers for styling
  const mergedLayerIds = new Set<string>();

  // Layer nodes: rectangles with label
  for (const layer of graph.layers) {
    const label = layer.name ?? layer.id;
    const lifecycle = layer.lifecycle !== 'default' ? ` (${layer.lifecycle})` : '';
    const nodeId = sanitizeId(layer.id);
    lines.push(`  ${nodeId}["${label}${lifecycle}"]`);
    if (layer.isMerged) mergedLayerIds.add(nodeId);
  }

  // Service nodes: hexagons
  for (const svc of allServices) {
    lines.push(`  ${sanitizeId(svc)}{{"${svc}"}}`);
  }

  // Edges
  for (const edge of graph.edges) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);
    if (edge.kind === 'provides') {
      lines.push(`  ${from} -->|provides| ${to}`);
    } else if (edge.kind === 'requires') {
      lines.push(`  ${from} -.->|requires| ${to}`);
    } else {
      lines.push(`  ${from} -->|merge| ${to}`);
    }
  }

  // Styling
  lines.push('');
  lines.push('  classDef layerStyle fill:#E8EAF6,stroke:#3F51B5');
  lines.push('  classDef serviceStyle fill:#E3F2FD,stroke:#1E88E5');
  lines.push('  classDef mergedStyle fill:#F3E5F5,stroke:#8E24AA');

  // Apply layer styles
  for (const layer of graph.layers) {
    const nodeId = sanitizeId(layer.id);
    if (mergedLayerIds.has(nodeId)) {
      lines.push(`  class ${nodeId} mergedStyle`);
    } else {
      lines.push(`  class ${nodeId} layerStyle`);
    }
  }

  // Apply service styles
  for (const svc of allServices) {
    lines.push(`  class ${sanitizeId(svc)} serviceStyle`);
  }

  return lines.join('\n');
}
