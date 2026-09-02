import * as fs from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { LintIssue } from './effect-linter';
import { lintSourceCode } from './source-linter';
import { findRuleDoc } from './rule-registry';
import { readTsgoProjectFiles, runTsgoDiagnostics } from './tsgo-diagnostics';

export interface LintFinding {
  readonly filePath: string;
  readonly rule: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly suggestion?: string | undefined;
  readonly line: number;
  readonly column: number;
  /**
   * Which checker produced this finding. `tsgo` findings are type-aware Effect
   * language service diagnostics; `analyzer` findings are our own AST rules.
   * Consumers gate on this instead of guessing from the rule name.
   */
  readonly source: 'analyzer' | 'tsgo';
  /** The 377xxx Effect language service code. Only present on `tsgo` findings. */
  readonly code?: number | undefined;
  readonly endLine?: number | undefined;
  readonly endColumn?: number | undefined;
  readonly fingerprint: string;
  readonly suppressed?: boolean | undefined;
  readonly suppressionReason?: string | undefined;
}

/**
 * Severity gate for the process exit status. `undefined` means advisory-only:
 * findings are reported but never change the exit code, so a consumer can tell
 * an advisory run apart from a failed one without re-checking anything.
 */
export type FailOnSeverity = LintFinding['severity'];

const SEVERITY_ORDER: Record<LintFinding['severity'], number> = {
  error: 3,
  warning: 2,
  info: 1,
};

/**
 * Exit code for a scan under a severity gate: 1 when any finding is at or above
 * `failOn`, 0 otherwise.
 */
export const exitCodeFor = (
  findings: readonly LintFinding[],
  failOn: FailOnSeverity | undefined,
): 0 | 1 => {
  if (failOn === undefined) return 0;
  const threshold = SEVERITY_ORDER[failOn];
  return findings.some((f) => SEVERITY_ORDER[f.severity] >= threshold) ? 1 : 0;
};

export interface Suppression {
  readonly filePath?: string | undefined;
  readonly line: number;
  readonly rule: string;
  readonly reason?: string | undefined;
}

/**
 * What the Effect language service actually covered. Without this a run where
 * tsgo checked nothing — a stale or mistargeted tsconfig — is indistinguishable
 * from a genuinely clean one.
 */
export interface TsgoCoverage {
  readonly filesChecked: number;
  readonly totalFiles: number;
  /** Scanned files the language service never checked, sorted. */
  readonly unchecked: readonly string[];
}

export interface LintScanResult {
  readonly findings: readonly LintFinding[];
  readonly staleSuppressions: readonly Suppression[];
  readonly suppressionsMissingReason: readonly Suppression[];
  readonly filesScanned: number;
  readonly tsgo?: TsgoCoverage | undefined;
}

export interface BaselineComparison {
  readonly newFindings: readonly LintFinding[];
  readonly resolvedFindings: readonly LintFinding[];
  readonly unchangedFindings: readonly LintFinding[];
}

export interface LintScorecardRow {
  readonly filePath: string;
  readonly score: number;
  readonly penalty: number;
  readonly findings: number;
  readonly errors: number;
  readonly warnings: number;
  readonly info: number;
}

/**
 * Deterministic penalty table for lint scorecard generation.
 * Keep this stable across runs and adjust intentionally in changelog-worthy updates.
 */
export const SCORECARD_WEIGHTS = {
  severity: {
    error: 10,
    warning: 4,
    info: 1,
  },
  ruleOverrides: {
    'unsafe-api-usage': 12,
    'live-layer-in-test': 5,
    'forEach-without-concurrency': 3,
    'untagged-throw': 4,
    'sleep-without-testclock': 3,
  },
} as const;

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

const severityRank = (severity: LintFinding['severity']): number =>
  severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;

const canonicalSort = (a: LintFinding, b: LintFinding): number => {
  if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
  const sevCmp = severityRank(a.severity) - severityRank(b.severity);
  if (sevCmp !== 0) return sevCmp;
  if (a.message !== b.message) return a.message.localeCompare(b.message);
  return (a.suggestion ?? '').localeCompare(b.suggestion ?? '');
};

/**
 * A finding's stable identity across runs and releases.
 *
 * The key is frozen: baselines written by earlier releases carry these
 * fingerprints, and `--fail-on-new` compares against them. Adding a field here
 * renumbers every existing finding and reports the whole backlog as new, so
 * `source` is deliberately excluded — the same defect found by either checker
 * is the same defect.
 */
