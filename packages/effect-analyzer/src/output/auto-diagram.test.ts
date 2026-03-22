import { describe, it, expect } from 'vitest';
import { inferBestDiagramType } from './auto-diagram';
import type { StaticEffectIR, StaticEffectNode, StaticGeneratorNode, StaticParallelNode, StaticConditionalNode, StaticLoopNode, StaticRaceNode } from '../types';

const makeEffect = (id: string, callee: string): StaticEffectNode => ({
  type: 'effect', id, callee, name: callee,
});

const defaultStats = () => ({
  totalEffects: 0, parallelCount: 0, raceCount: 0,
  errorHandlerCount: 0, retryCount: 0, timeoutCount: 0,
  resourceCount: 0, loopCount: 0, conditionalCount: 0,
  layerCount: 0, unknownCount: 0, interruptionCount: 0,
  decisionCount: 0, switchCount: 0, tryCatchCount: 0,
  terminalCount: 0, opaqueCount: 0,
});

const makeIR = (children: any[], statsOverrides = {}): StaticEffectIR => ({
  root: {
    id: 'prog-1', type: 'program', programName: 'test',
    source: 'generator', children, dependencies: [], errorTypes: [],
  },
  metadata: {
    analyzedAt: Date.now(), filePath: 'test.ts', warnings: [],
    stats: { ...defaultStats(), ...statsOverrides },
  },
  references: new Map(),
});

describe('inferBestDiagramType', () => {
  it('returns railway for simple linear programs', () => {
    const ir = makeIR([{
      id: 'gen-1', type: 'generator',
      yields: [
        { effect: makeEffect('n1', 'a') },
        { effect: makeEffect('n2', 'b') },
      ],
    }]);
    expect(inferBestDiagramType(ir)).toBe('railway');
  });

  it('returns mermaid when parallel node exists', () => {
    const ir = makeIR([{
      id: 'p1', type: 'parallel',
      children: [makeEffect('n1', 'a'), makeEffect('n2', 'b')],
    } as StaticParallelNode], { parallelCount: 1 });
    expect(inferBestDiagramType(ir)).toBe('mermaid');
  });

  it('returns mermaid when race node exists', () => {
    const ir = makeIR([{
      id: 'r1', type: 'race',
      children: [makeEffect('n1', 'a'), makeEffect('n2', 'b')],
    } as StaticRaceNode], { raceCount: 1 });
    expect(inferBestDiagramType(ir)).toBe('mermaid');
  });

  it('returns mermaid when loop node exists', () => {
    const ir = makeIR([{
      id: 'l1', type: 'loop', loopType: 'forEach',
      body: makeEffect('n1', 'a'),
    } as StaticLoopNode], { loopCount: 1 });
    expect(inferBestDiagramType(ir)).toBe('mermaid');
  });

  it('returns mermaid when conditional exists', () => {
    const ir = makeIR([{
      id: 'c1', type: 'conditional', condition: 'x > 0',
      onTrue: makeEffect('n1', 'a'),
    } as StaticConditionalNode], { conditionalCount: 1 });
    expect(inferBestDiagramType(ir)).toBe('mermaid');
  });

  it('returns mermaid for high-complexity programs without structural nodes', () => {
    const ir = makeIR([{
      id: 'gen-1', type: 'generator',
      yields: Array.from({ length: 20 }, (_, i) => ({
        effect: makeEffect(`n${i}`, `step${i}`),
      })),
    }], { decisionCount: 5 });
    const result = inferBestDiagramType(ir);
    expect(result).toBe('mermaid');
  });

  it('returns mermaid when stats indicate switch even without IR switch node', () => {
    const ir = makeIR([{
      id: 'gen-1', type: 'generator',
      yields: [{ effect: makeEffect('n1', 'a') }],
    }], { switchCount: 1 });
    expect(inferBestDiagramType(ir)).toBe('mermaid');
  });
});
