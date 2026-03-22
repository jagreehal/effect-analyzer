/**
 * Data Flow Analysis for Effect IR
 *
 * Builds a graph of value and service dependencies between effect nodes:
 * - Value flow: sequential edges from one effect to the next in execution order
 * - Service reads: effect nodes that require services from Context
 */

import type { StaticEffectIR, StaticFlowNode, StaticEffectNode } from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export interface DataFlowNode {
  id: string;
  name?: string | undefined;
  /** Success type this effect produces (writes) */
  writes?: string | undefined;
  /** Service IDs this effect reads from Context */
  reads: string[];
  location?: { line: number; column: number } | undefined;
}

export interface DataFlowEdge {
  from: string;
  to: string;
  key: string;
}

export interface DataFlowGraph {
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
  producedKeys: Set<string>;
  undefinedReads: UndefinedRead[];
  duplicateWrites: DuplicateWrite[];
}

export interface UndefinedRead {
  key: string;
  readerId: string;
  readerName?: string | undefined;
}

export interface DuplicateWrite {
  key: string;
  writerIds: string[];
}

// =============================================================================
// Execution-order collection (effect nodes only, sequential flow)
// =============================================================================

function collectEffectNodesInOrder(
  nodes: readonly StaticFlowNode[],
  result: StaticEffectNode[],
): void {
  for (const node of nodes) {
    if (node.type === 'effect') {
      result.push(node);
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectEffectNodesInOrder(children, result);
    }
  }
}

// =============================================================================
// Graph Building
// =============================================================================

export function buildDataFlowGraph(ir: StaticEffectIR): DataFlowGraph {
  const nodes: DataFlowNode[] = [];
  const edges: DataFlowEdge[] = [];
  const producedKeys = new Set<string>();
  const keyProducers = new Map<string, string[]>();
  const effectNodesOrdered: StaticEffectNode[] = [];

  collectEffectNodesInOrder(ir.root.children, effectNodesOrdered);

  for (const eff of effectNodesOrdered) {
    const writes = eff.typeSignature?.successType;
    const reads = (eff.requiredServices ?? []).map((s) => s.serviceId);

    if (writes) {
      producedKeys.add(writes);
      const producers = keyProducers.get(writes) ?? [];
      producers.push(eff.id);
      keyProducers.set(writes, producers);
    }

    nodes.push({
      id: eff.id,
      name: eff.callee,
      writes,
      reads,
      location: eff.location
        ? { line: eff.location.line, column: eff.location.column }
        : undefined,
    });
  }

  // Value-flow edges: consecutive effects in order
  for (let i = 0; i < effectNodesOrdered.length - 1; i++) {
    const from = effectNodesOrdered[i];
    const to = effectNodesOrdered[i + 1];
    if (from === undefined || to === undefined) continue;
    const key = from.typeSignature?.successType ?? 'value';
    edges.push({ from: from.id, to: to.id, key });
  }

  // Context -> effect for each required service (virtual "context" source)
  const contextId = '__context__';
  for (const node of nodes) {
    for (const key of node.reads) {
      edges.push({ from: contextId, to: node.id, key });
    }
  }

  const undefinedReads: UndefinedRead[] = [];
  for (const node of nodes) {
    for (const key of node.reads) {
      if (!producedKeys.has(key) && key !== contextId) {
        undefinedReads.push({
          key,
          readerId: node.id,
          readerName: node.name,
        });
      }
    }
  }

  const duplicateWrites: DuplicateWrite[] = [];
  for (const [key, writers] of keyProducers) {
    if (writers.length > 1) {
      duplicateWrites.push({ key, writerIds: writers });
    }
  }

  return {
    nodes,
    edges,
    producedKeys,
    undefinedReads,
    duplicateWrites,
  };
}

// =============================================================================
// Analysis Utilities
// =============================================================================

export function getDataFlowOrder(
  graph: DataFlowGraph,
): string[] | undefined {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (edge.from === '__context__') continue;
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (id !== '__context__' && degree === 0) {
      queue.push(id);
    }
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    result.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== graph.nodes.length) {
    return undefined;
  }
  return result;
}

