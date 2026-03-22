/**
 * Clone public Effect repos into .analysis-output/, run effect-analyze (colocated
 * .effect-analysis.md), and optionally run coverage audit and append a one-line
 * summary to .analysis-output/NOTES.md.
 *
 * Usage: pnpm build && pnpm run analyze:public-repos [--refresh]
 *
 * --refresh  Re-clone repos that already exist (default: skip existing clones).
 *
 * After running, review generated .effect-analysis.md files under .analysis-output
 * and update .analysis-output/NOTES.md with README-worthy examples (repo, file, program, why).
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync, spawnSync } from 'child_process';

const ROOT = resolve(process.cwd());
const ANALYSIS_DIR = join(ROOT, '.analysis-output');
const CLI_PATH = join(ROOT, 'dist/cli.js');

const REPOS: { name: string; url: string }[] = [
  { name: 'typed', url: 'https://github.com/TylorS/typed.git' },
  { name: 'effect-http', url: 'https://github.com/sukovanej/effect-http.git' },
  { name: 'distilled', url: 'https://github.com/alchemy-run/distilled.git' },
  { name: 'sync-engine-web', url: 'https://github.com/typeonce-dev/sync-engine-web.git' },
  { name: 'effect-aws', url: 'https://github.com/floydspace/effect-aws.git' },
  { name: 'effect-nextjs', url: 'https://github.com/mcrovero/effect-nextjs.git' },
  { name: 'sqlfx', url: 'https://github.com/tim-smart/sqlfx.git' },
  // EffectReact templates: add exact repo URL when known (e.g. Effect-TS/effect-react or template repo)
];

const NOTES_TEMPLATE = `# Public repo analysis – README candidates

One-line audit summaries are appended below by the script. Add README-worthy examples here after reviewing generated \`.effect-analysis.md\` files.

## Audit summaries (auto-appended)

`;

function ensureAnalysisDir(): void {
  mkdirSync(ANALYSIS_DIR, { recursive: true });
}

function ensureNotesFile(): void {
  const notesPath = join(ANALYSIS_DIR, 'NOTES.md');
  if (!existsSync(notesPath)) {
    writeFileSync(notesPath, NOTES_TEMPLATE, 'utf-8');
  }
}

function clone(repo: { name: string; url: string }, refresh: boolean): void {
  const dest = join(ANALYSIS_DIR, repo.name);
  if (existsSync(dest)) {
    if (refresh) {
      rmSync(dest, { recursive: true, force: true });
    } else {
      console.log(`  [skip clone] ${repo.name} (already exists; use --refresh to re-clone)`);
      return;
    }
  }
  console.log(`  cloning ${repo.name}...`);
  execFileSync('git', ['clone', '--depth', '1', repo.url, dest], {
    stdio: 'inherit',
    cwd: ROOT,
  });
}

function runAnalyzer(repoName: string): boolean {
  const targetPath = join(ANALYSIS_DIR, repoName);
  const result = spawnSync('node', [CLI_PATH, targetPath], {
    stdio: 'inherit',
    cwd: ROOT,
    shell: false,
  });
  return result.status === 0;
}

function runCoverageAudit(repoName: string): { discovered: number; analyzed: number; failed: number } | null {
  const targetPath = join(ANALYSIS_DIR, repoName);
  const auditPath = join(ANALYSIS_DIR, `audit-${repoName}.json`);
  const result = spawnSync(
    'node',
    [CLI_PATH, targetPath, '--coverage-audit', '--no-colocate', '-o', auditPath],
    { cwd: ROOT, shell: false, encoding: 'utf-8' },
  );
  if (result.status !== 0) return null;
  try {
    const json = JSON.parse(readFileSync(auditPath, 'utf-8'));
    return {
      discovered: json.discovered ?? 0,
      analyzed: json.analyzed ?? 0,
      failed: json.failed ?? 0,
    };
  } catch {
    return null;
  }
}

function appendAuditLine(repoName: string, audit: { discovered: number; analyzed: number; failed: number }): void {
  const notesPath = join(ANALYSIS_DIR, 'NOTES.md');
  const line = `- **${repoName}**: discovered ${audit.discovered}, analyzed ${audit.analyzed}, failed ${audit.failed}\n`;
  appendFileSync(notesPath, line, 'utf-8');
}

function main(): void {
  if (!existsSync(CLI_PATH)) {
    console.error('Run pnpm build first (dist/cli.js not found).');
    process.exit(1);
  }

  const refresh = process.argv.includes('--refresh');
  ensureAnalysisDir();
  ensureNotesFile();

  console.log('Repos: ' + REPOS.map((r) => r.name).join(', '));
  for (const repo of REPOS) {
    console.log(`\n--- ${repo.name} ---`);
    clone(repo, refresh);
    const targetPath = join(ANALYSIS_DIR, repo.name);
    if (!existsSync(targetPath)) continue;
    runAnalyzer(repo.name);
    const audit = runCoverageAudit(repo.name);
    if (audit) appendAuditLine(repo.name, audit);
  }

  console.log('\nDone. Review .analysis-output/**/*.effect-analysis.md and update .analysis-output/NOTES.md with README candidates.');
}

main();