export const fingerprintOf = (
  finding: Pick<
    LintFinding,
    'filePath' | 'line' | 'column' | 'rule' | 'severity' | 'message' | 'suggestion'
  >,
): string => {
  const key = [
    finding.filePath,
    String(finding.line),
    String(finding.column),
    finding.rule,
    finding.severity,
    finding.message,
    finding.suggestion ?? '',
  ].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 20);
};

const stableFingerprint = fingerprintOf;

const parseSuppressions = (source: string): readonly Suppression[] => {
  const lines = source.split(/\r?\n/);
  const suppressions: Suppression[] = [];
  const re = /effect-analyzer-disable-next-line\s+([a-z0-9-]+)(?:\s+(.+))?$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = re.exec(line);
    if (!match) continue;
    const rule = (match[1] ?? '').trim();
    if (!rule) continue;
    const reason = (match[2] ?? '').trim();
    suppressions.push({
      line: i + 1,
      rule,
      reason: reason && reason.length > 0 ? reason : undefined,
    });
  }
  return suppressions;
};

const applySuppressions = (
  findings: readonly LintFinding[],
  suppressions: readonly Suppression[],
): { findings: readonly LintFinding[]; stale: readonly Suppression[] } => {
  const byTarget = new Map<string, Suppression>();
  for (const suppression of suppressions) {
    byTarget.set(`${suppression.line + 1}|${suppression.rule}`, suppression);
  }

  const consumed = new Set<string>();
  const updated = findings.map((finding) => {
    const key = `${finding.line}|${finding.rule}`;
    const match = byTarget.get(key);
    if (!match) return finding;
    consumed.add(key);
    return {
      ...finding,
      suppressed: true,
      suppressionReason: match.reason,
    };
  });

  const stale = suppressions.filter((suppression) => !consumed.has(`${suppression.line + 1}|${suppression.rule}`));
  return { findings: updated, stale };
};

const dedupe = (findings: readonly LintFinding[]): readonly LintFinding[] => {
  const sorted = [...findings].sort(canonicalSort);
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  for (const finding of sorted) {
    const key = [
      finding.fingerprint,
      finding.suppressed ? '1' : '0',
      finding.suppressionReason ?? '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
};

const toFinding = (filePath: string, issue: LintIssue): LintFinding => {
  const line = issue.location?.line ?? 1;
  const column = issue.location?.column ?? 1;
  const base = {
    filePath,
    rule: issue.rule,
    severity: issue.severity,
    message: issue.message,
    suggestion: issue.suggestion,
    line,
    column,
    source: 'analyzer' as const,
  };
  return {
    ...base,
    fingerprint: stableFingerprint(base),
  };
};

const walk = async (path: string, depth = 0): Promise<string[]> => {
  if (depth > 30) return [];
  const stat = await fs.stat(path);
  if (stat.isFile()) return TS_EXTENSIONS.has(extname(path)) ? [path] : [];
  if (!stat.isDirectory()) return [];
  const entries = await fs.readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
      continue;
    }
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full, depth + 1)));
    } else if (entry.isFile() && TS_EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
};

export interface SourceLintScanOptions {
  /**
   * Path to a TypeScript 7 tsconfig.json. When set, official type-aware Effect
   * diagnostics from the bundled `@effect/tsgo` bridge are merged in.
   */
  readonly tsgoProject?: string | undefined;
}

export const runSourceLintScan = async (
  pathArg: string,
  options: SourceLintScanOptions = {},
): Promise<LintScanResult> => {
  const basePath = resolve(pathArg);
  const candidates = (await walk(basePath)).sort((a, b) => a.localeCompare(b));
  const findings: LintFinding[] = [];
  const staleSuppressions: Suppression[] = [];
  const suppressionsMissingReason: Suppression[] = [];

  for (const filePath of candidates) {
    const source = await fs.readFile(filePath, 'utf-8');
    const suppressions = parseSuppressions(source);
    suppressionsMissingReason.push(
      ...suppressions
        .filter((s) => !s.reason || s.reason.trim().length === 0)
        .map((s) => ({ ...s, filePath })),
    );
    const lint = lintSourceCode(source, filePath);
    const rawFindings = lint.issues.map((issue) => toFinding(filePath, issue));
    const applied = applySuppressions(rawFindings, suppressions);
    findings.push(...applied.findings.filter((x) => !x.suppressed));
    staleSuppressions.push(...applied.stale.map((x) => ({ ...x, filePath, line: x.line })));
  }

  // Type-aware rules from the official Effect language service, when available.
  // ponytail: tsgo diagnostics bypass our disable pragmas — tsgo has its own
  // suppression story; wire the two together only if users actually ask.
  let tsgo: TsgoCoverage | undefined;
  if (options.tsgoProject) {
    const scanned = new Set(candidates);
    const result = runTsgoDiagnostics({ project: options.tsgoProject });
    const inProject = new Set(readTsgoProjectFiles(options.tsgoProject));
    for (const diagnostic of result.diagnostics) {
      const filePath = resolve(diagnostic.filePath);
      if (!scanned.has(filePath)) continue;
      const base = {
        filePath,
        rule: diagnostic.rule,
        severity: diagnostic.severity,
        message: diagnostic.message,
        suggestion: undefined,
        line: diagnostic.line,
        column: diagnostic.column,
        source: diagnostic.source,
        code: diagnostic.code,
        endLine: diagnostic.endLine,
        endColumn: diagnostic.endColumn,
      };
      findings.push({ ...base, fingerprint: stableFingerprint(base) });
    }
    const unchecked = candidates.filter((c) => !inProject.has(c));
    tsgo = {
      filesChecked: result.summary.filesChecked,
      totalFiles: result.summary.totalFiles,
      unchecked,
    };
  }

  return {
    findings: dedupe(findings),
    staleSuppressions,
    suppressionsMissingReason,
    filesScanned: candidates.length,
    tsgo,
  };
};

