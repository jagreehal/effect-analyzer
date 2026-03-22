import { describe, it, expect } from 'vitest';
import { renderLayersMermaid } from './output/mermaid-layers';
import type { StaticEffectIR, StaticLayerNode } from './types';

const makeMetadata = () => ({
  analyzedAt: Date.now(),
  filePath: 'test.ts',
  stats: {
    totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0,
    retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0,
    conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0,
    decisionCount: 0, switchCount: 0,
  },
});

const makeLayerNode = (overrides: Partial<StaticLayerNode> & { id: string }): StaticLayerNode => ({
  type: 'layer',
  operations: [],
  isMerged: false,
  ...overrides,
});

const makeIR = (layers: StaticLayerNode[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'test',
    source: 'generator',
    children: layers,
    dependencies: [],
    errorTypes: [],
  },
  metadata: makeMetadata(),
  references: new Map(),
});

describe('renderLayersMermaid', () => {
  it('renders provides edge for a layer that provides a service', () => {
    const ir = makeIR([
      makeLayerNode({
        id: 'layer-db',
        name: 'DbLayer',
        provides: ['DbService'],
        lifecycle: 'memoized',
      }),
    ]);

    const result = renderLayersMermaid(ir);
    expect(result).toContain('flowchart TB');
    expect(result).toContain('DbLayer');
    expect(result).toContain('memoized');
    expect(result).toContain('DbService');
    expect(result).toContain('-->|provides|');
    expect(result).toContain('fill:#E8EAF6');
    expect(result).toContain('fill:#E3F2FD');
  });

  it('renders requires edges as dashed arrows', () => {
    const ir = makeIR([
      makeLayerNode({
        id: 'layer-app',
        name: 'AppLayer',
        provides: ['AppService'],
        requires: ['DbService', 'LogService'],
      }),
    ]);

    const result = renderLayersMermaid(ir);
    expect(result).toContain('-.->|requires|');
    expect(result).toContain('DbService');
    expect(result).toContain('LogService');
  });

  it('renders merge edge for merged layers', () => {
    const childLayer = makeLayerNode({
      id: 'layer-child',
      name: 'ChildLayer',
      provides: ['ChildService'],
    });
    const parentLayer = makeLayerNode({
      id: 'layer-parent',
      name: 'ParentLayer',
      provides: ['ParentService'],
      isMerged: true,
      operations: [childLayer],
    });

    const ir = makeIR([parentLayer, childLayer]);

    const result = renderLayersMermaid(ir);
    expect(result).toContain('-->|merge|');
    expect(result).toContain('fill:#F3E5F5');
  });

  it('renders graceful empty output when no layers', () => {
    const ir = makeIR([]);
    const result = renderLayersMermaid(ir);
    expect(result).toContain('flowchart TB');
    expect(result).toContain('NoLayers');
    expect(result).toContain('No layers');
  });

  it('respects direction option', () => {
    const ir = makeIR([
      makeLayerNode({
        id: 'layer-1',
        name: 'MyLayer',
        provides: ['Svc'],
      }),
    ]);

    const result = renderLayersMermaid(ir, { direction: 'LR' });
    expect(result).toContain('flowchart LR');
  });

  it('renders full graph with multiple layers and dependencies', () => {
    const ir = makeIR([
      makeLayerNode({
        id: 'layer-db',
        name: 'DbLayer',
        provides: ['DbService'],
        lifecycle: 'memoized',
      }),
      makeLayerNode({
        id: 'layer-log',
        name: 'LogLayer',
        provides: ['LogService'],
        lifecycle: 'default',
      }),
      makeLayerNode({
        id: 'layer-app',
        name: 'AppLayer',
        provides: ['AppService'],
        requires: ['DbService', 'LogService'],
        lifecycle: 'scoped',
      }),
    ]);

    const result = renderLayersMermaid(ir);

    // All layers present
    expect(result).toContain('DbLayer');
    expect(result).toContain('LogLayer');
    expect(result).toContain('AppLayer');

    // All services present
    expect(result).toContain('DbService');
    expect(result).toContain('LogService');
    expect(result).toContain('AppService');

    // Provides edges
    expect(result).toContain('-->|provides|');

    // Requires edges (dashed)
    expect(result).toContain('-.->|requires|');

    // Styling classes present
    expect(result).toContain('layerStyle');
    expect(result).toContain('serviceStyle');
  });
});
