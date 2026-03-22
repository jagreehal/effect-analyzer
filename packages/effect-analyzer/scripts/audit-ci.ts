import { Effect } from 'effect';
import { join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { runCoverageAudit } from '../src/project-analyzer';

const DEFAULT_EFFECT_REPO_PATH = resolve('.cache/effect-repo');

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}

function parseNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseIntNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

type BudgetConfig = {
  dirPath: string;
  tsconfig: string | undefined;
  knownEffectInternalsRoot: string | undefined;
  maxFailed: number;
  maxUnknownNodeRate: number;
  maxSuspiciousZeros: number;
  baselineFile: string | undefined;
};

type BudgetBaseline = {
  maxFailed?: number;
  maxUnknownNodeRate?: number;
  maxSuspiciousZeros?: number;
  metrics?: {
    failed?: number;
    unknownNodeRate?: number;
    suspiciousZeros?: number;
  };
};

function readBaseline(pathValue: string | undefined): BudgetBaseline | undefined {
  if (!pathValue) return undefined;
  if (!existsSync(pathValue)) return undefined;
  try {
    const raw = readFileSync(pathValue, 'utf-8');
    return JSON.parse(raw) as BudgetBaseline;
  } catch {
    return undefined;
  }
}

function getConfig(): BudgetConfig {
  const effectRepoPath = resolve(
    process.env.EFFECT_REPO_PATH ?? DEFAULT_EFFECT_REPO_PATH,
  );
  const defaultDir = join(effectRepoPath, 'packages');
  const defaultInternalsRoot = join(effectRepoPath, 'packages', 'effect', 'src', 'internal');
  const defaultBaselineFile = resolve('scripts/baselines/effect-audit-baseline.json');
  const baselineFile =
    getArgValue('--baseline-file') ??
    process.env.AUDIT_BASELINE_FILE ??
    (existsSync(defaultBaselineFile) ? defaultBaselineFile : undefined);
  const baseline = readBaseline(baselineFile);

  const dirPath = resolve(
    getArgValue('--dir') ??
      process.env.EFFECT_AUDIT_DIR ??
      defaultDir,
  );
  const tsconfig = getArgValue('--tsconfig') ?? process.env.EFFECT_AUDIT_TSCONFIG;
  const knownEffectInternalsRoot =
    getArgValue('--known-effect-internals-root') ??
    process.env.KNOWN_EFFECT_INTERNALS_ROOT ??
    defaultInternalsRoot;

  // Defaults are set to current observed baselines; tighten over time.
  const maxFailed = parseIntNumber(
    getArgValue('--max-failed') ?? process.env.AUDIT_MAX_FAILED,
    baseline?.maxFailed ?? baseline?.metrics?.failed ?? 0,
  );
  const maxUnknownNodeRate = parseNumber(
    getArgValue('--max-unknown-node-rate') ?? process.env.AUDIT_MAX_UNKNOWN_NODE_RATE,
    baseline?.maxUnknownNodeRate ?? baseline?.metrics?.unknownNodeRate ?? 0.1173,
  );
  const maxSuspiciousZeros = parseIntNumber(
    getArgValue('--max-suspicious-zeros') ?? process.env.AUDIT_MAX_SUSPICIOUS_ZEROS,
    baseline?.maxSuspiciousZeros ?? baseline?.metrics?.suspiciousZeros ?? 999_999,
  );

  return {
    dirPath,
    tsconfig,
    knownEffectInternalsRoot,
    maxFailed,
    maxUnknownNodeRate,
    maxSuspiciousZeros,
    baselineFile,
  };
}

async function main(): Promise<void> {
  const config = getConfig();
  const startedAt = Date.now();
  if (!existsSync(config.dirPath)) {
    console.error(
      JSON.stringify(
        {
          status: 'fail',
          message:
            `Audit dir not found: ${config.dirPath}. ` +
            'Set EFFECT_AUDIT_DIR / EFFECT_REPO_PATH, or run `pnpm effect:fetch` to clone Effect locally.',
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const audit = await Effect.runPromise(
    runCoverageAudit(config.dirPath, {
      tsconfig: config.tsconfig,
      knownEffectInternalsRoot: config.knownEffectInternalsRoot,
    }),
  );

  const suspiciousCount = audit.zeroProgramCategoryCounts.suspicious;
  const violations: string[] = [];

  if (audit.failed > config.maxFailed) {
    violations.push(
      `failed files ${audit.failed} exceeds max ${config.maxFailed}`,
    );
  }
  if (audit.unknownNodeRate > config.maxUnknownNodeRate) {
    violations.push(
      `unknownNodeRate ${(audit.unknownNodeRate * 100).toFixed(2)}% exceeds max ${(config.maxUnknownNodeRate * 100).toFixed(2)}%`,
    );
  }
  if (suspiciousCount > config.maxSuspiciousZeros) {
    violations.push(
      `suspicious zeros ${suspiciousCount} exceeds max ${config.maxSuspiciousZeros}`,
    );
  }

  const summary = {
    dirPath: config.dirPath,
    budgets: {
      maxFailed: config.maxFailed,
      maxUnknownNodeRate: config.maxUnknownNodeRate,
      maxSuspiciousZeros: config.maxSuspiciousZeros,
      baselineFile: config.baselineFile,
    },
    metrics: {
      discovered: audit.discovered,
      analyzed: audit.analyzed,
      zeroPrograms: audit.zeroPrograms,
      failed: audit.failed,
      coverage: audit.percentage,
      analyzableCoverage: audit.analyzableCoverage,
      unknownNodeRate: audit.unknownNodeRate,
      suspiciousZeros: suspiciousCount,
      zeroProgramCategoryCounts: audit.zeroProgramCategoryCounts,
      durationMs: audit.durationMs,
      wallClockMs: Date.now() - startedAt,
    },
  };

  if (violations.length > 0) {
    console.error(
      JSON.stringify(
        {
          status: 'fail',
          violations,
          summary,
          suspiciousZeroSample: audit.suspiciousZeros.slice(0, 50),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        status: 'pass',
        summary,
      },
      null,
      2,
    ),
  );
}

void main();
