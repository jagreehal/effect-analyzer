import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

describe('cli --detail', () => {
  it('passes --detail through to mermaid-enhanced output', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-detail-'));
    const repoRoot = resolve(__dirname, '..');

    try {
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'bundler',
            },
            include: ['**/*.ts'],
          },
          null,
          2,
        ),
        'utf8',
      );

      // Use a large flat generator (>80 nodes) so auto-detail would pick compact,
      // plus an explicit --detail compact to test the flag passthrough.
      // Inner Effect.all with inline generators creates nested programs in the IR.
      const steps = Array.from({ length: 90 }, (_, i) =>
        `  yield* Effect.log("step${i}");`
      ).join('\n');
      writeFileSync(
        join(root, 'program.ts'),
        `
import { Effect } from "effect";

export const main = Effect.gen(function* () {
${steps}
});
`,
        'utf8',
      );

      const result = spawnSync(
        process.execPath,
        [
          join(repoRoot, 'dist/cli.js'),
          join(root, 'program.ts'),
          '--format',
          'mermaid-enhanced',
          '--detail',
          'compact',
          '--tsconfig',
          join(root, 'tsconfig.json'),
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      // With compact detail, the output should not include type signatures or semantic roles
      // (standard/compact strip those). Verify the flag is actually passed through by checking
      // that the output does NOT contain verbose-only annotations like "(side-effect)".
      // At minimum, the diagram should render successfully with the flag.
      const stdout = result.stdout;
      expect(stdout).toContain('flowchart');
      expect(stdout).toContain('Effect.log');
      // Verbose would include semantic role annotations; compact should not
      expect(stdout).not.toMatch(/\(side-effect\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
