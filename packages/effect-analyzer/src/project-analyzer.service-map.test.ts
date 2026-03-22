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
});
