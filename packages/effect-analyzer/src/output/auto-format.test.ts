import { describe, it, expect } from 'vitest';
import { selectFormats, type FormatSelection } from './auto-format';
import type { StaticEffectIR, StaticEffectNode, StaticGeneratorNode, StaticFlowNode } from '../types';

function makeEffectNode(id: string, callee: string): StaticEffectNode {
  return { id, type: 'effect', callee };
}

function makeGeneratorNode(id: string, count: number): StaticGeneratorNode {
  const yields = Array.from({ length: count }, (_, i) => ({
    effect: makeEffectNode(`e${i}`, `step${i}`),
  }));
  return { id, type: 'generator', yields };
}

function makeIR(children: StaticFlowNode[]): StaticEffectIR {
  return {
    root: {
      id: 'program-1',
      type: 'program',
      programName: 'testProgram',
      source: 'generator',
      children,
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
      },
    },
    references: new Map(),
  };
}

describe('selectFormats', () => {
  it('returns mermaid baseline for small programs (<30 nodes)', () => {
    const ir = makeIR([makeGeneratorNode('gen', 10)]);
    const formats = selectFormats(ir);
    expect(formats[0].format).toMatch(/^mermaid/);
    expect(formats[0].detail).toBeUndefined();
    expect(formats.every(f => f.format !== 'explain')).toBe(true);
  });

  it('includes explain for medium programs (30-80 nodes)', () => {
    const ir = makeIR([makeGeneratorNode('gen', 40)]);
    const formats = selectFormats(ir);
    expect(formats[0]).toEqual({ format: 'explain' });
    const mermaidFmt = formats.find(f => f.format === 'mermaid' || f.format === 'mermaid-railway');
    expect(mermaidFmt).toBeDefined();
    expect(mermaidFmt!.detail).toBe('standard');
  });

  it('includes explain with compact mermaid for large programs (>80 nodes)', () => {
    const ir = makeIR([makeGeneratorNode('gen', 90)]);
    const formats = selectFormats(ir);
    expect(formats[0]).toEqual({ format: 'explain' });
    const mermaidFmt = formats.find(f => f.format === 'mermaid' || f.format === 'mermaid-railway');
    expect(mermaidFmt).toBeDefined();
    expect(mermaidFmt!.detail).toBe('compact');
  });

  it('returns FormatSelection objects (not plain strings)', () => {
    const ir = makeIR([makeGeneratorNode('gen', 5)]);
    const formats = selectFormats(ir);
    for (const f of formats) {
      expect(f).toHaveProperty('format');
    }
  });
});
