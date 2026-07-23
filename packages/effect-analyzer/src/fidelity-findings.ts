/** Located facts used to assess source representation and runtime joinability. */

import type { SourceLocation, StaticEffectIR, StaticFlowNode } from './types';
import { indexIR, runtimeSpanName } from './ir';

export type FidelityFindingKind =
  | 'unknown-node'
  | 'opaque-node'
  | 'dynamic-span-name'
  | 'duplicate-span-path';

export interface FidelityFinding {
  readonly kind: FidelityFindingKind;
  readonly nodeId: string;
  readonly message: string;
  readonly suggestion: string;
  readonly reason?: string | undefined;
  readonly location?: SourceLocation | undefined;
}

export interface FidelityDimension {
  readonly exact: boolean;
  readonly resolved: number;
  readonly total: number;
  readonly rate: number;
}

export interface IRFidelityAssessment {
  readonly exact: boolean;
  readonly score: number;
  readonly sourceRepresentation: FidelityDimension;
  readonly runtimeJoinability: FidelityDimension;
  readonly staticOnlyNodes: number;
  readonly findings: readonly FidelityFinding[];
}

const findingForNode = (node: StaticFlowNode): FidelityFinding | undefined => {
  if (node.type === 'unknown') {
    return {
      kind: 'unknown-node',
      nodeId: node.id,
      message: `The analyzer could not resolve this expression: ${node.reason}`,
      suggestion: 'Use a supported Effect v4 construct or extract the expression into a named Effect.fn operation.',
      reason: node.reason,
      location: node.location,
    };
  }
  if (node.type === 'opaque') {
    return {
      kind: 'opaque-node',
      nodeId: node.id,
      message: `The analyzer intentionally treats this source as opaque: ${node.reason}`,
      suggestion: 'Extract diagram-relevant work into a named Effect.fn operation or an explicit Effect.withSpan region.',
      reason: node.reason,
      location: node.location,
    };
  }
  if (
    node.spanNameDynamic === true ||
    (node.type === 'effect' &&
      node.callee.includes('withSpan') &&
      runtimeSpanName(node) === undefined)
  ) {
    return {
      kind: 'dynamic-span-name',
      nodeId: node.id,
      message: 'The runtime span name is computed, so a trace cannot be joined to this static node exactly.',
      suggestion: 'Use a literal Effect.withSpan name and put dynamic values in span attributes.',
      location: node.location,
    };
  }
  return undefined;
};

const rate = (resolved: number, total: number): number =>
  total === 0 ? 1 : resolved / total;

export const assessIRFidelity = (ir: StaticEffectIR): IRFidelityAssessment => {
  const index = indexIR(ir);
  const findings: FidelityFinding[] = [];
  const sourceUnresolvedIds = new Set<string>();
  const runtimeInexactIds = new Set<string>();
  const runtimeNodeIds = new Set(index.spanPathById.keys());

  for (const node of index.nodes) {
    const finding = findingForNode(node);
    if (!finding) continue;
    findings.push(finding);
    if (finding.kind === 'unknown-node' || finding.kind === 'opaque-node') {
      sourceUnresolvedIds.add(node.id);
    }
    if (finding.kind === 'dynamic-span-name') {
      runtimeNodeIds.add(node.id);
      runtimeInexactIds.add(node.id);
    }
  }

  for (const [spanPath, ids] of index.idsBySpanPath) {
    if (ids.length < 2) continue;
    const printablePath = spanPath.split('\u001f').join(' > ');
    for (const nodeId of ids) {
      runtimeInexactIds.add(nodeId);
      const node = index.byId.get(nodeId);
      findings.push({
        kind: 'duplicate-span-path',
        nodeId,
        message: `Multiple static nodes emit the runtime span path "${printablePath}".`,
        suggestion: 'Give sibling Effect.withSpan or Effect.fn regions distinct literal names.',
        location: node?.location,
      });
    }
  }

  for (const nodeId of sourceUnresolvedIds) {
    if (runtimeNodeIds.has(nodeId)) runtimeInexactIds.add(nodeId);
  }

  const sourceResolved = index.nodes.length - sourceUnresolvedIds.size;
  const runtimeResolved = runtimeNodeIds.size - runtimeInexactIds.size;
  const penalizedIds = new Set([...sourceUnresolvedIds, ...runtimeInexactIds]);
  const score = index.nodes.length === 0
    ? 100
    : Math.round(((index.nodes.length - penalizedIds.size) / index.nodes.length) * 100);

  return {
    exact: findings.length === 0,
    score,
    sourceRepresentation: {
      exact: sourceUnresolvedIds.size === 0,
      resolved: sourceResolved,
      total: index.nodes.length,
      rate: rate(sourceResolved, index.nodes.length),
    },
    runtimeJoinability: {
      exact: runtimeInexactIds.size === 0,
      resolved: runtimeResolved,
      total: runtimeNodeIds.size,
      rate: rate(runtimeResolved, runtimeNodeIds.size),
    },
    staticOnlyNodes: index.nodes.length - index.spanPathById.size,
    findings,
  };
};
