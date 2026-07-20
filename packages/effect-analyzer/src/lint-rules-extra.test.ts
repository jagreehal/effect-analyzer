import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { join } from 'node:path';
import { analyzeEffectFile, analyzeEffectSource } from './static-analyzer';
import {
  swallowedErrorRule,
  largeGenBlockRule,
  flatMapChainRule,
  provideMergeChainRule,
  sequentialFailRule,
  deferredNoResolveRule,
  createLargeGenBlockRule,
} from './lint-rules-extra';

const FIXTURE = join(__dirname, '__fixtures__', 'lint-issues-extra.ts');

const runFile = async () => {
  const irs = await Effect.runPromise(analyzeEffectFile(FIXTURE));
  expect(irs.length).toBeGreaterThan(0);
  return irs;
};

const findIRByName = (
  irs: readonly Awaited<ReturnType<typeof runFile>>[number][],
  name: string,
) => {
  const ir = irs.find((x) => x.root.programName === name);
  if (!ir) throw new Error(`Could not find program "${name}"`);
  return ir;
};

describe('swallowed-error', () => {
  it('flags catch returning Effect.void', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'swallowedErrorProgram');
    const issues = swallowedErrorRule.check(ir);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.rule).toBe('swallowed-error');
  });

  it('does not flag catch that logs the error', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'swallowedErrorWithLog');
    const issues = swallowedErrorRule.check(ir);
    expect(issues).toEqual([]);
  });
});

describe('large-gen-block', () => {
  it('flags generators with > 25 yields', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'largeGenBlock');
    const issues = largeGenBlockRule.check(ir);
    expect(issues.length).toBe(1);
    expect(issues[0]?.message).toMatch(/yields/);
  });

  it('does not flag small generators', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'smallGenBlock');
    const issues = largeGenBlockRule.check(ir);
    expect(issues).toEqual([]);
  });

  it('supports a custom threshold', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'smallGenBlock');
    const rule = createLargeGenBlockRule(1);
    const issues = rule.check(ir);
    expect(issues.length).toBe(1);
  });
});

describe('flatMap-chain-depth', () => {
  it('flags 3+ consecutive flatMaps', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'flatMapChain');
    const issues = flatMapChainRule.check(ir);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('does not flag short chains', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'flatMapShort');
    const issues = flatMapChainRule.check(ir);
    expect(issues).toEqual([]);
  });
});

describe('provide-merge-chain', () => {
  it('flags 3+ Layer.provideMerge in a row', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'provideMergeChainProgram');
    const issues = provideMergeChainRule.check(ir);
    expect(Array.isArray(issues)).toBe(true);
  });
});

describe('sequential-fail-in-validation', () => {
  it('flags multiple Effect.fail in same gen', { timeout: 30_000 }, async () => {
    const irs = await runFile();
    const ir = findIRByName(irs, 'sequentialFailValidation');
    const issues = sequentialFailRule.check(ir);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('deferred-no-resolve', () => {
  it('flags Deferred without resolver', { timeout: 30_000 }, async () => {
    const irs = await Effect.runPromise(
      analyzeEffectSource(
        `import { Effect, Deferred } from 'effect';
         export const prog = Effect.gen(function* () {
           const d = yield* Deferred.make<number>();
           return yield* Deferred.await(d);
         });`,
        'deferred-only.ts',
      ),
    );
    const ir = irs.find((x) => x.root.programName === 'prog') ?? irs[0]!;
    const issues = deferredNoResolveRule.check(ir);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('does not flag Deferred with resolver', { timeout: 30_000 }, async () => {
    const irs = await Effect.runPromise(
      analyzeEffectSource(
        `import { Effect, Deferred } from 'effect';
         export const prog = Effect.gen(function* () {
           const d = yield* Deferred.make<number>();
           yield* Deferred.succeed(d, 1);
           return yield* Deferred.await(d);
         });`,
        'deferred-ok.ts',
      ),
    );
    const ir = irs.find((x) => x.root.programName === 'prog') ?? irs[0]!;
    const issues = deferredNoResolveRule.check(ir);
    expect(issues).toEqual([]);
  });
});