export const compareAgainstBaseline = (
  current: readonly LintFinding[],
  baseline: readonly LintFinding[],
): BaselineComparison => {
  const currentByFp = new Map(current.map((f) => [f.fingerprint, f]));
  const baselineByFp = new Map(baseline.map((f) => [f.fingerprint, f]));

  const newFindings = [...currentByFp.entries()]
    .filter(([fp]) => !baselineByFp.has(fp))
    .map(([, finding]) => finding)
    .sort(canonicalSort);

  const resolvedFindings = [...baselineByFp.entries()]
    .filter(([fp]) => !currentByFp.has(fp))
    .map(([, finding]) => finding)
    .sort(canonicalSort);

  const unchangedFindings = [...currentByFp.entries()]
    .filter(([fp]) => baselineByFp.has(fp))
    .map(([, finding]) => finding)
    .sort(canonicalSort);

  return { newFindings, resolvedFindings, unchangedFindings };
};

export const toSarif = (findings: readonly LintFinding[]) => {
  const rules = [...new Set(findings.map((f) => f.rule))].sort((a, b) => a.localeCompare(b));
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'effect-analyzer',
            informationUri: 'https://effect.website/docs/tooling/effect-analyzer',
            rules: rules.map((ruleId) => {
              const doc = findRuleDoc(ruleId);
              const level = doc?.severity === 'error' ? 'error' : doc?.severity === 'warning' ? 'warning' : 'note';
              return {
                id: ruleId,
                shortDescription: {
                  text: doc?.title ?? ruleId,
                },
                fullDescription: doc?.description
                  ? { text: doc.description }
                  : undefined,
                helpUri: doc?.docUrl,
                defaultConfiguration: { level },
                properties: {
                  tags: doc ? [`domain:${doc.domain}`, `confidence:${doc.confidence}`] : [],
                },
              };
            }),
          },
        },
        results: findings.map((finding) => ({
          ruleId: finding.rule,
          level: finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'note',
          message: { text: finding.message },
          fingerprints: { primaryLocationLineHash: finding.fingerprint },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.filePath },
                region: {
                  startLine: finding.line,
                  startColumn: finding.column,
                },
              },
            },
          ],
        })),
      },
    ],
  };
};

export const buildLintScorecard = (findings: readonly LintFinding[]): readonly LintScorecardRow[] => {
  const rows = new Map<string, LintScorecardRow>();
  for (const finding of findings) {
    const existing = rows.get(finding.filePath) ?? {
      filePath: finding.filePath,
      score: 100,
      penalty: 0,
      findings: 0,
      errors: 0,
      warnings: 0,
      info: 0,
    };
    const severityPenalty = SCORECARD_WEIGHTS.severity[finding.severity];
    const rulePenalty = SCORECARD_WEIGHTS.ruleOverrides[
      finding.rule as keyof typeof SCORECARD_WEIGHTS.ruleOverrides
    ];
    const penalty = rulePenalty ?? severityPenalty;
    rows.set(finding.filePath, {
      ...existing,
      penalty: existing.penalty + penalty,
      findings: existing.findings + 1,
      errors: existing.errors + (finding.severity === 'error' ? 1 : 0),
      warnings: existing.warnings + (finding.severity === 'warning' ? 1 : 0),
      info: existing.info + (finding.severity === 'info' ? 1 : 0),
    });
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      score: Math.max(0, 100 - row.penalty),
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.penalty !== b.penalty) return b.penalty - a.penalty;
      if (a.findings !== b.findings) return b.findings - a.findings;
      return a.filePath.localeCompare(b.filePath);
    });
};
