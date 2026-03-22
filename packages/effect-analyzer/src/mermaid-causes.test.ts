import { describe, it, expect } from 'vitest';
import { renderCausesMermaid } from './output/mermaid-causes';
import type { StaticEffectIR, StaticFlowNode, StaticCauseNode, StaticExitNode, StaticEffectNode, EffectTypeSignature } from './types';

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

const makeIR = (children: StaticFlowNode[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'testProgram',
    source: 'direct',
    children,
    dependencies: [],
    errorTypes: [],
  },
  metadata: makeMetadata(),
  references: new Map(),
});

const makeSig = (error: string): EffectTypeSignature => ({
  successType: 'unknown',
  errorType: error,
  requirementsType: 'never',
  isInferred: false,
  typeConfidence: 'declared',
});

describe('renderCausesMermaid', () => {
  it('renders Effect.fail node as a red leaf', () => {
    const ir = makeIR([
      {
        id: 'e1',
        type: 'effect',
        callee: 'Effect.fail',
        typeSignature: makeSig('NotFoundError'),
      } as StaticEffectNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('flowchart TB');
    expect(result).toContain('testProgram');
    expect(result).toContain('NotFoundError');
    expect(result).toContain('failStyle');
  });

  it('renders Cause.parallel with two Cause.fail children as fork structure', () => {
    const ir = makeIR([
      {
        id: 'c2',
        type: 'cause',
        causeOp: 'parallel',
        isConstructor: true,
        causeKind: 'mixed',
        children: [
          { id: 'c3', type: 'cause', causeOp: 'fail', isConstructor: true, causeKind: 'fail' } as StaticCauseNode,
          { id: 'c4', type: 'cause', causeOp: 'fail', isConstructor: true, causeKind: 'fail' } as StaticCauseNode,
        ],
      } as StaticCauseNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('parallel');
    // Two children should produce two edges
    const lines = result.split('\n');
    const parallelEdges = lines.filter(l => l.includes('parallel'));
    expect(parallelEdges.length).toBeGreaterThanOrEqual(2);
    expect(result).toContain('compositeStyle');
  });

  it('renders Cause.die with dark red styling', () => {
    const ir = makeIR([
      {
        id: 'c1',
        type: 'cause',
        causeOp: 'die',
        isConstructor: true,
        causeKind: 'die',
      } as StaticCauseNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('die');
    expect(result).toContain('dieStyle');
  });

  it('renders mixed Effect.fail and Cause nodes in combined tree', () => {
    const ir = makeIR([
      {
        id: 'e1',
        type: 'effect',
        callee: 'Effect.fail',
        typeSignature: makeSig('ValidationError'),
      } as StaticEffectNode,
      {
        id: 'c1',
        type: 'cause',
        causeOp: 'fail',
        isConstructor: true,
        causeKind: 'fail',
      } as StaticCauseNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('ValidationError');
    expect(result).toContain('Cause.fail');
    expect(result).toContain('failStyle');
  });

  it('renders "No failure causes" when no failure nodes exist', () => {
    const ir = makeIR([
      {
        id: 'e1',
        type: 'effect',
        callee: 'Effect.succeed',
        typeSignature: makeSig('never'),
      } as StaticEffectNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('No failure causes');
  });

  it('respects direction option', () => {
    const ir = makeIR([
      {
        id: 'c1',
        type: 'cause',
        causeOp: 'fail',
        isConstructor: true,
        causeKind: 'fail',
      } as StaticCauseNode,
    ]);

    const result = renderCausesMermaid(ir, { direction: 'LR' });

    expect(result).toContain('flowchart LR');
  });

  it('renders Cause.interrupt with orange styling', () => {
    const ir = makeIR([
      {
        id: 'c1',
        type: 'cause',
        causeOp: 'interrupt',
        isConstructor: true,
        causeKind: 'interrupt',
      } as StaticCauseNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('interrupt');
    expect(result).toContain('interruptStyle');
  });

  it('renders Exit.fail as a failure leaf', () => {
    const ir = makeIR([
      {
        id: 'x1',
        type: 'exit',
        exitOp: 'fail',
        isConstructor: true,
      } as StaticExitNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('Exit.fail');
    expect(result).toContain('failStyle');
  });

  it('renders Cause.sequential with chained edges', () => {
    const ir = makeIR([
      {
        id: 'c5',
        type: 'cause',
        causeOp: 'sequential',
        isConstructor: true,
        causeKind: 'mixed',
        children: [
          { id: 'c6', type: 'cause', causeOp: 'fail', isConstructor: true, causeKind: 'fail' } as StaticCauseNode,
          { id: 'c7', type: 'cause', causeOp: 'die', isConstructor: true, causeKind: 'die' } as StaticCauseNode,
        ],
      } as StaticCauseNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('then');
    expect(result).toContain('sequential');
  });

  it('renders Effect.die as a defect node', () => {
    const ir = makeIR([
      {
        id: 'e2',
        type: 'effect',
        callee: 'Effect.die',
      } as StaticEffectNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('Effect.die');
    expect(result).toContain('dieStyle');
  });

  it('renders Effect.interrupt as an interruption node', () => {
    const ir = makeIR([
      {
        id: 'e3',
        type: 'effect',
        callee: 'Effect.interrupt',
      } as StaticEffectNode,
    ]);

    const result = renderCausesMermaid(ir);

    expect(result).toContain('Effect.interrupt');
    expect(result).toContain('interruptStyle');
  });
});
