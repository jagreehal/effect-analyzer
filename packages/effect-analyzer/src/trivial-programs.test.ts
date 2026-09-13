import { describe, expect, it } from 'vitest';
import { isTrivialProgram } from './trivial-programs';
import type { StaticEffectIR, StaticEffectNode } from './types';

const stats = {
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
};

const ir = (
  source: StaticEffectIR['root']['source'],
  children: StaticEffectIR['root']['children'] = [],
): StaticEffectIR => ({
  root: {
    id: 'p',
    type: 'program',
    programName: 'p',
    source,
    children,
    dependencies: [],
    errorTypes: [],
  },
  metadata: { analyzedAt: 0, filePath: 't.ts', stats },
  references: new Map(),
});

describe('isTrivialProgram', () => {
  it('treats Effect.runPromise entrypoints as trivial', () => {
    expect(isTrivialProgram(ir('run', [{
      id: 'n1',
      type: 'effect',
      callee: 'Effect.runPromise',
    } as StaticEffectNode]))).toBe(true);
  });

  it('keeps a generator workflow', () => {
    expect(isTrivialProgram(ir('generator', [{
      id: 'g',
      type: 'generator',
      yields: [],
    } as StaticEffectIR['root']['children'][number]]))).toBe(false);
  });
});
