import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SOURCE = `
import { Effect } from "effect";

export const myProgram = Effect.gen(function* () {
  const a = yield* Effect.succeed(1);
  const b = yield* Effect.sync(() => a + 1);
  return b;
});
`;

const runCli = (repoRoot: string, args: readonly string[]) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

describe('cli --test stub generation', () => {
  it('writes a vitest stub next to the source for each program', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-test-stubs-'));
    const repoRoot = resolve(__dirname, '..');

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      const sourceFile = join(srcDir, 'feature.ts');
      writeFileSync(sourceFile, SOURCE, 'utf8');

      const result = runCli(repoRoot, [sourceFile, '--test', '--quiet', '--no-metadata']);
      expect(result.status).toBe(0);

      const stubPath = join(srcDir, 'myProgram.test.ts');
      expect(existsSync(stubPath)).toBe(true);

      const content = readFileSync(stubPath, 'utf8');
      expect(content).toContain("import { describe, it, expect } from 'vitest'");
      expect(content).toContain("describe('myProgram'");
      expect(content).toMatch(/it\('should/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('emits jest-flavored stubs with --test-runner=jest', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-test-stubs-'));
    const repoRoot = resolve(__dirname, '..');

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      const sourceFile = join(srcDir, 'feature.ts');
      writeFileSync(sourceFile, SOURCE, 'utf8');

      const result = runCli(repoRoot, [sourceFile, '--test', '--test-runner=jest', '--quiet']);
      expect(result.status).toBe(0);

      const content = readFileSync(join(srcDir, 'myProgram.test.ts'), 'utf8');
      expect(content).toContain('// Jest test file');
      expect(content).not.toContain("from 'vitest'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('skips an existing test file and overwrites only with --test-overwrite', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-test-stubs-'));
    const repoRoot = resolve(__dirname, '..');

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      const sourceFile = join(srcDir, 'feature.ts');
      writeFileSync(sourceFile, SOURCE, 'utf8');

      const stubPath = join(srcDir, 'myProgram.test.ts');
      writeFileSync(stubPath, '// user-authored\nexport {};\n', 'utf8');

      const skipResult = runCli(repoRoot, [sourceFile, '--test', '--quiet']);
      expect(skipResult.status).toBe(0);
      expect(readFileSync(stubPath, 'utf8')).toContain('user-authored');

      const overwriteResult = runCli(repoRoot, [
        sourceFile,
        '--test',
        '--test-overwrite',
        '--quiet',
      ]);
      expect(overwriteResult.status).toBe(0);
      expect(readFileSync(stubPath, 'utf8')).toContain("describe('myProgram'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects an invalid test runner with exit code 1', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-test-stubs-'));
    const repoRoot = resolve(__dirname, '..');

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      const sourceFile = join(srcDir, 'feature.ts');
      writeFileSync(sourceFile, SOURCE, 'utf8');

      const result = runCli(repoRoot, [sourceFile, '--test', '--test-runner=ava']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Unknown test runner: ava');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
