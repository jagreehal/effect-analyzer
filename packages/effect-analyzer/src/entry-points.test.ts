import { describe, it, expect } from 'vitest';
import { analyzeEntryPointsSource } from './entry-points';

describe('entry-points', () => {
  it('detects NodeRuntime.runMain at module scope', () => {
    const report = analyzeEntryPointsSource(
      `import { Effect } from 'effect';
       import { NodeRuntime } from '@effect/platform-node';
       const main = Effect.succeed(1);
       NodeRuntime.runMain(main);`,
    );
    expect(report.entryPoints).toHaveLength(1);
    expect(report.entryPoints[0]?.kind).toBe('NodeRuntime.runMain');
    expect(report.entryPoints[0]?.isTopLevel).toBe(true);
  });

  it('detects BunRuntime.runMain', () => {
    const report = analyzeEntryPointsSource(
      `import { Effect } from 'effect';
       import { BunRuntime } from '@effect/platform-bun';
       BunRuntime.runMain(Effect.succeed(1));`,
    );
    expect(report.entryPoints[0]?.kind).toBe('BunRuntime.runMain');
  });

  it('detects Layer.launch', () => {
    const report = analyzeEntryPointsSource(
      `import { Layer } from 'effect';
       import { NodeRuntime } from '@effect/platform-node';
       declare const ServerLive: Layer.Layer<never>;
       NodeRuntime.runMain(Layer.launch(ServerLive));`,
    );
    const kinds = report.entryPoints.map((e) => e.kind);
    expect(kinds).toContain('Layer.launch');
    expect(kinds).toContain('NodeRuntime.runMain');
  });

  it('detects Effect.runPromise at module scope but flags nested as non-top-level', () => {
    const report = analyzeEntryPointsSource(
      `import { Effect } from 'effect';
       Effect.runPromise(Effect.succeed(1));
       export function later() {
         return Effect.runPromise(Effect.succeed(2));
       }`,
    );
    const top = report.entryPoints.find((e) => e.isTopLevel);
    const nested = report.entryPoints.find((e) => !e.isTopLevel);
    expect(top?.kind).toBe('Effect.runPromise');
    expect(nested?.kind).toBe('Effect.runPromise');
  });

  it('returns empty when no entry-point patterns found', () => {
    const report = analyzeEntryPointsSource(
      `import { Effect } from 'effect';
       export const program = Effect.succeed(1);`,
    );
    expect(report.entryPoints).toEqual([]);
  });

  it('captures arg text (truncated to 120 chars)', () => {
    const longArg = 'x'.repeat(150);
    const report = analyzeEntryPointsSource(
      `import { Effect } from 'effect';
       Effect.runPromise(${longArg});`,
    );
    expect(report.entryPoints[0]?.argText?.length).toBeLessThanOrEqual(121);
    expect(report.entryPoints[0]?.argText?.endsWith('…')).toBe(true);
  });
});
