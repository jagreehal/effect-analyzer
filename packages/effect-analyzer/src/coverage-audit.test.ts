/**
 * Coverage audit tests: audit API shape and behaviour using local temp dirs and fixtures.
 * No tests run against external repos (e.g. Effect repo) or baseline files.
 */

import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCoverageAudit } from './project-analyzer';

describe('Coverage audit', () => {
  it(
    'classifies non-Effect TS files as zero-program outcomes (not failures)',
    { timeout: 15_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'effectjs-audit-'));
      try {
        writeFileSync(
          join(dir, 'has-effect.ts'),
          [
            'import { Effect } from "effect";',
            'export const program = Effect.succeed(1);',
            '',
          ].join('\n'),
          'utf-8',
        );
        writeFileSync(
          join(dir, 'no-effect.ts'),
          [
            'export const answer = 42;',
            'export const greet = (name: string) => `hi ${name}`;',
            '',
          ].join('\n'),
          'utf-8',
        );

        const audit = await Effect.runPromise(
          runCoverageAudit(dir, { extensions: ['.ts'], maxDepth: 2 }),
        );

        expect(audit.discovered).toBe(2);
        expect(audit.analyzed).toBe(1);
        expect(audit.zeroPrograms).toBe(1);
        expect(audit.failed).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('Corpus regression / benchmark shape', () => {
  it('produces audit result with benchmark JSON shape (discovered, analyzed, analyzableCoverage, unknownNodeRate, suspiciousZerosCount)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchmark-shape-'));
    const tsconfigPath = join(dir, 'tsconfig.json');
    const appPath = join(dir, 'app.ts');
    try {
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(appPath, [
        'import { Effect } from "effect";',
        'export const program = Effect.succeed(1);',
      ].join('\n'));

      const audit = await Effect.runPromise(
        runCoverageAudit(dir, { tsconfig: tsconfigPath }),
      );

      const benchmarkRow = {
        repo: 'test',
        timestamp: new Date().toISOString(),
        discovered: audit.discovered,
        analyzed: audit.analyzed,
        zeroPrograms: audit.zeroPrograms,
        failed: audit.failed,
        percentage: audit.percentage,
        analyzableCoverage: audit.analyzableCoverage,
        unknownNodeRate: audit.unknownNodeRate,
        suspiciousZerosCount: audit.suspiciousZeros.length,
        durationMs: 0,
      };

      expect(typeof benchmarkRow.discovered).toBe('number');
      expect(typeof benchmarkRow.analyzed).toBe('number');
      expect(typeof benchmarkRow.analyzableCoverage).toBe('number');
      expect(typeof benchmarkRow.unknownNodeRate).toBe('number');
      expect(typeof benchmarkRow.suspiciousZerosCount).toBe('number');
      expect(benchmarkRow.discovered).toBeGreaterThanOrEqual(0);
      expect(benchmarkRow.analyzed).toBeGreaterThanOrEqual(0);
      expect(typeof audit.totalNodes).toBe('number');
      expect(typeof audit.unknownNodes).toBe('number');
      expect(typeof (audit as { durationMs?: number }).durationMs).toBe('number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delta vs baseline has expected numeric shape (analyzed, unknownNodeRate, percentage)', () => {
    const baseline = { discovered: 10, analyzed: 8, zeroPrograms: 1, failed: 1, percentage: 80, analyzableCoverage: 88.89, unknownNodeRate: 0.1, suspiciousZerosCount: 1 };
    const current = { discovered: 10, analyzed: 9, zeroPrograms: 0, failed: 1, percentage: 90, analyzableCoverage: 90, unknownNodeRate: 0.08, suspiciousZerosCount: 0 };
    const delta = (a: typeof baseline, b: typeof current) => ({
      analyzed: b.analyzed - a.analyzed,
      unknownNodeRate: b.unknownNodeRate - a.unknownNodeRate,
      percentage: b.percentage - a.percentage,
    });
    const d = delta(baseline, current);
    expect(typeof d.analyzed).toBe('number');
    expect(typeof d.unknownNodeRate).toBe('number');
    expect(typeof d.percentage).toBe('number');
    expect(d.analyzed).toBe(1);
    expect(d.unknownNodeRate).toBeCloseTo(-0.02);
  });

  it(
    'includes topUnknownReasons and unknownReasonCounts when audit runs',
    { timeout: 45_000 },
    async () => {
    const fixturesDir = join(__dirname, '__fixtures__');
    const audit = await Effect.runPromise(
      runCoverageAudit(fixturesDir),
    );
    expect(Array.isArray(audit.topUnknownReasons)).toBe(true);
    const reasons = audit.topUnknownReasons;
    if (reasons && reasons.length > 0) {
      expect(reasons[0]).toHaveProperty('reason');
      expect(reasons[0]).toHaveProperty('count');
      expect(typeof reasons[0].count).toBe('number');
    }
    expect(typeof audit.unknownReasonCounts).toBe('object');
  });
});

describe('§5 Optional: false-positive review / excludeFromSuspiciousZeros', () => {
  it('excludes files matching excludeFromSuspiciousZeros from suspiciousZeros', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exclude-suspicious-'));
    const tsconfigPath = join(dir, 'tsconfig.json');
    const suspiciousPath = join(dir, 'imports-effect-no-programs.ts');
    const excludedPath = join(dir, 'fixtures', 'also-zero.ts');
    mkdirSync(join(dir, 'fixtures'), { recursive: true });
    try {
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['**/*.ts'] }));
      writeFileSync(suspiciousPath, "import { Effect } from 'effect';\n// no programs\n");
      writeFileSync(excludedPath, "import { Effect } from 'effect';\n// no programs\n");

      const auditWithoutExclude = await Effect.runPromise(
        runCoverageAudit(dir, { tsconfig: tsconfigPath }),
      );
      const auditWithExclude = await Effect.runPromise(
        runCoverageAudit(dir, {
          tsconfig: tsconfigPath,
          excludeFromSuspiciousZeros: ['fixtures/', 'also-zero'],
        }),
      );

      expect(auditWithoutExclude.suspiciousZeros).toContain(suspiciousPath);
      expect(auditWithoutExclude.suspiciousZeros).toContain(excludedPath);

      expect(auditWithExclude.suspiciousZeros).toContain(suspiciousPath);
      expect(auditWithExclude.suspiciousZeros).not.toContain(excludedPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('classifies zero-program files into expected buckets and suspicious', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zero-buckets-'));
    const tsconfigPath = join(dir, 'tsconfig.json');
    const indexPath = join(dir, 'index.ts');
    const configPath = join(dir, 'vitest.config.ts');
    const testPath = join(dir, 'example.test.ts');
    const typeOnlyPath = join(dir, 'types.ts');
    const suspiciousPath = join(dir, 'imports-effect-no-programs.ts');
    const otherPath = join(dir, 'plain.ts');
    try {
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['**/*.ts'] }));
      writeFileSync(indexPath, 'export { x } from "./plain";\n');
      writeFileSync(configPath, 'export default {};\n');
      writeFileSync(testPath, 'export const n = 1;\n');
      writeFileSync(typeOnlyPath, 'export interface User { id: string }\nexport type Id = string\n');
      writeFileSync(suspiciousPath, "import { Effect } from 'effect';\n// no programs here\n");
      writeFileSync(otherPath, 'export const answer = 42;\n');

      const audit = await Effect.runPromise(
        runCoverageAudit(dir, { tsconfig: tsconfigPath }),
      );

      expect(audit.failed).toBe(0);
      expect(audit.zeroPrograms).toBe(6);
      expect(audit.zeroProgramCategoryCounts.barrel_or_index).toBe(1);
      expect(audit.zeroProgramCategoryCounts.config_or_build).toBe(1);
      expect(audit.zeroProgramCategoryCounts.test_or_dtslint).toBe(1);
      expect(audit.zeroProgramCategoryCounts.type_only).toBe(1);
      expect(audit.zeroProgramCategoryCounts.suspicious).toBe(1);
      expect(audit.zeroProgramCategoryCounts.other).toBe(1);
      expect(audit.suspiciousZeros).toContain(suspiciousPath);
      expect(audit.zeroProgramClassifications.length).toBe(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
