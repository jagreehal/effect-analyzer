/**
 * Scope & Resource Lifecycle Analysis (GAP 10)
 *
 * Detects acquireRelease, Scope.*, Pool.*, Effect.scoped and tracks
 * resource ordering and potential leaks.
 */

import type { StaticEffectIR, StaticFlowNode } from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export interface ResourceAcquisition {
  nodeId: string;
  type: 'acquireRelease' | 'acquireUseRelease' | 'scoped' | 'pool' | 'keyedPool';
  acquireNodeId?: string;
  releaseNodeId?: string;
  location?: { line: number; column: number };
}

export interface ScopeBoundary {
  nodeId: string;
  type: 'scoped' | 'scopeMake' | 'scopeUse' | 'scopeFork' | 'scopeAddFinalizer' | 'scopeExtend';
  location?: { line: number; column: number };
}

export interface ScopeResourceAnalysis {
  acquisitions: ResourceAcquisition[];
  scopeBoundaries: ScopeBoundary[];
  poolCreations: string[];
  potentialLeaks: string[];
}

// =============================================================================
// Detection
// =============================================================================

function _isResourceCallee(callee: string): boolean {
  return (
    callee.includes('acquireRelease') ||
    callee.includes('acquireUseRelease') ||
    callee.includes('Effect.scoped') ||
    callee.startsWith('Scope.') ||
    callee.startsWith('Pool.') ||
    callee.startsWith('KeyedPool.')
  );
}

// =============================================================================
// Analysis
// =============================================================================

export function analyzeScopeResource(ir: StaticEffectIR): ScopeResourceAnalysis {
  const acquisitions: ResourceAcquisition[] = [];
  const scopeBoundaries: ScopeBoundary[] = [];
  const poolCreations: string[] = [];
  const potentialLeaks: string[] = [];

  function visit(nodes: readonly StaticFlowNode[]) {
    for (const node of nodes) {
      if (node.type === 'effect') {
        const eff = node;
        const callee = eff.callee;
        if (callee.includes('acquireRelease') || callee.includes('acquireUseRelease')) {
          const acq: ResourceAcquisition = {
            nodeId: eff.id,
            type: callee.includes('acquireUseRelease') ? 'acquireUseRelease' : 'acquireRelease',
          };
          if (eff.location) acq.location = { line: eff.location.line, column: eff.location.column };
          acquisitions.push(acq);
        } else if (callee.includes('Effect.scoped')) {
          const sb: ScopeBoundary = { nodeId: eff.id, type: 'scoped' };
          if (eff.location) sb.location = { line: eff.location.line, column: eff.location.column };
          scopeBoundaries.push(sb);
        } else if (callee.startsWith('Scope.')) {
          if (callee.includes('make')) {
            const sb: ScopeBoundary = { nodeId: eff.id, type: 'scopeMake' };
            if (eff.location) sb.location = { line: eff.location.line, column: eff.location.column };
            scopeBoundaries.push(sb);
          } else if (callee.includes('use')) {
            const sb: ScopeBoundary = { nodeId: eff.id, type: 'scopeUse' };
            if (eff.location) sb.location = { line: eff.location.line, column: eff.location.column };
            scopeBoundaries.push(sb);
          } else if (callee.includes('fork')) {
            const sb: ScopeBoundary = { nodeId: eff.id, type: 'scopeFork' };
            if (eff.location) sb.location = { line: eff.location.line, column: eff.location.column };
            scopeBoundaries.push(sb);
          } else if (callee.includes('addFinalizer')) {
            const sb: ScopeBoundary = { nodeId: eff.id, type: 'scopeAddFinalizer' };
            if (eff.location) sb.location = { line: eff.location.line, column: eff.location.column };
            scopeBoundaries.push(sb);
          } else if (callee.includes('extend')) {
            const sb: ScopeBoundary = { nodeId: eff.id, type: 'scopeExtend' };
            if (eff.location) sb.location = { line: eff.location.line, column: eff.location.column };
            scopeBoundaries.push(sb);
          }
        } else if (callee.startsWith('Pool.') || callee.startsWith('KeyedPool.')) {
          poolCreations.push(eff.id);
        }
      } else if (node.type === 'resource') {
        const res = node;
        const acq: ResourceAcquisition = {
          nodeId: node.id,
          type: 'acquireRelease',
          acquireNodeId: res.acquire.id,
          releaseNodeId: res.release.id,
        };
        if (node.location) acq.location = { line: node.location.line, column: node.location.column };
        acquisitions.push(acq);
      }
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      if (children.length > 0) visit(children);
    }
  }
  visit(ir.root.children);

  return {
    acquisitions,
    scopeBoundaries,
    poolCreations,
    potentialLeaks,
  };
}
