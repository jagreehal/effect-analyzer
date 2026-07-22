import { describe, expect, it } from 'vitest';
import type { StaticEffectIR, StaticFlowNode } from './types';
import { computeDiagramFidelity } from './diagram-fidelity';
import { assessIRFidelity } from './fidelity-findings';
import { indexIR } from './ir';
import { renderMermaidWithRuntimeTrace } from './output/mermaid';
import { traceFromOpenTelemetry } from './runtime-trace';

const makeIR = (children: readonly StaticFlowNode[]): StaticEffectIR => ({
  root: {
    id: 'root',
    type: 'program',
    programName: 'program',
    source: 'direct',
    children,
    dependencies: [],
    errorTypes: [],
  },
  metadata: {
    analyzedAt: 0,
    filePath: 'program.ts',
    warnings: [],
    stats: {
      totalEffects: 0,
      parallelCount: 0,
      raceCount: 0,
      errorHandlerCount: 0,
      retryCount: 0,
      timeoutCount: 0,
      resourceCount: 0,
      loopCount: 0,
      conditionalCount: 0,
      layerCount: 0,
      interruptionCount: 0,
      unknownCount: 0,
      decisionCount: 0,
      switchCount: 0,
      tryCatchCount: 0,
      terminalCount: 0,
      opaqueCount: 0,
    },
  },
  references: new Map(),
});

describe('diagram fidelity and runtime overlay', () => {
  it('indexes nested Effect v4 span names in runtime order', () => {
    const ir = makeIR([{
      id: 'op',
      type: 'effect',
      callee: 'Effect.succeed',
      spanName: 'child',
      spanNames: ['parent', 'child'],
    }]);

    const index = indexIR(ir);
    expect(index.idsBySpanPath.get('parent')).toEqual(['op']);
    expect(index.idsBySpanPath.get('parent\u001fchild')).toEqual(['op']);
    expect(computeDiagramFidelity(ir).exact).toBe(true);
  });

  it('reports unresolved, dynamic, and ambiguous source honestly', () => {
    const ir = makeIR([
      { id: 'a', type: 'effect', callee: 'Effect.succeed', spanName: 'duplicate' },
      { id: 'b', type: 'effect', callee: 'Effect.fail', spanName: 'duplicate' },
      { id: 'c', type: 'effect', callee: 'Effect.withSpan', spanNameDynamic: true },
      { id: 'd', type: 'unknown', reason: 'unsupported-call', expression: 'custom()' },
    ]);

    const report = computeDiagramFidelity(ir);
    expect(report.exact).toBe(false);
    expect(report.ambiguousRuntimeNodes).toBe(2);
    expect(report.unresolvedNodes).toBe(2);
    expect(report.issues.map((issue) => issue.kind)).toEqual([
      'dynamic-span-name',
      'unknown-node',
      'duplicate-span-path',
      'duplicate-span-path',
    ]);

    const assessment = assessIRFidelity(ir);
    expect(assessment.sourceRepresentation).toMatchObject({
      exact: false,
      resolved: 3,
      total: 4,
      rate: 0.75,
    });
    expect(assessment.runtimeJoinability).toMatchObject({
      exact: false,
      resolved: 0,
      total: 3,
      rate: 0,
    });
  });

  it('normalizes OpenTelemetry spans and overlays exact paths', () => {
    const ir = makeIR([{
      id: 'op',
      type: 'effect',
      callee: 'Effect.succeed',
      spanName: 'child',
      spanNames: ['parent', 'child'],
    }]);
    const spans = [
      {
        name: 'parent',
        spanContext: () => ({ spanId: 'p' }),
        status: { code: 1 },
        startTime: [1, 0] as const,
        endTime: [1, 1_000_000] as const,
      },
      {
        name: 'child',
        spanContext: () => ({ spanId: 'c' }),
        parentSpanContext: { spanId: 'p' },
        status: { code: 2 },
      },
    ];

    const trace = traceFromOpenTelemetry(spans);
    expect(trace.spans[0]?.durationMs).toBe(1);
    expect(trace.spans[1]?.path).toEqual(['parent', 'child']);

    const overlay = renderMermaidWithRuntimeTrace(ir, trace);
    expect(overlay.matchedSpanIds).toEqual(['p', 'c']);
    expect(overlay.unmatchedSpanIds).toEqual([]);
    expect(overlay.mermaid).toContain('classDef trace_error');
  });
});
