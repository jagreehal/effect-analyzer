import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// One trivial program alongside a real one. The trivial one is filtered from
// the diagram by default, and the line explaining that already respects
// `--quiet` — so a program count that does not respect it leaves the reader
// with "Found 2" above a single diagram and nothing saying why.
const SOURCE = `
import { Effect } from 'effect';
export const checkout = Effect.gen(function* () {
  yield* Effect.succeed('paid');
  yield* Effect.log('done');
});
export const refundOrder = Effect.succeed('refunded');
`;

const runCli = (root: string, extraArgs: readonly string[]) => {
  const repoRoot = resolve(__dirname, '..');
  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, 'dist/cli.js'),
      join(root, 'program.ts'),
      '--format',
      'mermaid',
      ...extraArgs,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  return { stdout: result.stdout, stderr: result.stderr };
};

describe('cli --quiet', () => {
  it('reports the program count and the trivial filter together, or neither', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-quiet-'));
    try {
      writeFileSync(join(root, 'program.ts'), SOURCE, 'utf8');

      // Without --quiet both lines appear, so the count is accounted for.
      // They belong on stderr, where they cannot corrupt a redirected diagram.
      const loud = runCli(root, []);
      expect(loud.stderr).toContain('Found 2 program(s)');
      expect(loud.stderr).toContain('trivial program(s)');
      expect(loud.stdout).not.toContain('program(s)');

      // With --quiet neither should: "minimal output" cannot mean keeping the
      // number that raises the question and dropping the answer.
      const quiet = runCli(root, ['--quiet']);
      expect(quiet.stdout).toContain('flowchart');
      expect(quiet.stderr).not.toContain('program(s)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
