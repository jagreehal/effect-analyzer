import { describe, expect, it } from 'vitest';
import { detectServiceCycles } from './service-cycles';
import type { ProjectServiceMap, ServiceArtifact } from './types';

const artifact = (serviceId: string, deps: readonly string[]): ServiceArtifact => ({
  serviceId,
  className: serviceId,
  definitionFilePath: '/tmp/x.ts',
  definitionLocation: { filePath: '/tmp/x.ts', line: 1, column: 1 },
  definition: { methods: [], properties: [] },
  layerImplementations: [],
  consumers: [],
  dependencies: deps,
});

describe('detectServiceCycles', () => {
  it('detects multi-node cycles', () => {
    const map: ProjectServiceMap = {
      services: new Map([
        ['A', artifact('A', ['B'])],
        ['B', artifact('B', ['C'])],
        ['C', artifact('C', ['A'])],
      ]),
      unresolvedServices: [],
      topologicalOrder: [],
    };
    const cycles = detectServiceCycles(map);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.services).toEqual(['A', 'B', 'C']);
  });

  it('detects self-loops', () => {
    const map: ProjectServiceMap = {
      services: new Map([['A', artifact('A', ['A'])]]),
      unresolvedServices: [],
      topologicalOrder: [],
    };
    const cycles = detectServiceCycles(map);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.services).toEqual(['A']);
  });

  it('returns empty for acyclic graphs', () => {
    const map: ProjectServiceMap = {
      services: new Map([
        ['A', artifact('A', ['B'])],
        ['B', artifact('B', ['C'])],
        ['C', artifact('C', [])],
      ]),
      unresolvedServices: [],
      topologicalOrder: ['C', 'B', 'A'],
    };
    expect(detectServiceCycles(map)).toEqual([]);
  });
});
