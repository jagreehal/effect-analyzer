/**
 * Dependency Injection Completeness Checker (GAP 27)
 *
 * Verifies that all service requirements are satisfied (layers provide required services).
 */

import type { StaticEffectIR, StaticFlowNode } from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';
import { buildLayerDependencyGraph } from './layer-graph';
import type { ServiceFlowAnalysis } from './service-flow';
import { analyzeServiceFlow } from './service-flow';

// =============================================================================
// Types
// =============================================================================

export interface ServiceCompletenessEntry {
  serviceId: string;
  status: 'ok' | 'missing' | 'missing-dependency';
  providedBy?: string;
  message: string;
}

export interface DICompletenessReport {
  programName: string;
  requiredServices: string[];
  providedByLayer: Map<string, string>;
  entries: ServiceCompletenessEntry[];
  layerGraphAcyclic: boolean;
  valid: boolean;
  readonly layerConflicts?: { serviceId: string; providers: import('./types').SourceLocation[] }[];
}

function detectLayerCycles(layerGraph: ReturnType<typeof buildLayerDependencyGraph>): boolean {
  const adjacency = new Map<string, string[]>();
  const providerByService = new Map<string, string[]>();

  for (const layer of layerGraph.layers) {
    for (const svc of layer.provides) {
      const providers = providerByService.get(svc) ?? [];
      providers.push(layer.id);
      providerByService.set(svc, providers);
    }
  }

  for (const layer of layerGraph.layers) {
    const deps: string[] = [];
    for (const req of layer.requires) {
      for (const provider of providerByService.get(req) ?? []) {
        if (provider !== layer.id) deps.push(provider);
      }
    }
    adjacency.set(layer.id, deps);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const hasCycle = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (hasCycle(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (const layerId of adjacency.keys()) {
    if (hasCycle(layerId)) return false;
  }
  return true;
}

// =============================================================================
// Analysis
// =============================================================================

function _collectLayerProvides(nodes: readonly StaticFlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  function visit(list: readonly StaticFlowNode[]) {
    for (const node of list) {
      if (node.type === 'layer') {
        const layer = node;
        const layerId = layer.id;
        for (const svc of layer.provides ?? []) {
          map.set(svc, layerId);
        }
      }
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      if (children.length > 0) visit(children);
    }
  }
  visit(nodes);
  return map;
}

/**
 * Check DI completeness for a single program IR: required services vs what layers provide.
 */
export function checkDICompleteness(ir: StaticEffectIR): DICompletenessReport {
  const serviceFlow: ServiceFlowAnalysis = analyzeServiceFlow(ir);
  const layerGraph = buildLayerDependencyGraph(ir);
  const providedByLayer = new Map<string, string>();
  for (const layer of layerGraph.layers) {
    for (const svc of layer.provides) {
      providedByLayer.set(svc, layer.id);
    }
  }
  const requiredIds = serviceFlow.requiredServices.map((r) => r.serviceId);
  const entries: ServiceCompletenessEntry[] = [];
  let valid = true;
  for (const serviceId of requiredIds) {
    const provider = providedByLayer.get(serviceId);
    if (provider) {
      entries.push({
        serviceId,
        status: 'ok',
        providedBy: provider,
        message: `provided by ${provider}`,
      });
    } else {
      valid = false;
      entries.push({
        serviceId,
        status: 'missing',
        message: 'NO PROVIDER FOUND',
      });
    }
  }
  const layerGraphAcyclic = detectLayerCycles(layerGraph);

  // Detect layer conflicts: multiple layers providing the same service
  const serviceProviderIds = new Map<string, string[]>();
  for (const layer of layerGraph.layers) {
    for (const svc of layer.provides) {
      const providers = serviceProviderIds.get(svc) ?? [];
      providers.push(layer.id);
      serviceProviderIds.set(svc, providers);
    }
  }
  // Find matching source locations from IR tree
  const layerLocMap = new Map<string, import('./types').SourceLocation>();
  const collectLayerLocations = (nodes: readonly StaticFlowNode[]) => {
    for (const node of nodes) {
      if (node.type === 'layer' && node.location) layerLocMap.set(node.id, node.location);
      const ch = Option.getOrElse(getStaticChildren(node), () => []);
      if (ch.length > 0) collectLayerLocations(ch);
    }
  };
  collectLayerLocations(ir.root.children);
  const layerConflicts: { serviceId: string; providers: import('./types').SourceLocation[] }[] = [];
  for (const [serviceId, providerLayerIds] of serviceProviderIds) {
    if (providerLayerIds.length > 1) {
      const locs = providerLayerIds.map(id => layerLocMap.get(id)).filter((l): l is import('./types').SourceLocation => l !== undefined);
      layerConflicts.push({ serviceId, providers: locs });
    }
  }

  return {
    programName: ir.root.programName,
    requiredServices: requiredIds,
    providedByLayer,
    entries,
    layerGraphAcyclic,
    valid,
    ...(layerConflicts.length > 0 ? { layerConflicts } : {}),
  };
}

/**
 * Format a DI completeness report as text.
 */
export function formatDICompletenessReport(report: DICompletenessReport): string {
  const lines: string[] = [];
  lines.push(`Service Completeness Report for ${report.programName}:`);
  for (const e of report.entries) {
    const icon = e.status === 'ok' ? '✓' : '✗';
    const provider = e.providedBy ? ` → provided by ${e.providedBy}` : '';
    lines.push(`  ${icon} ${e.serviceId}${provider} ${e.status === 'missing' ? e.message : ''}`);
  }
  lines.push('');
  lines.push(report.valid ? 'All required services have providers.' : 'Some required services have no provider.');
  return lines.join('\n');
}
