import { describe, it, expect } from 'vitest';
import { renderConcurrencyMermaid } from './output/mermaid-concurrency';
import type {
  StaticEffectIR,
  StaticEffectNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticFiberNode,
  StaticConcurrencyPrimitiveNode,
  StaticFlowNode,
  StaticGeneratorNode,
} from './types';

const makeStats = () => ({
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
  unknownCount: 0,
  interruptionCount: 0,
  decisionCount: 0,
  switchCount: 0,
});

const makeIR = (children: StaticFlowNode[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'test',
    source: 'generator',
    children: [{
      id: 'gen-1',
      type: 'generator',
      yields: children.map((c, i) => ({ variableName: `v${i}`, effect: c as StaticEffectNode })),
    } as StaticGeneratorNode],
    dependencies: [],
    errorTypes: [],
  },
  metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: makeStats() },
  references: new Map(),
});

const makeDirectIR = (children: StaticFlowNode[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'test',
    source: 'direct',
    children,
    dependencies: [],
    errorTypes: [],
  },
  metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: makeStats() },
  references: new Map(),
});

const makeEffect = (id: string, callee: string, displayName?: string): StaticEffectNode => ({
  type: 'effect',
  id,
  callee,
  name: displayName ?? callee,
  displayName,
} as StaticEffectNode);

describe('renderConcurrencyMermaid', () => {
  it('renders parallel node with 3 children as fork structure', () => {
    const parallel: StaticParallelNode = {
      id: 'par-1',
      type: 'parallel',
      callee: 'Effect.all',
      mode: 'parallel',
      children: [
        makeEffect('e1', 'fetchUser', 'Fetch User'),
        makeEffect('e2', 'fetchOrders', 'Fetch Orders'),
        makeEffect('e3', 'fetchProfile', 'Fetch Profile'),
      ],
      branchLabels: ['Fetch User', 'Fetch Orders', 'Fetch Profile'],
    };

    const ir = makeDirectIR([parallel]);
    const result = renderConcurrencyMermaid(ir);

    expect(result).toContain('flowchart TB');
    // Should have a parallel node
    expect(result).toContain('Effect.all');
    expect(result).toContain('3 effects');
    // Should show children
    expect(result).toContain('Fetch User');
    expect(result).toContain('Fetch Orders');
    expect(result).toContain('Fetch Profile');
    // Should have parallel styling
    expect(result).toContain('fill:#E3F2FD');
  });

  it('renders race node with diamond shape and competing branches', () => {
    const race: StaticRaceNode = {
      id: 'race-1',
      type: 'race',
      callee: 'Effect.race',
      children: [
        makeEffect('e1', 'fastApi', 'Fast API'),
        makeEffect('e2', 'slowApi', 'Slow API'),
      ],
      raceLabels: ['Fast API', 'Slow API'],
    };

    const ir = makeDirectIR([race]);
    const result = renderConcurrencyMermaid(ir);

    expect(result).toContain('flowchart TB');
    // Diamond shape for race
    expect(result).toMatch(/\{.*Race.*\}/);
    // Competing branches
    expect(result).toContain('Fast API');
    expect(result).toContain('Slow API');
    // Race styling
    expect(result).toContain('fill:#FFF3E0');
  });

  it('renders fiber fork + join with connection and safety styling', () => {
    const fork: StaticFiberNode = {
      id: 'fib-1',
      type: 'fiber',
      operation: 'forkScoped',
      isScoped: true,
      isDaemon: false,
      fiberSource: makeEffect('e1', 'backgroundTask', 'Background Task'),
    };

    const join: StaticFiberNode = {
      id: 'fib-2',
      type: 'fiber',
      operation: 'join',
      isScoped: false,
      isDaemon: false,
    };

    const ir = makeDirectIR([fork, join]);
    const result = renderConcurrencyMermaid(ir);

    expect(result).toContain('forkScoped');
    expect(result).toContain('join');
    // Safe fork styling (green)
    expect(result).toContain('fill:#C8E6C9');
    // Join styling (blue)
    expect(result).toContain('fill:#BBDEFB');
  });

  it('renders forkDaemon with orange styling', () => {
    const fork: StaticFiberNode = {
      id: 'fib-1',
      type: 'fiber',
      operation: 'forkDaemon',
      isScoped: false,
      isDaemon: true,
    };

    const ir = makeDirectIR([fork]);
    const result = renderConcurrencyMermaid(ir);

    expect(result).toContain('forkDaemon');
    // Daemon styling (orange)
    expect(result).toContain('fill:#FFE0B2');
  });

  it('renders concurrency primitive (semaphore) with hexagon shape', () => {
    const sem: StaticConcurrencyPrimitiveNode = {
      id: 'sem-1',
      type: 'concurrency-primitive',
      primitive: 'semaphore',
      operation: 'withPermit',
    };

    const ir = makeDirectIR([sem]);
    const result = renderConcurrencyMermaid(ir);

    // Hexagon shape uses {{...}}
    expect(result).toMatch(/\{\{.*Semaphore\.withPermit.*\}\}/);
    // Primitive styling (purple)
    expect(result).toContain('fill:#F3E5F5');
  });

  it('renders graceful empty output when no concurrency nodes found', () => {
    const ir = makeDirectIR([
      makeEffect('e1', 'Effect.succeed', 'Succeed'),
    ]);
    const result = renderConcurrencyMermaid(ir);

    expect(result).toContain('NoConcurrency');
    expect(result).toContain('No concurrency');
  });

  it('respects direction option', () => {
    const parallel: StaticParallelNode = {
      id: 'par-1',
      type: 'parallel',
      callee: 'Effect.all',
      mode: 'parallel',
      children: [
        makeEffect('e1', 'a', 'A'),
        makeEffect('e2', 'b', 'B'),
      ],
    };

    const ir = makeDirectIR([parallel]);
    const result = renderConcurrencyMermaid(ir, { direction: 'LR' });

    expect(result).toContain('flowchart LR');
  });
});
