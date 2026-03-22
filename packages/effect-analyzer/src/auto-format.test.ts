import { describe, it, expect } from 'vitest';
import { selectFormats } from './output/auto-format';
import type { StaticCauseNode, StaticEffectIR, StaticEffectNode, StaticGeneratorNode } from './types';

const makeNode = (overrides: Partial<StaticEffectNode> & { id: string; callee: string }): StaticEffectNode => ({
  type: 'effect',
  name: overrides.callee,
  ...overrides,
});

const defaultStats = () => ({
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
  tryCatchCount: 0,
  terminalCount: 0,
  opaqueCount: 0,
});

const makeGeneratorIR = (
  overrides: {
    dependencies?: { name: string; typeSignature?: string; isLayer: boolean }[];
    errorTypes?: string[];
    requiredServices?: { serviceName: string; tag: string }[];
    source?: 'generator' | 'pipe' | 'direct';
    stats?: Partial<ReturnType<typeof defaultStats>>;
    yields?: { variableName?: string; effect: StaticEffectNode }[];
  } = {},
): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'testProgram',
    source: overrides.source ?? 'generator',
    children: [{
      id: 'gen-1',
      type: 'generator',
      yields: overrides.yields ?? [
        { effect: makeNode({ id: 'n1', callee: 'doSomething' }) },
      ],
    } as StaticGeneratorNode],
    dependencies: overrides.dependencies ?? [],
    errorTypes: overrides.errorTypes ?? [],
    requiredServices: overrides.requiredServices,
  },
  metadata: {
    analyzedAt: Date.now(),
    filePath: 'test.ts',
    stats: { ...defaultStats(), ...overrides.stats },
  },
  references: new Map(),
});

describe('selectFormats', () => {
  it('returns only mermaid-railway for a basic program with no special features', () => {
    const ir = makeGeneratorIR();
    expect(selectFormats(ir)).toEqual(['mermaid-railway']);
  });

  it('includes mermaid-services when program has dependencies', () => {
    const ir = makeGeneratorIR({
      dependencies: [
        { name: 'UserService', isLayer: false },
        { name: 'AuthService', isLayer: false },
      ],
    });
    const formats = selectFormats(ir);
    expect(formats).toContain('mermaid-railway');
    expect(formats).toContain('mermaid-services');
  });

  it('includes mermaid-concurrency when program has parallel + race', () => {
    const ir = makeGeneratorIR({
      stats: { parallelCount: 2, raceCount: 1 },
    });
    const formats = selectFormats(ir);
    expect(formats).toContain('mermaid-railway');
    expect(formats).toContain('mermaid-concurrency');
  });

  it('includes mermaid-errors when program has error types and handlers', () => {
    const ir = makeGeneratorIR({
      errorTypes: ['ValidationError', 'NotFoundError'],
      stats: { errorHandlerCount: 3 },
    });
    const formats = selectFormats(ir);
    expect(formats).toContain('mermaid-railway');
    expect(formats).toContain('mermaid-errors');
  });

  it('includes mermaid-retry when program has retry + timeout', () => {
    const ir = makeGeneratorIR({
      stats: { retryCount: 2, timeoutCount: 1 },
    });
    const formats = selectFormats(ir);
    expect(formats).toContain('mermaid-railway');
    expect(formats).toContain('mermaid-retry');
  });

  it('returns at most 3 formats when multiple features are present', () => {
    const ir = makeGeneratorIR({
      dependencies: [
        { name: 'UserService', isLayer: false },
        { name: 'AuthService', isLayer: false },
        { name: 'DbService', isLayer: false },
      ],
      errorTypes: ['ValidationError', 'NotFoundError', 'AuthError'],
      stats: {
        parallelCount: 3,
        raceCount: 2,
        errorHandlerCount: 4,
        retryCount: 3,
        timeoutCount: 2,
        layerCount: 5,
        conditionalCount: 3,
        decisionCount: 2,
        switchCount: 1,
      },
      requiredServices: [
        { serviceName: 'UserService', tag: 'UserService' },
        { serviceName: 'AuthService', tag: 'AuthService' },
      ],
    });
    const formats = selectFormats(ir);
    expect(formats.length).toBeLessThanOrEqual(3);
    // Complex programs with structural nodes get 'mermaid' as baseline
    expect(formats[0]).toBe('mermaid');
  });

  it('includes mermaid-dataflow for pipe-sourced programs', () => {
    const ir = makeGeneratorIR({ source: 'pipe' });
    const formats = selectFormats(ir);
    expect(formats).toContain('mermaid-railway');
    expect(formats).toContain('mermaid-dataflow');
  });

  it('includes mermaid-layers when program has layers', () => {
    const ir = makeGeneratorIR({
      stats: { layerCount: 3 },
    });
    const formats = selectFormats(ir);
    expect(formats).toContain('mermaid-railway');
    expect(formats).toContain('mermaid-layers');
  });

  it('includes mermaid-causes when the IR contains cause nodes', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'causeProgram',
        source: 'direct',
        children: [
          {
            id: 'cause-1',
            type: 'cause',
            causeOp: 'fail',
            isConstructor: true,
            causeKind: 'fail',
          } as StaticCauseNode,
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: 'test.ts',
        stats: defaultStats(),
      },
      references: new Map(),
    };

    const formats = selectFormats(ir);
    expect(formats).toContain('mermaid-railway');
    expect(formats).toContain('mermaid-causes');
  });

  it('always includes a diagram baseline as the first format', () => {
    const testCases = [
      makeGeneratorIR(),
      makeGeneratorIR({ stats: { retryCount: 5 } }),
      makeGeneratorIR({ dependencies: [{ name: 'Svc', isLayer: false }] }),
      makeGeneratorIR({ source: 'pipe' }),
    ];
    for (const ir of testCases) {
      const formats = selectFormats(ir);
      expect(['mermaid-railway', 'mermaid']).toContain(formats[0]);
    }
  });
});
