import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SOURCE = (name: string) => `
import { Effect } from 'effect';
export const ${name} = Effect.gen(function* () {
  yield* Effect.succeed('ok');
  yield* Effect.log('done');
});
`;

let root: string;

const cli = resolve(__dirname, '..', 'dist', 'cli.js');

const runCli = (args: readonly string[]) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'effect-analyze-multi-'));
  mkdirSync(join(root, 'src', 'nested'), { recursive: true });
  writeFileSync(
    join(root, 'tsconfig.json'),
    '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler","strict":true}}',
    'utf8',
  );
  writeFileSync(join(root, 'src', 'checkout.ts'), SOURCE('checkout'), 'utf8');
  writeFileSync(join(root, 'src', 'refund.ts'), SOURCE('refund'), 'utf8');
  writeFileSync(join(root, 'src', 'nested', 'ship.ts'), SOURCE('ship'), 'utf8');
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('cli multiple paths', () => {
  it('analyzes every path a shell expanded, not just the first', () => {
    const result = runCli([
      join('src', 'checkout.ts'),
      join('src', 'refund.ts'),
      '--format',
      'mermaid',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('checkout.ts');
    expect(result.stderr).toContain('refund.ts');
    expect(result.stdout.match(/flowchart/g)).toHaveLength(2);
    // Redirecting stdout has to give a file that parses, so no status text.
    expect(result.stdout).not.toContain('Analyzing');
  });

  it('expands a quoted glob itself, recursively', () => {
    const result = runCli(['src/**/*.ts', '--format', 'mermaid', '--quiet']);

    expect(result.status).toBe(0);
    expect(result.stdout.match(/flowchart/g)).toHaveLength(3);
  });

  it('prints one JSON document for the whole run', () => {
    const result = runCli([
      join('src', 'checkout.ts'),
      join('src', 'refund.ts'),
      '--format',
      'json',
    ]);

    expect(result.status).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('fails when a pattern matches nothing', () => {
    const result = runCli(['src/**/*.missing', '--format', 'mermaid']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No files matched: src/**/*.missing');
  });

  it('refuses a mode that cannot mean anything over a list', () => {
    const result = runCli([
      join('src', 'checkout.ts'),
      join('src', 'refund.ts'),
      '--format',
      'mermaid',
      '-o',
      'out.mmd',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--output writes one file');
  });

  it('refuses extra paths for a mode that reads one path', () => {
    const result = runCli([
      join('src', 'checkout.ts'),
      join('src', 'refund.ts'),
      '--agent-report',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Expected one path, received 2');
  });

  it('still sends a lone directory through project mode', () => {
    const result = runCli(['src', '--format', 'mermaid', '--quiet', '--no-colocate']);

    expect(result.status).toBe(0);
  });
});
