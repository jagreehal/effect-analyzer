import { describe, it, expect } from 'vitest';
import { renderServicesMermaid, renderServicesMermaidFromMap } from './output/mermaid-services';
import type {
  StaticEffectIR,
  StaticEffectNode,
  StaticGeneratorNode,
  ProjectServiceMap,
  ServiceArtifact,
  ServiceRequirement,
  SourceLocation,
} from './types';

const loc: SourceLocation = { file: 'test.ts', line: 1, column: 0 };

const makeNode = (
  overrides: Partial<StaticEffectNode> & { id: string; callee: string },
): StaticEffectNode => ({
  type: 'effect',
  name: overrides.callee,
  ...overrides,
});

const makeIR = (
  effects: StaticEffectNode[],
  programName = 'TestProgram',
): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName,
    source: 'generator',
    children: [
      {
        id: 'gen-1',
        type: 'generator',
        yields: effects.map((e) => ({ effect: e })),
      } as StaticGeneratorNode,
    ],
    dependencies: [],
    errorTypes: [],
  },
  metadata: {
    analyzedAt: Date.now(),
    filePath: 'test.ts',
    stats: {
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
    },
  },
  references: new Map(),
});

describe('renderServicesMermaid', () => {
  it('renders required services as hexagon nodes with requires edges', () => {
    const ir = makeIR([
      makeNode({
        id: 'n1',
        callee: 'UserRepo.findById',
        requiredServices: [
          { serviceId: 'UserRepo', serviceType: 'UserRepo', requiredAt: loc },
        ],
      }),
      makeNode({
        id: 'n2',
        callee: 'EmailService.send',
        requiredServices: [
          { serviceId: 'EmailService', serviceType: 'EmailService', requiredAt: loc },
        ],
      }),
    ]);

    const result = renderServicesMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('prog[');
    expect(result).toContain('UserRepo');
    expect(result).toContain('EmailService');
    expect(result).toContain('-->|requires|');
    // Hexagon shape
    expect(result).toMatch(/svc_\w+\{\{"/);
  });

  it('renders graceful output when no services exist', () => {
    const ir = makeIR([
      makeNode({ id: 'n1', callee: 'Effect.succeed' }),
    ]);

    const result = renderServicesMermaid(ir);

    expect(result).toContain('flowchart LR');
    expect(result).toContain('No services');
  });

  it('respects direction option', () => {
    const ir = makeIR([
      makeNode({
        id: 'n1',
        callee: 'UserRepo.findById',
        requiredServices: [
          { serviceId: 'UserRepo', serviceType: 'UserRepo', requiredAt: loc },
        ],
      }),
    ]);

    const resultTB = renderServicesMermaid(ir, { direction: 'TB' });
    expect(resultTB).toContain('flowchart TB');

    const resultLR = renderServicesMermaid(ir, { direction: 'LR' });
    expect(resultLR).toContain('flowchart LR');
  });
});

describe('renderServicesMermaidFromMap', () => {
  it('renders service dependencies as edges between hexagon nodes', () => {
    const services = new Map<string, ServiceArtifact>([
      [
        'UserRepo',
        {
          serviceId: 'UserRepo',
          className: 'UserRepo',
          definitionFilePath: 'user-repo.ts',
          definitionLocation: loc,
          definition: { methods: [{ name: 'findById', parameters: [], returnType: 'Effect<User>' }], properties: [] },
          layerImplementations: [
            { name: 'UserRepoLive', provides: 'UserRepo', requires: ['Database'], filePath: 'user-repo.ts', location: loc },
          ],
          consumers: [],
          dependencies: ['Database'],
        } as ServiceArtifact,
      ],
      [
        'Database',
        {
          serviceId: 'Database',
          className: 'Database',
          definitionFilePath: 'database.ts',
          definitionLocation: loc,
          definition: { methods: [{ name: 'query', parameters: [], returnType: 'Effect<Result>' }], properties: [] },
          layerImplementations: [],
          consumers: [],
          dependencies: [],
        } as ServiceArtifact,
      ],
    ]);

    const serviceMap: ProjectServiceMap = {
      services,
      unresolvedServices: [],
      topologicalOrder: ['Database', 'UserRepo'],
    };

    const result = renderServicesMermaidFromMap(serviceMap);

    expect(result).toContain('flowchart TB');
    expect(result).toContain('UserRepo');
    expect(result).toContain('Database');
    // Edge from UserRepo to Database via layer
    expect(result).toContain('-->');
    // Hexagon shape
    expect(result).toMatch(/\{\{"/);
  });

  it('renders unresolved services with dashed styling', () => {
    const services = new Map<string, ServiceArtifact>([
      [
        'UserRepo',
        {
          serviceId: 'UserRepo',
          className: 'UserRepo',
          definitionFilePath: 'user-repo.ts',
          definitionLocation: loc,
          definition: { methods: [], properties: [] },
          layerImplementations: [
            { name: 'UserRepoLive', provides: 'UserRepo', requires: ['ExternalApi'], filePath: 'user-repo.ts', location: loc },
          ],
          consumers: [],
          dependencies: ['ExternalApi'],
        } as ServiceArtifact,
      ],
    ]);

    const serviceMap: ProjectServiceMap = {
      services,
      unresolvedServices: ['ExternalApi'],
      topologicalOrder: ['UserRepo'],
    };

    const result = renderServicesMermaidFromMap(serviceMap);

    expect(result).toContain('ExternalApi');
    expect(result).toContain('unresolved');
    expect(result).toContain('stroke-dasharray');
  });
});
