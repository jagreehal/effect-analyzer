import { describe, it, expect } from 'vitest';
import { Effect, Option } from 'effect';
import { analyze } from './analyze';
import type { StaticFlowNode, StaticEffectProgram } from './types';
import { getStaticChildren, isStaticLoopNode } from './types';
import { analyzeEffectSource } from './static-analyzer';
import { diffPrograms } from './diff/diff-engine';
import path from 'node:path';

const fixturePath = path.join(__dirname, '__fixtures__', 'quality-fixes.ts');

function walkNodes(node: StaticFlowNode | StaticEffectProgram): (StaticFlowNode | StaticEffectProgram)[] {
  const results: (StaticFlowNode | StaticEffectProgram)[] = [node];
  const kids = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
  for (const child of kids) {
    results.push(...walkNodes(child));
  }
  return results;
}

describe('Quality fixes', () => {
  describe('Issue 1: Schema.decodeUnknown should not be a loop', () => {
    it('parses Schema.decodeUnknown as an effect node, not a loop', { timeout: 20_000 }, async () => {
      const irs = await Effect.runPromise(analyze(fixturePath).named('validateUser'));
      const allNodes = walkNodes(irs.root);
      const loops = allNodes.filter((n) => isStaticLoopNode(n));
      expect(loops.length).toBe(0);
    });

    it('parses Schema.decode as an effect node, not a loop', { timeout: 20_000 }, async () => {
      const irs = await Effect.runPromise(analyze(fixturePath).named('validateUserDecode'));
      const allNodes = walkNodes(irs.root);
      const loops = allNodes.filter((n) => isStaticLoopNode(n));
      expect(loops.length).toBe(0);
    });
  });

  describe('Issue 2: yield* calls should produce named steps', () => {
    it('extracts variable names as step names from yield* assignments', { timeout: 20_000 }, async () => {
      const irs = await Effect.runPromise(analyze(fixturePath).named('namedStepsProgram'));
      expect(irs.root.type).toBe('program');
      const generator = irs.root.children.find((c) => c.type === 'generator');
      expect(generator).toBeDefined();
      if (!generator) return;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- narrowing for TS
      if (generator.type !== 'generator') return;
      const yields = generator.yields;
      expect(yields[0]?.variableName).toBe('config');
      expect(yields[1]?.variableName).toBe('response');
      expect(yields[2]?.variableName).toBe('data');
      for (const y of yields) {
        expect(y.effect.displayName).toBeDefined();
        if (y.variableName) {
          expect(y.effect.displayName).toContain(y.variableName);
        }
      }
    });
  });

  describe('Issue 3: Effect.withSpan should annotate parent', () => {
    it('merges withSpan into parent effect as spanName annotation', { timeout: 20_000 }, async () => {
      const irs = await Effect.runPromise(analyze(fixturePath).named('spanAnnotatedProgram'));
      const allNodes = walkNodes(irs.root);
      // Should have a spanName annotation somewhere
      const hasSpanAnnotation = allNodes.some((n) => 'spanName' in n && n.spanName === 'my-operation');
      // The withSpan should not appear as a standalone effect callee
      const withSpanNodes = allNodes.filter(
        (n) => n.type === 'effect' && 'callee' in n && (n.callee as string).includes('withSpan'),
      );
      expect(withSpanNodes.length).toBe(0);
      expect(hasSpanAnnotation).toBe(true);
    });
  });

  describe('Issue 5: Labels should not be verbose', () => {
    it('truncates long iterSource and argument labels', { timeout: 20_000 }, async () => {
      const irs = await Effect.runPromise(analyze(fixturePath).named('verboseLabelsProgram'));
      const allNodes = walkNodes(irs.root);
      const names = allNodes
        .map((n) => ('displayName' in n ? n.displayName : undefined))
        .filter((n): n is string => typeof n === 'string');
      for (const name of names) {
        expect(name.length).toBeLessThanOrEqual(60);
      }
    });
  });

  describe('Issue 6: Diff should use stable IDs', () => {
    // `stepsAdded` counts unmatched effect steps after fingerprint + container passes.
    // After fixing duplicate yield counting (direct yield* calls are no longer re-added
    // by the non-yielded scanner), the diff correctly detects 1 new step.
    it('produces stable diffs when a step is added', { timeout: 20_000 }, async () => {
      const [before] = await Effect.runPromise(analyzeEffectSource(`
        import { Effect } from "effect";
        export const workflow = Effect.gen(function* () {
          const a = yield* Effect.succeed(1);
          const b = yield* Effect.succeed(2);
          return a + b;
        });
      `));
      const [after] = await Effect.runPromise(analyzeEffectSource(`
        import { Effect } from "effect";
        export const workflow = Effect.gen(function* () {
          const a = yield* Effect.succeed(1);
          const extra = yield* Effect.succeed(99);
          const b = yield* Effect.succeed(2);
          return a + extra + b;
        });
      `));
      const diff = diffPrograms(before!, after!);
      expect(diff.summary.stepsAdded).toBe(1);
      expect(diff.summary.stepsRemoved).toBe(0);
      expect(diff.summary.stepsRenamed).toBe(0);
    });
  });

  describe('Issue 8: Multi-withSpan and chained pipe', () => {
    it('does not leave standalone withSpan callees for sequential span steps', { timeout: 20_000 }, async () => {
      const irs = await Effect.runPromise(analyze(fixturePath).named('multiSpanProgram'));
      const allNodes = walkNodes(irs.root);
      const withSpanNodes = allNodes.filter(
        (n) => n.type === 'effect' && 'callee' in n && (n.callee as string).includes('withSpan'),
      );
      expect(withSpanNodes.length).toBe(0);
    });

    it('chains pipe(withSpan, withSpan) without standalone withSpan effect nodes', { timeout: 20_000 }, async () => {
      const irs = await Effect.runPromise(analyze(fixturePath).named('chainedWithSpanProgram'));
      const allNodes = walkNodes(irs.root);
      const withSpanNodes = allNodes.filter(
        (n) => n.type === 'effect' && 'callee' in n && (n.callee as string).includes('withSpan'),
      );
      expect(withSpanNodes.length).toBe(0);
    });
  });

  describe('Issue 7: Repeated callees should not cause spurious renames', () => {
    it('handles repeated callees without spurious renames', { timeout: 20_000 }, async () => {
      const [before] = await Effect.runPromise(analyzeEffectSource(`
        import { Effect } from "effect";
        export const workflow = Effect.gen(function* () {
          const a = yield* Effect.succeed("first");
          const b = yield* Effect.succeed("second");
          const c = yield* Effect.succeed("third");
          return { a, b, c };
        });
      `));
      const [after] = await Effect.runPromise(analyzeEffectSource(`
        import { Effect } from "effect";
        export const workflow = Effect.gen(function* () {
          const a = yield* Effect.succeed("first");
          const b = yield* Effect.succeed("second");
          const extra = yield* Effect.succeed("inserted");
          const c = yield* Effect.succeed("third");
          return { a, b, c, extra };
        });
      `));
      const diff = diffPrograms(before!, after!);
      // Should not have any removed or renamed steps
      expect(diff.summary.stepsRemoved).toBe(0);
      expect(diff.summary.stepsRenamed).toBe(0);
    });
  });
});
