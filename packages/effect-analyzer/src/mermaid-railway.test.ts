import { describe, it, expect } from 'vitest';
import { renderRailwayMermaid } from './output/mermaid-railway';
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

const makeGeneratorIR = (yields: { variableName?: string; effect: StaticEffectNode }[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'transfer',
    source: 'generator',
    children: [{
      id: 'gen-1',
      type: 'generator',
      yields,
    } as StaticGeneratorNode],
    dependencies: [],
    errorTypes: [],
  },
  metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: { totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0, retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0, conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0, decisionCount: 0, switchCount: 0 } },
  references: new Map(),
});

describe('renderRailwayMermaid', () => {
  it('renders a basic generator program with typed steps', () => {
    const ir = makeGeneratorIR([
      { variableName: 'validInput', effect: makeNode({ id: 'n1', callee: 'validate', displayName: 'Validate', typeSignature: makeSig('ValidationError') }) },
      { variableName: 'rate', effect: makeNode({ id: 'n2', callee: 'fetchRate', displayName: 'Fetch Rate', typeSignature: makeSig('RateUnavailableError') }) },
      { variableName: 'balance', effect: makeNode({ id: 'n3', callee: 'getBalance', displayName: 'Get Balance', typeSignature: makeSig('never') }) },
    ]);

    const result = renderRailwayMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('-->|ok|');
    expect(result).toContain('-->|err|');
    expect(result).toContain('Validation');
    expect(result).toContain('RateUnavailable');
    const lines = result.split('\n');
    const cNodeLine = lines.find(l => l.includes('Get Balance'));
    expect(cNodeLine).toBeDefined();
    const errLines = lines.filter(l => l.includes('-->|err|'));
    const balanceErrLine = errLines.find(l => l.includes('C'));
    expect(balanceErrLine).toBeUndefined();
    expect(result).toContain('Done((Success))');
  });

  it('skips error branch for steps with never error type', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'getBalance', displayName: 'Get Balance', typeSignature: makeSig('never') }) },
      { effect: makeNode({ id: 'n2', callee: 'format', displayName: 'Format', typeSignature: makeSig('never') }) },
    ]);
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('-->|ok|');
    expect(result).not.toContain('-->|err|');
    expect(result).toContain('Done((Success))');
  });

  it('combines multiple error types with / separator', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'transfer', displayName: 'Transfer', typeSignature: makeSig('TransferRejectedError | ProviderUnavailableError') }) },
    ]);
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('TransferRejected / ProviderUnavailable');
  });

  it('strips Error and Exception suffixes from error type names', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'parse', displayName: 'Parse', typeSignature: makeSig('ParseException') }) },
    ]);
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('Parse');
    expect(result).not.toContain('ParseException');
  });

  it('falls back to program-level errors when no step has type info', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'test',
        source: 'generator',
        children: [{
          id: 'gen-1',
          type: 'generator',
          yields: [
            { effect: makeNode({ id: 'n1', callee: 'stepA', displayName: 'Step A' }) },
            { effect: makeNode({ id: 'n2', callee: 'stepB', displayName: 'Step B' }) },
          ],
        } as StaticGeneratorNode],
        dependencies: [],
        errorTypes: ['DatabaseError', 'NetworkError'],
      },
      metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: { totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0, retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0, conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0, decisionCount: 0, switchCount: 0 } },
      references: new Map(),
    };
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('Errors[Database / Network]');
  });

  it('respects direction option', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'step', displayName: 'Step' }) },
    ]);
    const result = renderRailwayMermaid(ir, { direction: 'TB' });
    expect(result).toContain('flowchart TB');
  });

  it('handles pipe-sourced programs', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'pipeline',
        source: 'pipe',
        children: [{
          id: 'pipe-1',
          type: 'pipe',
          initial: makeNode({ id: 'n1', callee: 'Effect.succeed', displayName: 'Succeed', typeSignature: makeSig('never') }),
          transformations: [
            makeNode({ id: 'n2', callee: 'Effect.flatMap', displayName: 'FlatMap', typeSignature: makeSig('ParseError') }),
          ],
        } as unknown as StaticFlowNode],
        dependencies: [],
        errorTypes: [],
      },
      metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: { totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0, retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0, conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0, decisionCount: 0, switchCount: 0 } },
      references: new Map(),
    };
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('Succeed');
    expect(result).toContain('FlatMap');
    expect(result).toContain('-->|ok|');
    expect(result).toContain('Parse');
  });

  it('unwraps nested generator inside a pipe wrapper', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'wrapped-generator',
        source: 'pipe',
        children: [{
          id: 'pipe-1',
          type: 'pipe',
          initial: {
            id: 'gen-1',
            type: 'generator',
            yields: [
              { effect: makeNode({ id: 'n1', callee: 'validate', displayName: 'Validate', typeSignature: makeSig('ValidationError') }) },
              { effect: makeNode({ id: 'n2', callee: 'persist', displayName: 'Persist', typeSignature: makeSig('never') }) },
            ],
          } as StaticGeneratorNode,
          transformations: [
            {
              id: 'handler-1',
              type: 'error-handler',
              handlerType: 'catchAll',
              source: makeNode({ id: 'n3', callee: 'recover', displayName: 'Recover', typeSignature: makeSig('RecoveryError') }),
            } as unknown as StaticFlowNode,
          ],
        } as unknown as StaticFlowNode],
        dependencies: [],
        errorTypes: [],
      },
      metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: { totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0, retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0, conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0, decisionCount: 0, switchCount: 0 } },
      references: new Map(),
    };

    const result = renderRailwayMermaid(ir);

    expect(result).toContain('Validate');
    expect(result).toContain('Persist');
    // Error handlers are skipped in railway view (shown in mermaid-errors instead)
    expect(result).not.toContain('Recover');
    expect(result).not.toContain('generator');
    expect(result).not.toContain('Error Handler');
  });

  it('handles empty children gracefully', () => {
    const ir = makeGeneratorIR([]);
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('No steps');
  });

  it('escapes special characters in labels', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'parse', displayName: 'Parse', typeSignature: makeSig('Option<never>') }) },
    ]);
    const result = renderRailwayMermaid(ir);
    expect(result).not.toContain('<never>');
    expect(result).toContain('#lt;never#gt;');
  });

  it('generates IDs beyond 26 steps', () => {
    const yields = Array.from({ length: 28 }, (_, i) => ({
      effect: makeNode({ id: `n${i}`, callee: `step${i}`, displayName: `Step ${i}`, typeSignature: makeSig('never') }),
    }));
    const ir = makeGeneratorIR(yields);
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('A1[');
    expect(result).toContain('B1[');
  });

  it('renders non-effect nodes as single labeled boxes', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'test',
        source: 'direct',
        children: [
          makeNode({ id: 'n1', callee: 'validate', displayName: 'Validate', typeSignature: makeSig('ValidationError') }),
          { id: 'n2', type: 'parallel', children: [], name: 'Effect.all' } as unknown as StaticFlowNode,
          makeNode({ id: 'n3', callee: 'save', displayName: 'Save', typeSignature: makeSig('DbError') }),
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: { totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0, retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0, conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0, decisionCount: 0, switchCount: 0 } },
      references: new Map(),
    };
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('Effect.all');
    expect(result).toContain('-->|ok|');
    expect(result).toContain('Validate');
    expect(result).toContain('Save');
  });

  it('derives error branches from parallel children', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'parallel-errors',
        source: 'direct',
        children: [
          {
            id: 'par-1',
            type: 'parallel',
            callee: 'Effect.all',
            mode: 'parallel',
            children: [
              makeNode({ id: 'n1', callee: 'left', displayName: 'Left', typeSignature: makeSig('LeftError') }),
              makeNode({ id: 'n2', callee: 'right', displayName: 'Right', typeSignature: makeSig('RightError') }),
            ],
          } as unknown as StaticFlowNode,
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: { totalEffects: 0, parallelCount: 1, raceCount: 0, errorHandlerCount: 0, retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0, conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0, decisionCount: 0, switchCount: 0 } },
      references: new Map(),
    };

    const result = renderRailwayMermaid(ir);

    expect(result).toContain('Effect.all');
    expect(result).toContain('Left / Right');
    expect(result).toContain('-->|err|');
  });

  it('derives error branches from race children', () => {
    const ir: StaticEffectIR = {
      root: {
        id: 'prog-1',
        type: 'program',
        programName: 'race-errors',
        source: 'direct',
        children: [
          {
            id: 'race-1',
            type: 'race',
            callee: 'Effect.race',
            children: [
              makeNode({ id: 'n1', callee: 'fast', displayName: 'Fast', typeSignature: makeSig('TimeoutError') }),
              makeNode({ id: 'n2', callee: 'slow', displayName: 'Slow', typeSignature: makeSig('NetworkError') }),
            ],
          } as unknown as StaticFlowNode,
        ],
        dependencies: [],
        errorTypes: [],
      },
      metadata: { analyzedAt: Date.now(), filePath: 'test.ts', stats: { totalEffects: 0, parallelCount: 0, raceCount: 1, errorHandlerCount: 0, retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0, conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0, decisionCount: 0, switchCount: 0 } },
      references: new Map(),
    };

    const result = renderRailwayMermaid(ir);

    expect(result).toContain('Effect.race');
    expect(result).toContain('Timeout / Network');
    expect(result).toContain('-->|err|');
  });

  it('renders single step program', () => {
    const ir = makeGeneratorIR([
      { effect: makeNode({ id: 'n1', callee: 'doThing', displayName: 'Do Thing', typeSignature: makeSig('SomeError') }) },
    ]);
    const result = renderRailwayMermaid(ir);
    expect(result).toContain('A[Do Thing] -->|ok| Done((Success))');
    expect(result).toContain('A -->|err| AE[Some]');
  });
});
