import { describe, it, expect } from 'vitest';
import { renderTimelineMermaid } from './output/mermaid-timeline';
import type { StaticEffectIR, StaticEffectNode, StaticGeneratorNode, StaticFlowNode, EffectTypeSignature } from './types';

const makeNode = (overrides: Partial<StaticEffectNode> & { id: string; callee: string }): StaticEffectNode => ({
  type: 'effect',
  name: overrides.callee,
  ...overrides,
});

const makeSig = (error: string): EffectTypeSignature => ({
  successType: 'unknown',
  errorType: error,
  requirementsType: 'never',
  isInferred: false,
  typeConfidence: 'declared',
});

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

const makeGeneratorIR = (yields: { variableName?: string; effect: StaticEffectNode }[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'test',
    source: 'generator',
    children: [{
      id: 'gen-1',
      type: 'generator',
      yields,
    } as StaticGeneratorNode],
    dependencies: [],
    errorTypes: [],
  },
  metadata: makeMetadata(),
  references: new Map(),
});

describe('renderTimelineMermaid', () => {
  it('renders service calls with participant declarations and arrows', () => {
    const ir = makeGeneratorIR([
      {
        variableName: 'user',
        effect: makeNode({
          id: 'n1',
          callee: 'UserRepo.getUser',
          serviceCall: { serviceType: 'UserRepo', methodName: 'getUser', objectName: 'userRepo' },
        }),
      },
      {
        variableName: 'log',
        effect: makeNode({
          id: 'n2',
          callee: 'Logger.info',
          serviceCall: { serviceType: 'Logger', methodName: 'info', objectName: 'logger' },
        }),
      },
    ]);

    const result = renderTimelineMermaid(ir);

    expect(result).toContain('sequenceDiagram');
    expect(result).toContain('participant Program');
    expect(result).toContain('participant UserRepo');
    expect(result).toContain('participant Logger');
    expect(result).toContain('Program->>UserRepo: getUser()');
    expect(result).toContain('UserRepo-->>Program: result');
    expect(result).toContain('Program->>Logger: info()');
    expect(result).toContain('Logger-->>Program: result');
  });

  it('renders parallel node with par/and/end block', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'test',
        source: 'direct',
        children: [
          {
            id: 'par-1',
            type: 'parallel',
            callee: 'Effect.all',
            mode: 'parallel',
            children: [
              makeNode({
                id: 'n1',
                callee: 'ServiceA.call',
                serviceCall: { serviceType: 'ServiceA', methodName: 'call', objectName: 'a' },
              }),
              makeNode({
                id: 'n2',
                callee: 'ServiceB.call',
                serviceCall: { serviceType: 'ServiceB', methodName: 'call', objectName: 'b' },
              }),
            ],
          } as unknown as StaticFlowNode,
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: makeMetadata(),
      references: new Map(),
    };

    const result = renderTimelineMermaid(ir);

    expect(result).toContain('par Parallel');
    expect(result).toContain('Program->>ServiceA: call()');
    expect(result).toContain('and');
    expect(result).toContain('Program->>ServiceB: call()');
    expect(result).toContain('end');
  });

  it('renders retry node with Note over', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'test',
        source: 'direct',
        children: [
          {
            id: 'retry-1',
            type: 'retry',
            source: makeNode({ id: 'n1', callee: 'fetchData' }),
            hasFallback: false,
            scheduleInfo: {
              baseStrategy: 'exponential',
              maxRetries: 3,
              jittered: false,
              conditions: [],
            },
          } as unknown as StaticFlowNode,
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: makeMetadata(),
      references: new Map(),
    };

    const result = renderTimelineMermaid(ir);

    expect(result).toContain('Note over Program: retry (3x, exponential)');
  });

  it('renders empty program gracefully', () => {
    const ir = makeGeneratorIR([]);
    const result = renderTimelineMermaid(ir);

    expect(result).toContain('sequenceDiagram');
    expect(result).toContain('Note over Program: Empty program');
  });

  it('renders generator program with yields in execution order', () => {
    const ir = makeGeneratorIR([
      {
        variableName: 'a',
        effect: makeNode({
          id: 'n1',
          callee: 'ServiceA.first',
          serviceCall: { serviceType: 'ServiceA', methodName: 'first', objectName: 'a' },
        }),
      },
      {
        variableName: 'b',
        effect: makeNode({
          id: 'n2',
          callee: 'ServiceB.second',
          serviceCall: { serviceType: 'ServiceB', methodName: 'second', objectName: 'b' },
        }),
      },
      {
        variableName: 'c',
        effect: makeNode({
          id: 'n3',
          callee: 'ServiceA.third',
          serviceCall: { serviceType: 'ServiceA', methodName: 'third', objectName: 'a' },
        }),
      },
    ]);

    const result = renderTimelineMermaid(ir);
    const lines = result.split('\n');

    const firstIdx = lines.findIndex(l => l.includes('first()'));
    const secondIdx = lines.findIndex(l => l.includes('second()'));
    const thirdIdx = lines.findIndex(l => l.includes('third()'));

    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('renders mixed service calls and named constructors in order', () => {
    const ir = makeGeneratorIR([
      {
        effect: makeNode({ id: 'n1', callee: 'initConfig', displayName: 'config <- initConfig' }),
      },
      {
        effect: makeNode({
          id: 'n2',
          callee: 'UserRepo.getUser',
          serviceCall: { serviceType: 'UserRepo', methodName: 'getUser', objectName: 'repo' },
        }),
      },
      {
        effect: makeNode({ id: 'n3', callee: 'saveResult', displayName: 'saved <- saveResult' }),
      },
    ]);

    const result = renderTimelineMermaid(ir);
    const lines = result.split('\n');

    const configIdx = lines.findIndex(l => l.includes('initConfig'));
    const getUserIdx = lines.findIndex(l => l.includes('getUser()'));
    const saveIdx = lines.findIndex(l => l.includes('saveResult'));

    expect(configIdx).toBeLessThan(getUserIdx);
    expect(getUserIdx).toBeLessThan(saveIdx);
    expect(result).toContain('Program->>UserRepo: getUser()');
  });
});
