import { describe, it, expect } from 'vitest';
import { Effect, Option } from 'effect';
import { resolve } from 'path';
import { analyze } from './analyze';
import { getStaticChildren, isStaticEffectNode, type StaticFlowNode } from './types';
import { renderMermaid } from './output/mermaid';

const fixturesDir = resolve(__dirname, '__fixtures__');
const kitchenSinkPath = resolve(fixturesDir, 'kitchen-sink.ts');

function collectNodeTypes(nodes: readonly StaticFlowNode[]): Set<StaticFlowNode['type']> {
  const types = new Set<StaticFlowNode['type']>();
  const walk = (list: readonly StaticFlowNode[]) => {
    for (const node of list) {
      types.add(node.type);
      const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
      if (children.length > 0) walk(children);
    }
  };
  walk(nodes);
  return types;
}

describe('kitchen-sink regression (improve.md P0)', () => {
  it(
    'keeps broad pattern-family coverage for Effect.ts-style analysis',
    { timeout: 20_000 },
    async () => {
    const irs = await Effect.runPromise(analyze(kitchenSinkPath).all());
    expect(irs.length).toBeGreaterThanOrEqual(12);

    const names = new Set(irs.map((ir) => ir.root.programName));
    expect(names.has('genWithServices')).toBe(true);
    expect(names.has('parallelProgram')).toBe(true);
    expect(names.has('raceProgram')).toBe(true);
    expect(names.has('streamProgram')).toBe(true);
    expect(names.has('resourceProgram')).toBe(true);
    expect(names.has('conditionalProgram')).toBe(true);
    expect(names.has('loopProgram')).toBe(true);
    expect(names.has('AppLayer')).toBe(true);
    expect(names.has('Logger')).toBe(true);
    expect(names.has('Config')).toBe(true);

    const allTypes = new Set<StaticFlowNode['type']>();
    for (const ir of irs) {
      const types = collectNodeTypes(ir.root.children);
      for (const t of types) allTypes.add(t);
    }

    expect(allTypes.has('parallel')).toBe(true);
    expect(allTypes.has('race')).toBe(true);
    expect(allTypes.has('loop')).toBe(true);
    expect(allTypes.has('conditional')).toBe(true);
    expect(allTypes.has('stream')).toBe(true);
    expect(allTypes.has('resource')).toBe(true);
    expect(allTypes.has('layer')).toBe(true);

    const hasServiceCall = irs.some((ir) => {
      const stack = [...ir.root.children];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        if (isStaticEffectNode(node) && node.semanticRole === 'service-call') {
          return true;
        }
        const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
        stack.push(...children);
      }
      return false;
    });
    expect(hasServiceCall).toBe(true);

    const resourceProgram = irs.find((ir) => ir.root.programName === 'resourceProgram');
    expect(resourceProgram).toBeDefined();
    if (resourceProgram) {
      const stack = [...resourceProgram.root.children];
      let sawMissingAcquire = false;
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        if (
          node.type === 'unknown' &&
          typeof node.reason === 'string' &&
          node.reason.includes('Missing acquire')
        ) {
          sawMissingAcquire = true;
          break;
        }
        const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
        stack.push(...children);
      }
      expect(sawMissingAcquire).toBe(false);
    }

    const genWithServices = irs.find((ir) => ir.root.programName === 'genWithServices');
    expect(genWithServices).toBeDefined();
    if (genWithServices) {
      const mermaid = await Effect.runPromise(renderMermaid(genWithServices, { direction: 'TB' }));
      // Type signatures are omitted when displayName is present (avoids duplication)
      // Semantic role annotation should still be present
      expect(mermaid).toContain('(side-effect)');
    }
  });
});
