import { describe, it, expect } from 'vitest';
import { renderTestabilityMermaid } from './output/mermaid-testability';
import type { StaticEffectIR } from './types';

const makeIR = (overrides: {
  programName?: string;
  requiredServices?: { serviceId: string; serviceType: string; requiredAt: { filePath: string; line: number; column: number } }[];
  dependencies?: { name: string; typeSignature?: string; isLayer: boolean }[];
} = {}): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: overrides.programName ?? 'MyProgram',
    source: 'generator',
    children: [],
    dependencies: overrides.dependencies ?? [],
    errorTypes: [],
    requiredServices: overrides.requiredServices ?? [],
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

describe('renderTestabilityMermaid', () => {
  it('renders hexagon nodes and needs mock edges for required services', () => {
    const ir = makeIR({
      requiredServices: [
        { serviceId: 'UserRepo', serviceType: 'UserRepo', requiredAt: { filePath: 'test.ts', line: 1, column: 1 } },
      ],
      dependencies: [
        { name: 'UserRepo', isLayer: false },
      ],
    });

    const result = renderTestabilityMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('Prog[MyProgram]');
    expect(result).toContain('{{"UserRepo"}}');
    expect(result).toContain('-->|needs mock|');
    expect(result).toContain('Requires 1 service mock');
  });

  it('renders layer dependencies with layer styling', () => {
    const ir = makeIR({
      requiredServices: [
        { serviceId: 'DbClient', serviceType: 'DbClient', requiredAt: { filePath: 'test.ts', line: 1, column: 1 } },
      ],
      dependencies: [
        { name: 'DbClient', isLayer: true },
      ],
    });

    const result = renderTestabilityMermaid(ir);

    expect(result).toContain('{{"DbClient"}}');
    // Layer dependencies should be classified as hard (infrastructure mocks)
    expect(result).toContain('classDef hard fill:#FFE0B2');
    expect(result).toContain('class S0 hard');
  });

  it('renders pure computation message when no services required', () => {
    const ir = makeIR({
      requiredServices: [],
      dependencies: [],
    });

    const result = renderTestabilityMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('NoMocks((No services to mock - pure computation))');
  });

  it('renders all services when multiple are required', () => {
    const ir = makeIR({
      requiredServices: [
        { serviceId: 'UserRepo', serviceType: 'UserRepo', requiredAt: { filePath: 'test.ts', line: 1, column: 1 } },
        { serviceId: 'Logger', serviceType: 'Logger', requiredAt: { filePath: 'test.ts', line: 2, column: 1 } },
        { serviceId: 'DbClient', serviceType: 'DbClient', requiredAt: { filePath: 'test.ts', line: 3, column: 1 } },
      ],
      dependencies: [
        { name: 'UserRepo', isLayer: false },
        { name: 'Logger', isLayer: false },
        { name: 'DbClient', isLayer: true },
      ],
    });

    const result = renderTestabilityMermaid(ir);

    expect(result).toContain('{{"UserRepo"}}');
    expect(result).toContain('{{"Logger"}}');
    expect(result).toContain('{{"DbClient"}}');
    expect(result).toContain('Requires 3 service mocks');
  });

  it('respects direction option', () => {
    const ir = makeIR({
      requiredServices: [
        { serviceId: 'UserRepo', serviceType: 'UserRepo', requiredAt: { filePath: 'test.ts', line: 1, column: 1 } },
      ],
      dependencies: [
        { name: 'UserRepo', isLayer: false },
      ],
    });

    const result = renderTestabilityMermaid(ir, { direction: 'TB' });

    expect(result).toContain('flowchart TB');
  });

  it('renders dependency edges between services with sub-dependencies', () => {
    const ir = makeIR({
      requiredServices: [
        { serviceId: 'UserRepo', serviceType: 'UserRepo', requiredAt: { filePath: 'test.ts', line: 1, column: 1 } },
        { serviceId: 'Logger', serviceType: 'Logger', requiredAt: { filePath: 'test.ts', line: 2, column: 1 } },
        { serviceId: 'DbClient', serviceType: 'DbClient', requiredAt: { filePath: 'test.ts', line: 3, column: 1 } },
      ],
      dependencies: [
        { name: 'UserRepo', isLayer: false },
        { name: 'Logger', isLayer: false },
        { name: 'DbClient', isLayer: true },
      ],
    });

    const result = renderTestabilityMermaid(ir);

    // Layer services are classified as hard (deep/infrastructure)
    expect(result).toContain('classDef easy fill:#C8E6C9');
    expect(result).toContain('classDef hard fill:#FFE0B2');
    // Non-layer services should be easy
    expect(result).toMatch(/class S[0-9],S[0-9] easy/);
    // Layer service should be hard
    expect(result).toMatch(/class S[0-9] hard/);
  });
});
