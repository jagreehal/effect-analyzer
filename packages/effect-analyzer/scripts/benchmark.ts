#!/usr/bin/env npx tsx
/**
 * Benchmark script — runs coverage audit across repos and stores JSON snapshots.
 * Usage: npx tsx scripts/benchmark.ts [repo1] [repo2] ...
 */
import { Effect } from 'effect';
import { runCoverageAudit } from '../src/project-analyzer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, basename, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BENCHMARK_DIR = resolve(__dirname, '..', 'benchmarks');

interface BenchmarkResult {
  repo: string;
  timestamp: string;
  discovered: number;
  analyzed: number;
  zeroPrograms: number;
  failed: number;
  percentage: number;
  analyzableCoverage: number;
  unknownNodeRate: number;
  suspiciousZerosCount: number;
  durationMs: number;
}

async function benchmarkRepo(repoPath: string): Promise<BenchmarkResult> {
  const start = Date.now();
  const tsconfig = existsSync(join(repoPath, 'tsconfig.json'))
    ? join(repoPath, 'tsconfig.json')
    : undefined;

  const audit = await Effect.runPromise(
    runCoverageAudit(repoPath, { tsconfig }),
  );

  return {
    repo: basename(repoPath),
    timestamp: new Date().toISOString(),
    discovered: audit.discovered,
    analyzed: audit.analyzed,
    zeroPrograms: audit.zeroPrograms,
    failed: audit.failed,
    percentage: Math.round(audit.percentage * 100) / 100,
    analyzableCoverage: Math.round(audit.analyzableCoverage * 100) / 100,
    unknownNodeRate: Math.round(audit.unknownNodeRate * 10000) / 10000,
    suspiciousZerosCount: audit.suspiciousZeros.length,
    durationMs: Date.now() - start,
  };
}

async function main() {
  const repos = process.argv.slice(2);
  if (repos.length === 0) {
    console.log('Usage: npx tsx scripts/benchmark.ts <repo-path> [repo-path2] ...');
    process.exit(1);
  }

  if (!existsSync(BENCHMARK_DIR)) mkdirSync(BENCHMARK_DIR, { recursive: true });

  const results: BenchmarkResult[] = [];
  for (const repo of repos) {
    const repoResolved = resolve(repo);
    if (!existsSync(repoResolved)) {
      console.log(`Skipping ${repo} — not found`);
      continue;
    }
    console.log(`Benchmarking ${repoResolved}...`);
    const result = await benchmarkRepo(repoResolved);
    results.push(result);
    console.log(`  discovered=${result.discovered} analyzed=${result.analyzed} zero=${result.zeroPrograms} failed=${result.failed}`);
    console.log(`  coverage=${result.percentage}% analyzable=${result.analyzableCoverage}% unknownRate=${result.unknownNodeRate}`);
    console.log(`  duration=${result.durationMs}ms`);
  }

  // Save snapshot
  const snapshotPath = join(BENCHMARK_DIR, `benchmark-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(snapshotPath, JSON.stringify(results, null, 2));
  console.log(`\nSnapshot saved to ${snapshotPath}`);

  // Compare with previous baseline if exists
  const baselinePath = join(BENCHMARK_DIR, 'baseline.json');
  if (existsSync(baselinePath)) {
    const baseline: BenchmarkResult[] = JSON.parse(readFileSync(baselinePath, 'utf-8'));
    console.log('\nDeltas vs baseline:');
    for (const result of results) {
      const base = baseline.find((b) => b.repo === result.repo);
      if (!base) {
        console.log(`  ${result.repo}: NEW (no baseline)`);
        continue;
      }
      const delta = (field: keyof BenchmarkResult) => {
        const curr = result[field] as number;
        const prev = base[field] as number;
        const diff = curr - prev;
        return diff >= 0 ? `+${diff}` : `${diff}`;
      };
      console.log(`  ${result.repo}: analyzed ${delta('analyzed')} | unknown ${delta('unknownNodeRate')} | coverage ${delta('percentage')}%`);
    }
  }
}

main().catch(console.error);
