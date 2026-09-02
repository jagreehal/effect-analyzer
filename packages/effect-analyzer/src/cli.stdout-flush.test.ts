/**
 * The CLI exits with `process.exit`, which discards whatever is still queued on
 * a piped stdout. Any JSON report larger than the pipe buffer was therefore
 * truncated mid-string — valid-looking output, unparseable, no error, non-zero
 * chance a consumer treats the short read as the whole report.
 *
 * Redirecting to a file hid it, so only a piped run reproduces it.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..');

const run = (args: readonly string[]) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });

describe('piped stdout', () => {
  it('writes a complete report when stdout is a pipe', () => {
    // The analyzer's own src is far larger than the 64KB pipe buffer.
    const result = run(['src', '--lint-source']);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(200_000);
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
  }, 300_000);

  it('writes complete diagnostics when stdout is a pipe', () => {
    const result = run(['diagnostics', '--project', 'tsconfig.json', '--format', 'json']);
    expect(result.stdout.length).toBeGreaterThan(64 * 1024);
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
  }, 300_000);
});
