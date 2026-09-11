/**
 * Regression test: `call().pipe(Effect.withSpan("x"))` is an annotation, not a
 * step. It used to emit a "Pipe (0 steps)" node between every real call, and a
 * member chain wrapped across lines used to label as `deps .fetchRate`.
 */
import { Effect } from 'effect';
import { describe, it, expect } from 'vitest';
import { flattenIR, indexIR } from './ir';
import { analyzeEffectSource } from './static-analyzer';

describe('pipe carrying only Effect.withSpan', () => {
  it(
    'collapses into the call it annotates and keeps the source name clean',
    { timeout: 20_000 },
    async () => {
      const irs = await Effect.runPromise(
        analyzeEffectSource(`
          import { Effect } from 'effect';
          declare const deps: { fetchRate: () => Effect.Effect<number, 'FAIL'> };
          export const prog = Effect.gen(function* () {
            return yield* deps
              .fetchRate()
              .pipe(Effect.withSpan('fetchRate'));
          });
        `),
      );
      const ir = irs.find((p) => p.root.programName === 'prog');
      expect(ir, 'expected a program named prog').toBeDefined();

      const nodes = flattenIR(ir!.root.children);
      expect(nodes.filter((n) => n.type === 'pipe')).toHaveLength(0);

      const call = nodes.find(
        (n) => n.type === 'effect' && n.callee.includes('fetchRate'),
      );
      expect(call).toBeDefined();
      expect(call!.type === 'effect' && call!.callee).toBe('deps.fetchRate');
      expect(call!.spanName).toBe('fetchRate');
    },
  );

  it(
    'keeps both spans when annotation pipes are chained',
    { timeout: 20_000 },
    async () => {
      const irs = await Effect.runPromise(
        analyzeEffectSource(`
          import { Effect } from 'effect';
          declare const fetchRate: () => Effect.Effect<number, 'FAIL'>;
          export const prog = Effect.gen(function* () {
            return yield* fetchRate()
              .pipe(Effect.withSpan('inner'))
              .pipe(Effect.withSpan('outer'));
          });
        `),
      );
      const ir = irs.find((p) => p.root.programName === 'prog');
      expect(ir, 'expected a program named prog').toBeDefined();

      // Both collapses land on the same base node, so the second must extend
      // the span list rather than replace it — outermost first, the order
      // `indexIR` joins ancestor paths in.
      const call = flattenIR(ir!.root.children).find(
        (n) => n.type === 'effect' && n.callee.includes('fetchRate'),
      );
      expect(call?.spanNames).toEqual(['outer', 'inner']);
      expect(call?.spanName).toBe('inner');

      const paths = [...indexIR(ir!).idsBySpanPath.keys()].map((k) =>
        k.split('\u001f'),
      );
      expect(paths).toContainEqual(['outer', 'inner']);
    },
  );
});
