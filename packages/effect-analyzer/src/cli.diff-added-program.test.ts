import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

describe('cli --diff program matching', () => {
  it('reports programs added in the working tree, not just programs present in both versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-diff-'));
    const repoRoot = resolve(__dirname, '..');

    try {
      const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
      expect(init.status).toBe(0);

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

      writeFileSync(
        join(root, 'program.ts'),
        `
import { Effect } from "effect";

export const existing = Effect.succeed(1);
`,
        'utf8',
      );

      const add = spawnSync('git', ['add', 'tsconfig.json', 'program.ts'], { cwd: root, encoding: 'utf8' });
      expect(add.status).toBe(0);
      const commit = spawnSync(
        'git',
        ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'],
        { cwd: root, encoding: 'utf8' },
      );
      expect(commit.status).toBe(0);

      writeFileSync(
        join(root, 'program.ts'),
        `
import { Effect } from "effect";

export const existing = Effect.succeed(1);
export const added = Effect.fail("boom");
`,
        'utf8',
      );

      const result = spawnSync(
        process.execPath,
        [join(repoRoot, 'dist/cli.js'), 'program.ts', '--diff'],
        {
          cwd: root,
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('added');
      expect(result.stdout).toContain('Effect.fail');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('accepts git ref:path sources without trying to stat the literal ref selector', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-diff-'));
    const repoRoot = resolve(__dirname, '..');

    try {
      const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
      expect(init.status).toBe(0);

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

      writeFileSync(
        join(root, 'program.ts'),
        `
import { Effect } from "effect";

export const existing = Effect.succeed(1);
`,
        'utf8',
      );

      const add = spawnSync('git', ['add', 'tsconfig.json', 'program.ts'], { cwd: root, encoding: 'utf8' });
      expect(add.status).toBe(0);
      const commit = spawnSync(
        'git',
        ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'],
        { cwd: root, encoding: 'utf8' },
      );
      expect(commit.status).toBe(0);

      writeFileSync(
        join(root, 'program.ts'),
        `
import { Effect } from "effect";

export const existing = Effect.fail("boom");
`,
        'utf8',
      );

      const result = spawnSync(
        process.execPath,
        [join(repoRoot, 'dist/cli.js'), 'HEAD:program.ts', 'program.ts', '--diff'],
        {
          cwd: root,
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('Path not found');
      expect(result.stdout).toContain('existing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
