import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { analyzeProject } from './project-analyzer';

describe('analyzeProject service-map integration', () => {
  it('includes service tags declared in zero-program files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-service-map-'));

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });

      writeFileSync(
        join(srcDir, 'services.ts'),
        `
import { Context } from "effect";

export class Logger extends Context.Tag("Logger")<Logger, {
  readonly log: (msg: string) => void
}>() {}
`,
        'utf8',
      );

      writeFileSync(
        join(srcDir, 'main.ts'),
        `
import { Effect } from "effect";
import { Logger } from "./services";

export const main = Effect.gen(function* () {
  const logger = yield* Logger;
  return logger;
});
`,
        'utf8',
      );

      const result = await Effect.runPromise(
        analyzeProject(srcDir, {
          buildServiceMap: true,
          maxDepth: 3,
        }),
      );

      const serviceMap = result.serviceMap;
      expect(serviceMap).toBeDefined();

      expect(serviceMap?.services.has('Logger')).toBe(true);
      expect(serviceMap?.unresolvedServices).not.toContain('Logger');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('can attach project architecture summaries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-architecture-project-'));

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });

      writeFileSync(
        join(srcDir, 'main.ts'),
        `
import * as Runtime from "./runtime";

declare const Model: unknown;
declare const init: unknown;
declare const update: unknown;
declare const view: unknown;
declare const container: HTMLElement;

export const program = Runtime.makeProgram({
  Model,
  init,
  update,
  view,
  container,
});
`,
        'utf8',
      );

      const result = await Effect.runPromise(
        analyzeProject(srcDir, {
          buildArchitecture: true,
          maxDepth: 3,
        }),
      );

      expect(result.architecture?.runtimes).toHaveLength(1);
      expect(result.architecture?.runtimes[0]?.runtimeName).toBe('program');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