export function getProducers(
  graph: DataFlowGraph,
  stepId: string,
): DataFlowNode[] {
  const producerIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.to === stepId && edge.from !== '__context__') {
      producerIds.add(edge.from);
    }
  }
  return graph.nodes.filter((n) => producerIds.has(n.id));
}

export function getConsumers(
  graph: DataFlowGraph,
  stepId: string,
): DataFlowNode[] {
  const consumerIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === stepId) {
      consumerIds.add(edge.to);
    }
  }
  return graph.nodes.filter((n) => consumerIds.has(n.id));
}

export function getTransitiveDependencies(
  graph: DataFlowGraph,
  stepId: string,
): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string): void {
    if (visited.has(id) || id === '__context__') return;
    visited.add(id);
    for (const edge of graph.edges) {
      if (edge.to === id) {
        result.push(edge.from);
        visit(edge.from);
      }
    }
  }

  visit(stepId);
  return result;
}

export function findCycles(graph: DataFlowGraph): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (edge.from === '__context__') continue;
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  function dfs(id: string, path: string[]): void {
    visited.add(id);
    recStack.add(id);
    path.push(id);

    for (const neighbor of adjacency.get(id) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, path);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push(path.slice(cycleStart));
      }
    }

    path.pop();
    recStack.delete(id);
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  return cycles;
}

// =============================================================================
// Validation
// =============================================================================

export interface DataFlowValidation {
  valid: boolean;
  issues: DataFlowIssue[];
}

export interface DataFlowIssue {
  severity: 'error' | 'warning';
  type: 'undefined-read' | 'duplicate-write' | 'cycle';
  message: string;
  stepIds: string[];
  key?: string;
}

export function validateDataFlow(graph: DataFlowGraph): DataFlowValidation {
  const issues: DataFlowIssue[] = [];

  for (const read of graph.undefinedReads) {
    issues.push({
      severity: 'warning',
      type: 'undefined-read',
      message: `Effect "${read.readerName ?? read.readerId}" reads "${read.key}" which is never produced`,
      stepIds: [read.readerId],
      key: read.key,
    });
  }

  for (const write of graph.duplicateWrites) {
    issues.push({
      severity: 'warning',
      type: 'duplicate-write',
      message: `Key "${write.key}" is written by multiple effects: ${write.writerIds.join(', ')}`,
      stepIds: write.writerIds,
      key: write.key,
    });
  }

  const cycles = findCycles(graph);
  for (const cycle of cycles) {
    issues.push({
      severity: 'error',
      type: 'cycle',
      message: `Circular data dependency: ${cycle.join(' -> ')}`,
      stepIds: cycle,
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// =============================================================================
// Rendering
// =============================================================================

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function renderDataFlowMermaid(graph: DataFlowGraph): string {
  const lines: string[] = [];

  lines.push('flowchart LR');
  lines.push('');
  lines.push('  %% Data Flow Graph');
  lines.push('');

  for (const node of graph.nodes) {
    const label = node.name ?? node.id;
    const writes = node.writes ? ` [out: ${node.writes}]` : '';
    lines.push(`  ${sanitizeId(node.id)}["${label}${writes}"]`);
  }

  lines.push('');

  for (const edge of graph.edges) {
    if (edge.from === '__context__') continue;
    lines.push(
      `  ${sanitizeId(edge.from)} -->|${edge.key}| ${sanitizeId(edge.to)}`,
    );
  }

  if (graph.undefinedReads.length > 0) {
    lines.push('');
    lines.push('  %% Undefined Reads (warnings)');
    for (const read of graph.undefinedReads) {
      const warningId = `undefined_${sanitizeId(read.key)}`;
      lines.push(`  ${warningId}[/"${read.key} (undefined)"/]`);
      lines.push(`  ${warningId} -.-> ${sanitizeId(read.readerId)}`);
    }
    lines.push('');
    lines.push('  classDef warning fill:#fff3cd,stroke:#856404');
    for (const read of graph.undefinedReads) {
      lines.push(`  class undefined_${sanitizeId(read.key)} warning`);
    }
  }

  return lines.join('\n');
}
