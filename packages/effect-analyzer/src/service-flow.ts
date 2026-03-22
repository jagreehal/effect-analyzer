/**
 * Service (R) Flow Analysis (GAP 3)
 *
 * Tracks which services each effect requires, where they are provided,
 * and where R is still unsatisfied.
 */

import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticEffectNode,
  ServiceRequirement,
  SourceLocation,
} from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export interface ServiceProvision {
  nodeId: string;
  serviceId: string;
  location?: SourceLocation;
}

export interface UnsatisfiedService {
  nodeId: string;
  serviceId: string;
  serviceType?: string;
  location?: SourceLocation;
}

export interface ServiceLifecycleEntry {
  createdAt: string;
  consumedAt: string[];
  releasedAt?: string;
}

export interface ServiceFlowAnalysis {
  requiredServices: ServiceRequirement[];
  providedServices: ServiceProvision[];
  unsatisfiedAt: UnsatisfiedService[];
  serviceLifecycle: Map<string, ServiceLifecycleEntry>;
}

// =============================================================================
// Helpers
// =============================================================================

function collectRequiredFromNode(
  node: StaticFlowNode,
  result: ServiceRequirement[],
): void {
  if (node.type === 'effect') {
    const eff = node;
    const reqs = eff.requiredServices ?? [];
    for (const r of reqs) {
      if (!result.some((x) => x.serviceId === r.serviceId)) {
        result.push(r);
      }
    }
  }
  const children = Option.getOrElse(getStaticChildren(node), () => []);
  for (const c of children) collectRequiredFromNode(c, result);
}

/** Heuristic: detect provide/provideService from effect callee and first arg. */
function getProvidedServiceId(
  node: StaticEffectNode,
  getFirstArgText: (node: StaticEffectNode) => string | undefined,
): string | undefined {
  const callee = node.callee;
  if (callee.includes('provideService') || callee.includes('provide')) {
    return getFirstArgText(node);
  }
  return undefined;
}

// =============================================================================
// Analysis
// =============================================================================

/**
 * Build service flow analysis from IR.
 * Tracks required vs provided services and unsatisfied requirements at each node.
 */
export function analyzeServiceFlow(
  ir: StaticEffectIR,
  options?: {
    /** Optional: resolve effect node to its AST to read first arg (for provideService). */
    getFirstArgText?: (effectNode: StaticEffectNode) => string | undefined;
  },
): ServiceFlowAnalysis {
  const requiredServices: ServiceRequirement[] = [];
  for (const child of ir.root.children) {
    collectRequiredFromNode(child, requiredServices);
  }
  const dedupedRequired = Array.from(
    new Map(requiredServices.map((r) => [r.serviceId, r])).values(),
  );

  const providedServices: ServiceProvision[] = [];
  const unsatisfiedAt: UnsatisfiedService[] = [];
  const consumedBy = new Map<string, string[]>();

  const available = new Set<string>();
  const getFirstArg = options?.getFirstArgText;

  function walk(nodes: readonly StaticFlowNode[]) {
    for (const node of nodes) {
      if (node.type === 'effect') {
        const eff = node;
        const providedId = getFirstArg ? getProvidedServiceId(eff, getFirstArg) : undefined;
        if (providedId) {
          available.add(providedId);
          const prov: ServiceProvision = { nodeId: eff.id, serviceId: providedId };
          if (eff.location) prov.location = eff.location;
          providedServices.push(prov);
        }
        const reqs = eff.requiredServices ?? [];
        for (const r of reqs) {
          const list = consumedBy.get(r.serviceId) ?? [];
          list.push(eff.id);
          consumedBy.set(r.serviceId, list);
          if (!available.has(r.serviceId)) {
            const u: UnsatisfiedService = { nodeId: eff.id, serviceId: r.serviceId };
            if (r.serviceType !== undefined) u.serviceType = r.serviceType;
            if (r.requiredAt !== undefined) u.location = r.requiredAt;
            unsatisfiedAt.push(u);
          }
        }
      }
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      if (children.length > 0) walk(children);
    }
  }
  walk(ir.root.children);

  const serviceLifecycle = new Map<string, ServiceLifecycleEntry>();
  for (const p of providedServices) {
    serviceLifecycle.set(p.serviceId, {
      createdAt: p.nodeId,
      consumedAt: consumedBy.get(p.serviceId) ?? [],
    });
  }
  for (const r of dedupedRequired) {
    if (!serviceLifecycle.has(r.serviceId)) {
      serviceLifecycle.set(r.serviceId, {
        createdAt: '',
        consumedAt: consumedBy.get(r.serviceId) ?? [],
      });
    }
  }

  return {
    requiredServices: dedupedRequired,
    providedServices,
    unsatisfiedAt,
    serviceLifecycle,
  };
}
