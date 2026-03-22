import { describe, it, expect } from 'vitest';
import { renderDataflowMermaid } from './output/mermaid-dataflow';
import type {
  StaticEffectIR,
  StaticEffectNode,
  StaticGeneratorNode,
  StaticPipeNode,
  StaticTransformNode,
  StaticFlowNode,
  EffectTypeSignature,
} from './types';

const makeSig = (
  success: string,
  error = 'never',
): EffectTypeSignature => ({
  successType: success,
  errorType: error,
  requirementsType: 'never',
  isInferred: false,
  typeConfidence: 'declared',
});

const makeEffectNode = (
  overrides: Partial<StaticEffectNode> & { id: string; callee: string },
): StaticEffectNode => ({
  type: 'effect',
  name: overrides.callee,
  ...overrides,
});

const emptyStats = {
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
};

const makePipeIR = (pipeNode: StaticFlowNode): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'pipeline',
    source: 'pipe',
    children: [pipeNode],
    dependencies: [],
    errorTypes: [],
  },
  metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: emptyStats },
  references: new Map(),
});

const makeGeneratorIR = (
  yields: { variableName?: string; effect: StaticEffectNode }[],
): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'gen-program',
    source: 'generator',
    children: [
      {
        id: 'gen-1',
        type: 'generator',
        yields,
      } as StaticGeneratorNode,
    ],
    dependencies: [],
    errorTypes: [],
  },
  metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: emptyStats },
  references: new Map(),
});

describe('renderDataflowMermaid', () => {
  it('renders pipe chain with typeFlow showing type evolution', () => {
    const pipe: StaticPipeNode = {
      id: 'p1',
      type: 'pipe',
      initial: makeEffectNode({
        id: 'e1',
        callee: 'Effect.succeed',
        typeSignature: makeSig('string'),
      }),
      transformations: [
        {
          id: 't1',
          type: 'transform',
          transformType: 'map',
          isEffectful: false,
          outputType: makeSig('number'),
        } as StaticTransformNode,
      ],
      typeFlow: [makeSig('string'), makeSig('number')],
    };

    const result = renderDataflowMermaid(makePipeIR(pipe as unknown as StaticFlowNode));

    expect(result).toContain('flowchart LR');
    expect(result).toContain('string');
    expect(result).toContain('number');
    expect(result).toContain('map');
  });

  it('renders effectful transforms (flatMap) with bold edges', () => {
    const pipe: StaticPipeNode = {
      id: 'p1',
      type: 'pipe',
      initial: makeEffectNode({
        id: 'e1',
        callee: 'Effect.succeed',
        typeSignature: makeSig('string'),
      }),
      transformations: [
        {
          id: 't1',
          type: 'transform',
          transformType: 'flatMap',
          isEffectful: true,
          outputType: makeSig('User', 'ParseError'),
        } as StaticTransformNode,
      ],
      typeFlow: [makeSig('string'), makeSig('User', 'ParseError')],
    };

    const result = renderDataflowMermaid(makePipeIR(pipe as unknown as StaticFlowNode));

    // Bold edge for effectful transform
    expect(result).toContain('==>');
    expect(result).toContain('flatMap');
    expect(result).toContain('User');
  });

  it('renders unknown types with gray styling', () => {
    const pipe: StaticPipeNode = {
      id: 'p1',
      type: 'pipe',
      initial: makeEffectNode({
        id: 'e1',
        callee: 'Effect.succeed',
        typeSignature: makeSig('unknown'),
      }),
      transformations: [
        {
          id: 't1',
          type: 'transform',
          transformType: 'map',
          isEffectful: false,
          outputType: makeSig('unknown'),
        } as StaticTransformNode,
      ],
      typeFlow: [makeSig('unknown'), makeSig('unknown')],
    };

    const result = renderDataflowMermaid(makePipeIR(pipe as unknown as StaticFlowNode));

    // Gray styling for unknown nodes
    expect(result).toContain('fill:#EEEEEE');
  });

  it('renders graceful empty output when no transformations found', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'empty',
        source: 'direct',
        children: [],
        dependencies: [],
        errorTypes: [],
      },
      metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: emptyStats },
      references: new Map(),
    };

    const result = renderDataflowMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('NoData((No data transformations))');
  });

  it('renders generator program with yield steps showing type display', () => {
    const ir = makeGeneratorIR([
      {
        variableName: 'raw',
        effect: makeEffectNode({
          id: 'n1',
          callee: 'readFile',
          typeSignature: makeSig('string'),
        }),
      },
      {
        variableName: 'parsed',
        effect: makeEffectNode({
          id: 'n2',
          callee: 'parseJson',
          typeSignature: makeSig('Config', 'ParseError'),
        }),
      },
      {
        variableName: 'validated',
        effect: makeEffectNode({
          id: 'n3',
          callee: 'validate',
          typeSignature: makeSig('ValidConfig'),
        }),
      },
    ]);

    const result = renderDataflowMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('string');
    expect(result).toContain('Config');
    expect(result).toContain('ValidConfig');
  });

  it('respects direction option', () => {
    const pipe: StaticPipeNode = {
      id: 'p1',
      type: 'pipe',
      initial: makeEffectNode({
        id: 'e1',
        callee: 'Effect.succeed',
        typeSignature: makeSig('string'),
      }),
      transformations: [
        {
          id: 't1',
          type: 'transform',
          transformType: 'map',
          isEffectful: false,
          outputType: makeSig('number'),
        } as StaticTransformNode,
      ],
      typeFlow: [makeSig('string'), makeSig('number')],
    };

    const result = renderDataflowMermaid(makePipeIR(pipe as unknown as StaticFlowNode), {
      direction: 'TB',
    });

    expect(result).toContain('flowchart TB');
  });

  it('annotates edge when error type changes between steps', () => {
    const pipe: StaticPipeNode = {
      id: 'p1',
      type: 'pipe',
      initial: makeEffectNode({
        id: 'e1',
        callee: 'Effect.succeed',
        typeSignature: makeSig('string', 'never'),
      }),
      transformations: [
        {
          id: 't1',
          type: 'transform',
          transformType: 'flatMap',
          isEffectful: true,
          outputType: makeSig('User', 'ParseError'),
        } as StaticTransformNode,
      ],
      typeFlow: [makeSig('string', 'never'), makeSig('User', 'ParseError')],
    };

    const result = renderDataflowMermaid(makePipeIR(pipe as unknown as StaticFlowNode));

    // Should annotate the error type change
    expect(result).toContain('ParseError');
  });

  it('styles known-type nodes with green fill', () => {
    const pipe: StaticPipeNode = {
      id: 'p1',
      type: 'pipe',
      initial: makeEffectNode({
        id: 'e1',
        callee: 'Effect.succeed',
        typeSignature: makeSig('string'),
      }),
      transformations: [
        {
          id: 't1',
          type: 'transform',
          transformType: 'map',
          isEffectful: false,
          outputType: makeSig('number'),
        } as StaticTransformNode,
      ],
      typeFlow: [makeSig('string'), makeSig('number')],
    };

    const result = renderDataflowMermaid(makePipeIR(pipe as unknown as StaticFlowNode));

    expect(result).toContain('fill:#E8F5E9');
  });
});
