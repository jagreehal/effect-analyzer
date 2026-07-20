import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('cli --assert-diagram-fidelity', () => {
  it('fails for a dynamic Effect v4 span name', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-fidelity-'));
    const sourceFile = join(root, 'program.ts');
    writeFileSync(sourceFile, `
      import { Effect } from "effect";
      const spanName = process.argv[2] ?? "fallback";
      export const program = Effect.succeed(1).pipe(Effect.withSpan(spanName));
    `);
    try {
      const result = spawnSync(
        process.execPath,
        [
          resolve('dist/cli.js'),
          sourceFile,
          '--assert-diagram-fidelity',
          '--include-trivial',
          '--quiet',
        ],
        { encoding: 'utf8' },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('dynamic-span-name');
      expect(result.stderr).toContain('Diagram fidelity assertion failed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
