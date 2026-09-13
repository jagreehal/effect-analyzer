import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SOURCE = `
import { Data, Effect } from 'effect';

class NotFound extends Data.TaggedError('NOT_FOUND')<{ readonly id: string }> {}

const getUser = (id: string): Effect.Effect<{ id: string }, NotFound> =>
  Effect.succeed({ id });

export const fetchUser = Effect.gen(function* () {
  const user = yield* getUser('1');
  return user;
});
`;

const runCli = (file: string, extraArgs: readonly string[] = []) => {
  const repoRoot = resolve(__dirname, '..');
  return spawnSync(
    process.execPath,
    [join(repoRoot, 'dist/cli.js'), file, ...extraArgs],
    { cwd: repoRoot, encoding: 'utf8' },
  );
};

describe('cli single-file adjacent markdown', () => {
  it('writes colocated markdown by default and still prints the diagram', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-colocate-'));
    const file = join(root, 'program.ts');
    try {
      writeFileSync(file, SOURCE, 'utf8');
      const result = runCli(file, ['--quiet']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('flowchart');
      expect(result.stdout).not.toContain('{ user');
      const written = join(root, 'program.effect-analysis.md');
      expect(existsSync(written)).toBe(true);
      expect(readFileSync(written, 'utf8')).toContain('flowchart');
      expect(readFileSync(written, 'utf8')).not.toContain('# Effect Analysis: {');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('skips the adjacent file with --no-colocate', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-nocolocate-'));
    const file = join(root, 'program.ts');
    try {
      writeFileSync(file, SOURCE, 'utf8');
      const result = runCli(file, ['--no-colocate', '--quiet']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('flowchart');
      expect(existsSync(join(root, 'program.effect-analysis.md'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
