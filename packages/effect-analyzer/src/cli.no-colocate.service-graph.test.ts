import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

describe('cli --no-colocate behavior', () => {
  it('does not write service-graph.md when --no-colocate is set', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-cli-'));
    const repoRoot = resolve(__dirname, '..');

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });

      writeFileSync(
        join(srcDir, 'services.ts'),
        `
import { Context, Layer } from "effect";

export class Logger extends Context.Tag("Logger")<Logger, {
  readonly log: (msg: string) => void
}>() {}

export const LoggerLive = Layer.succeed(Logger, {
  log: (_msg: string) => undefined
});
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

      const result = spawnSync(
        process.execPath,
        ['dist/cli.js', srcDir, '--no-colocate', '--format', 'summary', '--service-map', '--quiet'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      expect(existsSync(join(srcDir, 'service-graph.md'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
