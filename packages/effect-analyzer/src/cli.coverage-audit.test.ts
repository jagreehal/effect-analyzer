import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const makeAuditFixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'effect-audit-cli-'));
  writeFileSync(join(root, 'program.ts'), [
    'import { Effect } from "effect";',
    'export const program = Effect.succeed(1);',
  ].join('\n'));
  writeFileSync(join(root, 'types.ts'), 'export type UserId = string;\n');
  return root;
};

describe('coverage audit CLI', () => {
  it('keeps quiet mode concise and omits per-file rows', () => {
    const root = makeAuditFixture();
    try {
      const result = spawnSync(process.execPath, [
        resolve('dist/cli.js'),
        root,
        '--coverage-audit',
        '--quiet',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toHaveLength(1);
      expect(result.stdout).toContain('Effect adoption 50.0% (1/2)');
      expect(result.stdout).not.toContain('program.ts');
      expect(result.stdout).not.toContain('types.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('returns exit code 1 and a typed violation when audit policy fails', () => {
    const root = makeAuditFixture();
    try {
      const result = spawnSync(process.execPath, [
        resolve('dist/cli.js'),
        root,
        '--coverage-audit',
        '--quiet',
        '--min-audit-effect-adoption',
        '75',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Coverage audit: FAIL');
      expect(result.stdout).toContain('[effect-adoption]');
      expect(result.stdout).toContain('50.0% is below the required 75.0%');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
