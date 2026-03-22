import { describe, it, expect } from 'vitest';
import { renderErrorsMermaid } from './output/mermaid-errors';
import type { StaticEffectIR, StaticEffectNode, StaticGeneratorNode, StaticFlowNode, StaticErrorHandlerNode, EffectTypeSignature } from './types';

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

const makeGeneratorIR = (yields: { variableName?: string; effect: StaticEffectNode }[], extraChildren?: StaticFlowNode[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'test',
    source: 'generator',
    children: [
      {
        id: 'gen-1',
        type: 'generator',
        yields,
      } as StaticGeneratorNode,
      ...(extraChildren ?? []),
    ],
    dependencies: [],
    errorTypes: [],
  },
  metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: makeStats() },
  references: new Map(),
});

describe('renderErrorsMermaid', () => {
  it('renders step and error type nodes for error-producing steps', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'validate', typeSignature: makeSig('ValidationError') }) },
      { effect: makeNode({ id: 'n2', callee: 'fetchRate', typeSignature: makeSig('RateError') }) },
    ]);

    const result = renderErrorsMermaid(ir);

    expect(result).toContain('flowchart LR');
    // Step nodes
    expect(result).toContain('validate');
    expect(result).toContain('fetchRate');
    // Error type nodes
    expect(result).toContain('ValidationError');
    expect(result).toContain('RateError');
    // Produces edges
    expect(result).toContain('--produces-->');
    // Styles
    expect(result).toContain('stepStyle');
    expect(result).toContain('errorStyle');
  });

  it('renders handler node and caught-by edge for error handler', () => {
    const sourceNode = makeNode({ id: 'n1', callee: 'fetchUser', typeSignature: makeSig('UserNotFoundError') });
    const handlerNode = makeNode({ id: 'n2', callee: 'fallback', typeSignature: makeSig('never') });

    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'test',
        source: 'generator',
        children: [
          {
            id: 'handler-1',
            type: 'error-handler',
            handlerType: 'catchTag',
            errorTag: 'UserNotFoundError',
            source: sourceNode,
            handler: handlerNode,
          } as unknown as StaticFlowNode,
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: makeStats() },
      references: new Map(),
    };

    const result = renderErrorsMermaid(ir);

    expect(result).toContain('flowchart LR');
    // Handler node
    expect(result).toContain('catchTag');
    expect(result).toContain('handlerStyle');
    // Caught-by edge
    expect(result).toContain('--caught by-->');
  });

  it('renders UNHANDLED node for errors without handlers', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'validate', typeSignature: makeSig('ValidationError') }) },
      { effect: makeNode({ id: 'n2', callee: 'fetchRate', typeSignature: makeSig('RateError') }) },
    ]);

    const result = renderErrorsMermaid(ir);

    // With no handlers, all errors should be unhandled
    expect(result).toContain('UNHANDLED');
    expect(result).toContain('unhandledStyle');
  });

  it('renders graceful empty output when no errors', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'doThing', typeSignature: makeSig('never') }) },
    ]);

    const result = renderErrorsMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('No errors');
  });

  it('respects direction option', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'validate', typeSignature: makeSig('ValidationError') }) },
    ]);

    const result = renderErrorsMermaid(ir, { direction: 'TB' });

    expect(result).toContain('flowchart TB');
  });
});
