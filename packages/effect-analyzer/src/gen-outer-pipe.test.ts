/**
 * Regression tests: generator programs wrapped by outer `.pipe(...)` must not
 * drop the pipe transformations. Users write `Effect.gen(...).pipe(Effect.retry(...))`
 * as often as they write `Effect.retry(Effect.gen(...), schedule)`, and both forms
 * should produce equivalent IR for pattern-detection purposes (retry count,
 * timeout count, error-handler count).
 */
import { Effect } from 'effect';
import { describe, it, expect } from 'vitest';
import { analyzeEffectSource } from './static-analyzer';

const runSource = async (src: string) =>
  Effect.runPromise(analyzeEffectSource(src));

describe('gen call wrapped by outer .pipe', () => {
  it(
    'detects Effect.retry on the outer pipe of a gen program',
    { timeout: 20_000 },
    async () => {
      const irs = await runSource(`
        import { Effect, Schedule } from 'effect';
        declare const doWork: () => Effect.Effect<string, 'FAIL'>;
        export const prog = Effect.gen(function* () {
          return yield* doWork();
        }).pipe(Effect.retry(Schedule.recurs(3)));
      `);
      expect(irs.length).toBeGreaterThanOrEqual(1);
      const ir = irs.find((p) => p.root.programName === 'prog');
      expect(ir, 'expected a program named prog').toBeDefined();
      expect(ir!.metadata.stats.retryCount).toBeGreaterThan(0);
    },
  );

  it(
    'detects Effect.retry on the outer pipe of a non-gen Effect expression',
    { timeout: 20_000 },
    async () => {
      const irs = await runSource(`
        import { Effect, Schedule } from 'effect';
        declare const doWork: () => Effect.Effect<string, 'FAIL'>;
        export const prog = Effect.gen(function* () {
          yield* doWork().pipe(Effect.retry(Schedule.recurs(3)));
        });
      `);
      expect(irs.length).toBeGreaterThanOrEqual(1);
      const ir = irs.find((p) => p.root.programName === 'prog');
      expect(ir, 'expected a program named prog').toBeDefined();
      expect(ir!.metadata.stats.retryCount).toBeGreaterThan(0);
    },
  );

  it(
    'diff surfaces when retry is removed from outer pipe',
    { timeout: 20_000 },
    async () => {
      const before = await runSource(`
        import { Effect, Schedule } from 'effect';
        declare const doWork: () => Effect.Effect<string, 'FAIL'>;
        export const prog = Effect.gen(function* () {
          return yield* doWork();
        }).pipe(Effect.retry(Schedule.recurs(3)));
      `);
      const after = await runSource(`
        import { Effect } from 'effect';
        declare const doWork: () => Effect.Effect<string, 'FAIL'>;
        export const prog = Effect.gen(function* () {
          return yield* doWork();
        });
      `);
      const beforeIr = before.find((p) => p.root.programName === 'prog');
      const afterIr = after.find((p) => p.root.programName === 'prog');
      expect(beforeIr).toBeDefined();
      expect(afterIr).toBeDefined();
      expect(beforeIr!.metadata.stats.retryCount).toBeGreaterThan(
        afterIr!.metadata.stats.retryCount,
      );
    },
  );
});
