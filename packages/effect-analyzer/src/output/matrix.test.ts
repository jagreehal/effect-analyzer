import { describe, it, expect } from 'vitest';
import type { StaticEffectIR, ProjectServiceMap } from '../types';
import { renderDependencyMatrix, renderDependencyMatrixFromServiceMap } from './matrix';

function makeIR(programName: string): StaticEffectIR {
  return {
    root: {
      id: `program-${programName}`,
      type: 'program',
      programName,
      source: 'generator',
      children: [],
      dependencies: [],
      errorTypes: [],
    },
    metadata: {
      analyzedAt: Date.now(),
      filePath: `${programName}.ts`,
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
      },
    },
    references: new Map(),
  };
}

describe('renderDependencyMatrix', () => {
  it('reports the actual program count when no services are detected', () => {
    const out = renderDependencyMatrix([
      makeIR('alphaProgram'),
      makeIR('betaProgram'),
    ]);

    expect(out).toContain('2 programs × 0 services');
  });

  it('does not drop dependencies when program names collide', () => {
    const a = makeIR('main');
    const b = makeIR('main');

    a.root.dependencies = [
      { name: 'Logger', source: 'yield*', kind: 'service' },
    ];
    b.root.dependencies = [
      { name: 'Config', source: 'yield*', kind: 'service' },
    ];

    const out = renderDependencyMatrix([a, b]);

    // Duplicate names should still preserve the union of discovered dependencies.
    expect(out).toContain('| Program | Config | Logger |');
    expect(out).toContain('| main | ✓ | ✓ |');
  });
});

describe('renderDependencyMatrixFromServiceMap', () => {
  it('preserves actual consumer count when program names collide across files', () => {
    const serviceMap: ProjectServiceMap = {
      services: new Map([
        [
          'Logger',
          {
            serviceId: 'Logger',
            className: 'Logger',
            definitionFilePath: '/tmp/services.ts',
            definitionLocation: { filePath: '/tmp/services.ts', line: 1, column: 0 },
            definition: { tagId: 'Logger', methods: [], properties: [] },
            layerImplementations: [],
            consumers: [
              { programName: 'main', filePath: '/app/a.ts' },
            ],
            dependencies: [],
          },
        ],
        [
          'Config',
          {
            serviceId: 'Config',
            className: 'Config',
            definitionFilePath: '/tmp/services.ts',
            definitionLocation: { filePath: '/tmp/services.ts', line: 1, column: 0 },
            definition: { tagId: 'Config', methods: [], properties: [] },
            layerImplementations: [],
            consumers: [
              { programName: 'main', filePath: '/app/b.ts' },
            ],
            dependencies: [],
          },
        ],
      ]),
      unresolvedServices: [],
      topologicalOrder: ['Logger', 'Config'],
    };

    const out = renderDependencyMatrixFromServiceMap(serviceMap);

    // Both consumers exist even if their program names collide.
    expect(out).toContain('2 programs × 2 services');
  });
});
