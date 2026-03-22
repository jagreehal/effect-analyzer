import { describe, it, expect } from 'vitest';
import { renderRetryMermaid } from './output/mermaid-retry';
import type { StaticEffectIR, StaticFlowNode, StaticRetryNode, StaticTimeoutNode } from './types';

const makeEffectNode = (id: string, name: string): StaticFlowNode => ({
  id,
  type: 'effect',
  callee: name,
  name,
  displayName: name,
}) as unknown as StaticFlowNode;

const makeRetryNode = (overrides: Partial<StaticRetryNode> & { id: string }): StaticRetryNode => ({
  type: 'retry',
  source: makeEffectNode(`${overrides.id}-src`, 'Operation'),
  hasFallback: false,
  ...overrides,
}) as StaticRetryNode;

const makeTimeoutNode = (overrides: Partial<StaticTimeoutNode> & { id: string }): StaticTimeoutNode => ({
  type: 'timeout',
  source: makeEffectNode(`${overrides.id}-src`, 'Operation'),
  hasFallback: false,
  ...overrides,
}) as StaticTimeoutNode;

const makeIR = (children: StaticFlowNode[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'test',
    source: 'direct',
    children,
    dependencies: [],
    errorTypes: [],
  },
  metadata: {
    analyzedAt: Date.now(),
    filePath: 'test.ts',
    stats: {
      totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0,
      retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0,
      conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0,
      decisionCount: 0, switchCount: 0,
    },
  },
  references: new Map(),
});

describe('renderRetryMermaid', () => {
  it('renders retry node with scheduleInfo strategy label', () => {
    const ir = makeIR([
      makeRetryNode({
        id: 'r1',
        scheduleInfo: {
          baseStrategy: 'exponential',
          maxRetries: 3,
          initialDelay: '100ms',
          jittered: false,
          conditions: [],
        },
      }),
    ]);

    const result = renderRetryMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('exponential');
    expect(result).toContain('3x');
    expect(result).toContain('100ms');
    expect(result).toContain('-->|fail|');
    expect(result).toContain('-->|exhausted|');
    expect(result).toContain('Failure');
  });

  it('renders retry with fallback path', () => {
    const ir = makeIR([
      makeRetryNode({
        id: 'r1',
        hasFallback: true,
        scheduleInfo: {
          baseStrategy: 'fixed',
          maxRetries: 2,
          jittered: false,
          conditions: [],
        },
      }),
    ]);

    const result = renderRetryMermaid(ir);

    expect(result).toContain('Fallback');
    expect(result).toContain('-->|exhausted|');
    expect(result).not.toContain('Failure');
  });

  it('renders timeout node with duration', () => {
    const ir = makeIR([
      makeTimeoutNode({
        id: 't1',
        duration: '5000',
      }),
    ]);

    const result = renderRetryMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('5000');
    expect(result).toContain('-->|within|');
    expect(result).toContain('-->|exceeded|');
    expect(result).toContain('Timeout');
  });

  it('renders timeout with fallback path', () => {
    const ir = makeIR([
      makeTimeoutNode({
        id: 't1',
        duration: '3000',
        hasFallback: true,
      }),
    ]);

    const result = renderRetryMermaid(ir);

    expect(result).toContain('Fallback');
    expect(result).toContain('-->|exceeded|');
    expect(result).not.toContain('Timeout))');
  });

  it('renders graceful empty output when no resilience nodes', () => {
    const ir = makeIR([
      makeEffectNode('e1', 'doStuff'),
    ]);

    const result = renderRetryMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('No retry/timeout patterns');
  });

  it('does not crash when retry node has no source operation', () => {
    const ir = makeIR([
      makeRetryNode({
        id: 'r1',
        source: undefined,
        scheduleInfo: {
          baseStrategy: 'fixed',
          maxRetries: 1,
          jittered: false,
          conditions: [],
        },
      }),
    ]);

    expect(() => renderRetryMermaid(ir)).not.toThrow();
    expect(renderRetryMermaid(ir)).toContain('Operation');
  });

  it('renders jitter annotation on jittered retry', () => {
    const ir = makeIR([
      makeRetryNode({
        id: 'r1',
        scheduleInfo: {
          baseStrategy: 'exponential',
          maxRetries: 5,
          initialDelay: '200ms',
          jittered: true,
          conditions: [],
        },
      }),
    ]);

    const result = renderRetryMermaid(ir);

    expect(result).toContain('jitter');
  });

  it('respects direction option', () => {
    const ir = makeIR([
      makeRetryNode({
        id: 'r1',
        scheduleInfo: {
          baseStrategy: 'fixed',
          maxRetries: 2,
          jittered: false,
          conditions: [],
        },
      }),
    ]);

    const result = renderRetryMermaid(ir, { direction: 'TB' });

    expect(result).toContain('flowchart TB');
  });
});
