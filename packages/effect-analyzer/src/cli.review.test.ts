/**
 * `effect-analyze review` reads a change from git and reports what it did to
 * every Effect program it touched. One repo, one commit, one edit that removes
 * an error handler and spreads onto push: the review must call the removal a
 * regression, the spread a new finding, and grade the risk high.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI = resolve(__dirname, '..', 'dist/cli.js');

const BEFORE = `
import { Effect } from "effect";

declare const load: (id: string) => Effect.Effect<number, LoadError>;
class LoadError { readonly _tag = "LoadError" }

export const fetchTotal = Effect.gen(function* () {
  const a = yield* load("a");
  const b = yield* load("b");
  return a + b;
}).pipe(Effect.catchTag("LoadError", () => Effect.succeed(0)));
`;

const AFTER = `
import { Effect } from "effect";

declare const load: (id: string) => Effect.Effect<number, LoadError>;
class LoadError { readonly _tag = "LoadError" }

export const fetchTotal = Effect.gen(function* () {
  const a = yield* load("a");
  const b = yield* load("b");
  const rest = yield* Effect.forEach(["c", "d"], load, { concurrency: 2 });
  const all: number[] = [a, b];
  all.push(...rest);
  return all.length;
});
`;

const gitIn = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.com', ...args], { cwd, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
};

describe('cli review', () => {
  it('reports regressions and new findings for the programs a change touched', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-review-'));
    try {
      gitIn(root, 'init', '-q');
      writeFileSync(join(root, 'total.ts'), BEFORE);
      gitIn(root, 'add', 'total.ts');
      gitIn(root, 'commit', '-qm', 'v1');
      writeFileSync(join(root, 'total.ts'), AFTER);
      writeFileSync(join(root, 'untouched.ts'), 'export const x = 1;');

      const md = spawnSync(process.execPath, [CLI, 'review', '--base', 'HEAD'], { cwd: root, encoding: 'utf8' });
      expect(md.status, md.stderr).toBe(0);
      expect(md.stdout).toContain('<!-- effect-analyzer-review -->');
      expect(md.stdout).toContain('🔴 High');
      expect(md.stdout).toContain('`fetchTotal`: error-handler block removed');
      expect(md.stdout).toContain('array-push-spread');
      expect(md.stdout).toContain('```mermaid');
      expect(md.stdout).toContain('Prompt for AI agents');
      expect(md.stdout).not.toContain('untouched.ts');

      const json = spawnSync(
        process.execPath,
        [CLI, 'review', '--base', 'HEAD', '--format', 'json', '--fail-on-regression'],
        { cwd: root, encoding: 'utf8' },
      );
      expect(json.status).toBe(1);
      const report = JSON.parse(json.stdout) as {
        risk: string;
        regressions: { program: string }[];
        newFindings: { rule: string; line: number }[];
        files: { path: string; programs: { name: string; kind: string }[] }[];
        markdown: string;
      };
      expect(report.risk).toBe('high');
      expect(report.regressions.map((r) => r.program)).toEqual(['fetchTotal']);
      expect(report.newFindings.map((f) => f.rule)).toEqual(['array-push-spread']);
      expect(report.newFindings[0]!.line).toBe(12);
      expect(report.files.map((f) => f.path)).toEqual(['total.ts']);
      expect(report.markdown).toBe(md.stdout.trimEnd());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('says so when no Effect program changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-review-'));
    try {
      gitIn(root, 'init', '-q');
      writeFileSync(join(root, 'a.ts'), 'export const a = 1;');
      gitIn(root, 'add', 'a.ts');
      gitIn(root, 'commit', '-qm', 'v1');
      writeFileSync(join(root, 'a.ts'), 'export const a = 2;');

      const r = spawnSync(process.execPath, [CLI, 'review'], { cwd: root, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('No Effect programs changed.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('follows a rename instead of reporting every program in the file as removed', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-review-'));
    try {
      gitIn(root, 'init', '-q');
      writeFileSync(join(root, 'total.ts'), BEFORE);
      gitIn(root, 'add', 'total.ts');
      gitIn(root, 'commit', '-qm', 'v1');
      gitIn(root, 'mv', 'total.ts', 'sum.ts');
      gitIn(root, 'commit', '-qm', 'rename');

      const r = spawnSync(process.execPath, [CLI, 'review', '--base', 'HEAD~1', '--head', 'HEAD', '--format', 'json'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      const report = JSON.parse(r.stdout) as {
        risk: string;
        regressions: unknown[];
        files: { path: string; previousPath?: string; status: string; programs: { kind: string }[] }[];
      };
      expect(report.risk).toBe('low');
      expect(report.regressions).toEqual([]);
      expect(report.files).toMatchObject([{ path: 'sum.ts', previousPath: 'total.ts', status: 'renamed' }]);
      expect(report.files[0]!.programs.map((p) => p.kind)).toEqual(['unchanged']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('restricts the change set to the given pathspecs', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-review-'));
    try {
      gitIn(root, 'init', '-q');
      mkdirSync(join(root, 'api'));
      mkdirSync(join(root, 'web'));
      writeFileSync(join(root, 'api', 'total.ts'), BEFORE);
      writeFileSync(join(root, 'web', 'total.ts'), BEFORE);
      gitIn(root, 'add', '.');
      gitIn(root, 'commit', '-qm', 'v1');
      writeFileSync(join(root, 'api', 'total.ts'), AFTER);
      writeFileSync(join(root, 'web', 'total.ts'), AFTER);

      const r = spawnSync(process.execPath, [CLI, 'review', 'api', '--format', 'json'], { cwd: root, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      const report = JSON.parse(r.stdout) as { files: { path: string }[] };
      expect(report.files.map((f) => f.path)).toEqual(['api/total.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('reads --head from git, not from the working tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-review-'));
    try {
      gitIn(root, 'init', '-q');
      writeFileSync(join(root, 'total.ts'), BEFORE);
      gitIn(root, 'add', 'total.ts');
      gitIn(root, 'commit', '-qm', 'v1');
      // Committed head is unchanged; only the working tree has the regression.
      writeFileSync(join(root, 'total.ts'), AFTER);

      const committed = spawnSync(process.execPath, [CLI, 'review', '--base', 'HEAD', '--head', 'HEAD', '--format', 'json'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(committed.status, committed.stderr).toBe(0);
      expect((JSON.parse(committed.stdout) as { files: unknown[] }).files).toEqual([]);

      const workingTree = spawnSync(process.execPath, [CLI, 'review', '--base', 'HEAD', '--format', 'json'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect((JSON.parse(workingTree.stdout) as { risk: string }).risk).toBe('high');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails clearly when a ref is not in the local object database', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-review-'));
    try {
      gitIn(root, 'init', '-q');
      writeFileSync(join(root, 'a.ts'), 'export const a = 1;');
      gitIn(root, 'add', 'a.ts');
      gitIn(root, 'commit', '-qm', 'v1');

      const r = spawnSync(process.execPath, [CLI, 'review', '--base', 'origin/nope'], { cwd: root, encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Cannot resolve 'origin/nope'");
      expect(r.stderr).toContain('git fetch origin nope');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('rejects unknown flags', () => {
    const r = spawnSync(process.execPath, [CLI, 'review', '--bogus'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown option: --bogus');
  });
});
