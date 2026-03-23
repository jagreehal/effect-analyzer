/**
 * Project-wide / Cross-file Analysis (GAP 17)
 *
 * Analyzes a directory of TypeScript files and aggregates results.
 */

import { Effect, Option } from 'effect';
import { readdir, readFile, stat } from 'fs/promises';
import { readFileSync } from 'fs';
import { join, extname, resolve, basename } from 'path';
import type { StaticEffectIR, StaticFlowNode, ProjectServiceMap } from './types';
import { getStaticChildren, isStaticUnknownNode } from './types';
import { analyze } from './analyze';
import { loadTsMorph } from './ts-morph-loader';
import { buildProjectServiceMap } from './service-registry';

// =============================================================================
// Types
// =============================================================================

/** Per-file failure for project analysis (Gap 3: no silent drops). */
export interface ProjectFileFailure {
  readonly file: string;
  readonly error: string;
}

export interface ProjectAnalysisResult {
  /** File path -> list of program IRs in that file */
  readonly byFile: Map<string, readonly StaticEffectIR[]>;
  /** All programs across the project */
  readonly allPrograms: readonly StaticEffectIR[];
  /** Entry points (files that run Effect.runPromise / runSync / NodeRuntime.runMain) - heuristic + package.json */
  readonly entryPointFiles: string[];
  /** Total file count discovered */
  readonly fileCount: number;
  /** Files that failed to analyze (error message included) - Gap 3 */
  readonly failedFiles: readonly ProjectFileFailure[];
  /** Files that were analyzed but had zero Effect programs */
  readonly zeroProgramFiles: readonly string[];
  /** Project-level deduplicated service map (when --service-map is enabled) */
  readonly serviceMap?: ProjectServiceMap | undefined;
}

export interface AnalyzeProjectOptions {
  readonly tsconfig?: string | undefined;
  /** File extensions to discover; default ['.ts', '.tsx']. Include '.js'/.jsx' for best-effort JS (Gap 6). */
  readonly extensions?: readonly string[] | undefined;
  readonly maxDepth?: number | undefined;
  /** When true, include per-file durationMs in outcomes (improve.md §7 optional timing). */
  readonly includePerFileTiming?: boolean | undefined;
  /** Optional false-positive review: paths matching any of these (substring or path segment) are excluded from suspiciousZeros (improve.md §5). */
  readonly excludeFromSuspiciousZeros?: readonly string[] | undefined;
  /** Optional path to known Effect internals root for per-file analysis (improve.md §1). */
  readonly knownEffectInternalsRoot?: string | undefined;
  /** When true, build the deduplicated project-level service map (--service-map). */
  readonly buildServiceMap?: boolean | undefined;
}

/** Per-file outcome for coverage audit. */
export interface FileOutcome {
  readonly file: string;
  readonly status: 'ok' | 'fail' | 'zero';
  readonly programCount?: number;
  readonly error?: string;
  /** When includePerFileTiming: analysis time in ms (improve.md §7). */
  readonly durationMs?: number;
}

export type ZeroProgramCategory =
  | 'barrel_or_index'
  | 'config_or_build'
  | 'test_or_dtslint'
  | 'type_only'
  | 'suspicious'
  | 'other';

export interface ZeroProgramClassification {
  readonly file: string;
  readonly category: ZeroProgramCategory;
  readonly importsEffect: boolean;
}

/** Coverage audit: discovered vs analyzed vs failed/zero, with per-file outcomes. */
export interface CoverageAuditResult {
  readonly discovered: number;
  readonly analyzed: number;
  readonly zeroPrograms: number;
  readonly failed: number;
  readonly outcomes: readonly FileOutcome[];
  readonly percentage: number;
  /** analyzed / (analyzed + failed) * 100 — excludes zero-program files (correct classification). */
  readonly analyzableCoverage: number;
  /** unknownCount / totalNodes across all analyzed files (0–1). */
  readonly unknownNodeRate: number;
  /** Repo-level aggregate: total node count across all analyzed programs (improve.md §5). */
  readonly totalNodes: number;
  /** Repo-level aggregate: unknown node count across all analyzed programs (improve.md §5). */
  readonly unknownNodes: number;
  /** Files that import from effect/@effect but produced zero programs. */
  readonly suspiciousZeros: readonly string[];
  /** Per-category zero-program counts for triage. */
  readonly zeroProgramCategoryCounts: Readonly<Record<ZeroProgramCategory, number>>;
  /** Per-file category for zero-program outcomes. */
  readonly zeroProgramClassifications: readonly ZeroProgramClassification[];
  /** Top N files by unknown node rate (highest first), for --show-top-unknown. */
  readonly topUnknownFiles?: readonly string[];
  /** Unknown node counts by reason. */
  readonly unknownReasonCounts?: Readonly<Record<string, number>>;
  /** Top unknown reasons by count (highest first), for --show-top-unknown-reasons. */
  readonly topUnknownReasons?: readonly { reason: string; count: number }[];
  /** Audit execution time in ms (improve.md §7 performance validation). */
  readonly durationMs?: number;
}

const DEFAULT_OPTIONS: Required<Omit<AnalyzeProjectOptions, 'tsconfig'>> = {
  extensions: ['.ts', '.tsx'],
  maxDepth: 10,
  knownEffectInternalsRoot: undefined,
  includePerFileTiming: false,
  excludeFromSuspiciousZeros: [],
  buildServiceMap: false,
};



// =============================================================================
// Precision metric helpers
// =============================================================================

function countNodes(nodes: readonly StaticFlowNode[]): { total: number; unknown: number } {
  let total = 0;
  let unknown = 0;
  const visit = (list: readonly StaticFlowNode[]) => {
    for (const node of list) {
      total++;
      if (node.type === 'unknown') unknown++;
      const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
      if (children.length > 0) visit(children);
    }
  };
  visit(nodes);
  return { total, unknown };
}

/** Aggregate unknown node counts by reason. */
function countUnknownReasons(nodes: readonly StaticFlowNode[]): Map<string, number> {
  const byReason = new Map<string, number>();
  const visit = (list: readonly StaticFlowNode[]) => {
    for (const node of list) {
      if (isStaticUnknownNode(node)) {
        const r = node.reason;
        byReason.set(r, (byReason.get(r) ?? 0) + 1);
      }
      const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
      if (children.length > 0) visit(children);
    }
  };
  visit(nodes);
  return byReason;
}

/** Modules from `effect` that do NOT produce Effect programs on their own. */
const NON_PROGRAM_EFFECT_MODULES = new Set([
  'Option', 'Either', 'Predicate', 'Order', 'Equivalence',
  'Hash', 'Equal', 'Inspectable', 'Pipeable', 'Types',
  'Brand', 'Chunk', 'HashMap', 'HashSet', 'List',
  'SortedMap', 'SortedSet', 'Duration', 'DateTime',
  'BigInt', 'BigDecimal', 'Number', 'String', 'Struct',
  'Tuple', 'ReadonlyArray', 'Array', 'Record',
  'Schema', 'ServiceMap', 'Data', 'Match', 'Function',
]);

function fileImportsEffect(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (!/from\s+["'](?:effect|effect\/|@effect\/)/.test(content)) return false;

    // Check if all runtime (non-type) named imports from "effect" are non-program modules
    // `import type { ... }` lines are always safe (type-only, no runtime behavior)
    const runtimeImportMatches = content.matchAll(/import\s+{([^}]+)}\s+from\s+["']effect["']/g);
    let hasAnyRuntimeImport = false;
    let allNonProgram = true;
    for (const match of runtimeImportMatches) {
      // Skip if this is actually an `import type` statement (the regex above won't match `import type {`)
      // But we need to check for inline `type` specifiers like `import { type Effect, Schema } from "effect"`
      const names = match[1]!.split(',')
        .map(s => s.trim())
        .filter(s => !s.startsWith('type '))  // skip inline type imports
        .map(s => s.split(/\s+as\s+/)[0]!.trim())
        .filter(Boolean);
      for (const name of names) {
        hasAnyRuntimeImport = true;
        if (!NON_PROGRAM_EFFECT_MODULES.has(name)) {
          allNonProgram = false;
          break;
        }
      }
      if (!allNonProgram) break;
    }

    if (hasAnyRuntimeImport && allNonProgram) return false;

    // Check for namespace imports: import * as X from "effect" or "effect/..."
    const hasNamespaceImport = /import\s+\*\s+as\s+\w+\s+from\s+["'](?:effect|effect\/|@effect\/)/.test(content);
    if (hasNamespaceImport) return true;

    // Check for named/namespace imports from effect submodules (e.g. "effect/Effect", "@effect/...")
    // These weren't caught by the exact "effect" regex above
    const hasSubmoduleImport = /import\s+{[^}]+}\s+from\s+["'](?:effect\/|@effect\/)/.test(content);
    if (hasSubmoduleImport) return true;

    // If only `import type` statements exist (no runtime imports at all), not suspicious
    if (!hasAnyRuntimeImport) return false;

    return true;
  } catch {
    return false;
  }
}

function isTypeOnlyZeroCandidate(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const hasRuntimeLikeEffectUsage =
      /\bEffect\./.test(content) ||
      /\bLayer\./.test(content) ||
      /\bStream\./.test(content) ||
      /\bSchema\./.test(content) ||
      /\byield\*/.test(content) ||
      /\bpipe\(/.test(content) ||
      /\brunPromise\b/.test(content) ||
      /\brunSync\b/.test(content) ||
      /\brunFork\b/.test(content) ||
      /\bacquireRelease\b/.test(content);
    if (hasRuntimeLikeEffectUsage) return false;

    return (
      /\binterface\b/.test(content) ||
      /\btype\b/.test(content) ||
      /\bdeclare\b/.test(content) ||
      /^\s*import\s+type\b/m.test(content) ||
      /^\s*export\s+type\b/m.test(content)
    );
  } catch {
    return false;
  }
}

function detectExpectedZeroCategory(filePath: string): Exclude<ZeroProgramCategory, 'suspicious' | 'other'> | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  const base = basename(normalized).toLowerCase();

  if (base === 'index.ts' || base === 'index.tsx' || /\/index\.[jt]sx?$/.test(normalized)) {
    return 'barrel_or_index';
  }

  if (
    /(^|\/)(__tests__|test|tests|dtslint)(\/|$)/.test(normalized) ||
    /\.(test|spec|tst)\.[jt]sx?$/.test(normalized)
  ) {
    return 'test_or_dtslint';
  }

  if (
    /(^|\/)(vitest|vite|jest|webpack|rollup|tsup|esbuild|eslint|prettier|babel|playwright|typedoc|karma)\.config\.[jt]s$/.test(normalized) ||
    /(^|\/)vitest\.workspace\.[jt]s$/.test(normalized)
  ) {
    return 'config_or_build';
  }

  if (isTypeOnlyZeroCandidate(filePath)) {
    return 'type_only';
  }

  return undefined;
}
// =============================================================================
// Discovery
// =============================================================================

async function findTsFiles(
  dir: string,
  extensions: readonly string[],
  maxDepth: number,
  currentDepth: number,
): Promise<string[]> {
  if (currentDepth >= maxDepth) return [];
  const result: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== 'node_modules' && ent.name !== '.git') {
          result.push(...(await findTsFiles(full, extensions, maxDepth, currentDepth + 1)));
        }
      } else if (ent.isFile() && extensions.includes(extname(ent.name))) {
        result.push(full);
      }
    }
  } catch {
    // ignore permission errors etc.
  }
  return result;
}

// =============================================================================
// Entry points from package.json (Gap 4: semantic entry-point detection)
// =============================================================================

async function findPackageJsonDirs(
  dir: string,
  maxDepth: number,
  currentDepth: number,
): Promise<string[]> {
  if (currentDepth >= maxDepth) return [];
  const result: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const hasPkg = entries.some((e) => e.isFile() && e.name === 'package.json');
    if (hasPkg) result.push(dir);
    for (const ent of entries) {
      if (ent.isDirectory() && ent.name !== 'node_modules' && ent.name !== '.git') {
        result.push(
          ...(await findPackageJsonDirs(join(dir, ent.name), maxDepth, currentDepth + 1)),
        );
      }
    }
  } catch {
    // ignore
  }
  return result;
}

function resolveEntry(
  pkgDir: string,
  entry: string | undefined,
  extensions: readonly string[],
): string[] {
  if (!entry || typeof entry !== 'string') return [];
  const normalized = entry.replace(/^\.\//, '');
  const base = join(pkgDir, normalized);
  const ext = extname(normalized);
  if (ext) {
    return [resolve(base)];
  }
  return extensions.map((e) => resolve(base + e));
}

/** Gap 4: Detect files that have Effect.runPromise / runSync / NodeRuntime.runMain at top level. */
async function fileHasTopLevelRunCall(filePath: string): Promise<boolean> {
  try {
    const { Project, SyntaxKind } = loadTsMorph();
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.addSourceFileAtPath(filePath);
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    const functionKinds = [
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.FunctionExpression,
      SyntaxKind.ArrowFunction,
      SyntaxKind.MethodDeclaration,
    ];
    for (const call of callExpressions) {
      const parent = call.getParent();
      if (parent?.getKind() !== SyntaxKind.ExpressionStatement) continue;
      let current: ReturnType<typeof parent.getParent> = parent;
      while (current) {
        const kind = current.getKind();
        if (kind === SyntaxKind.SourceFile) break;
        if (functionKinds.includes(kind)) break;
        current = current.getParent();
      }
      if (current?.getKind() !== SyntaxKind.SourceFile) continue;
      const exprText = call.getExpression().getText();
      if (
        exprText.includes('.runPromise') ||
        exprText.includes('.runSync') ||
        exprText.includes('.runFork') ||
        exprText.includes('.runCallback') ||
        exprText.includes('NodeRuntime.runMain') ||
        exprText.includes('BunRuntime.runMain') ||
        exprText.includes('DenoRuntime.runMain') ||
        exprText.includes('Runtime.runPromise') ||
        exprText.includes('Runtime.runSync') ||
        exprText.includes('Runtime.runFork')
      ) {
        return true;
      }
    }
  } catch {
    // ignore parse errors
  }
  return false;
}

async function getEntryPointsFromPackageJson(
  dirPath: string,
  extensions: readonly string[],
): Promise<string[]> {
  const pkgDirs = await findPackageJsonDirs(dirPath, 10, 0);
  const entryPaths: string[] = [];
  for (const pkgDir of pkgDirs) {
    try {
      const raw = await readFile(join(pkgDir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw) as { main?: string; module?: string; bin?: string | Record<string, string> };
      const dirs = [resolveEntry(pkgDir, pkg.main, extensions), resolveEntry(pkgDir, pkg.module, extensions)];
      if (typeof pkg.bin === 'string') dirs.push(resolveEntry(pkgDir, pkg.bin, extensions));
      else if (pkg.bin && typeof pkg.bin === 'object')
        for (const v of Object.values(pkg.bin)) dirs.push(resolveEntry(pkgDir, typeof v === 'string' ? v : undefined, extensions));
      for (const list of dirs) {
        for (const p of list) {
          try {
            const s = await stat(p).catch(() => null);
            if (s?.isFile()) entryPaths.push(p);
          } catch {
            // skip
          }
        }
      }
    } catch {
      // skip invalid or missing package.json
    }
  }
  return [...new Set(entryPaths)];
}

// =============================================================================
// Analysis
// =============================================================================

/**
 * Analyze all TypeScript files in a directory and return aggregated IRs.
 */
export function analyzeProject(
  dirPath: string,
  options: AnalyzeProjectOptions = {},
): Effect.Effect<ProjectAnalysisResult> {
  const extensions = (options.extensions ?? DEFAULT_OPTIONS.extensions)!;
  const maxDepth = (options.maxDepth ?? DEFAULT_OPTIONS.maxDepth)!;
  return Effect.gen(function* () {
    const files = yield* Effect.promise(() =>
      findTsFiles(dirPath, extensions, maxDepth, 0),
    );
    const byFile = new Map<string, readonly StaticEffectIR[]>();
    const allPrograms: StaticEffectIR[] = [];
    const entryPointFiles: string[] = [];
    const failedFiles: ProjectFileFailure[] = [];
    const zeroProgramFiles: string[] = [];

    for (const file of files) {
      const result = yield* analyze(file, {
        tsConfigPath: options.tsconfig,
        knownEffectInternalsRoot: options.knownEffectInternalsRoot,
      })
        .all()
        .pipe(
          Effect.map((programs) => ({ _tag: 'ok' as const, programs })),
          Effect.catchAll((err) =>
            Effect.succeed({
              _tag: 'fail' as const,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      if (result._tag === 'fail') {
        failedFiles.push({ file, error: result.error });
        continue;
      }
      const programs = result.programs;
      if (programs.length === 0) {
        zeroProgramFiles.push(file);
        continue;
      }
      byFile.set(file, programs);
      allPrograms.push(...programs);
      for (const ir of programs) {
        const nameLikeEntry =
          ir.root.programName === 'main' || ir.root.programName.includes('run');
        const isRunCall = ir.root.source === 'run';
        if (nameLikeEntry || isRunCall) {
          if (!entryPointFiles.includes(file)) entryPointFiles.push(file);
        }
      }
    }

    const packageEntryPaths = yield* Effect.promise(() =>
      getEntryPointsFromPackageJson(dirPath, extensions),
    );
    for (const p of packageEntryPaths) {
      if (files.includes(p) && !entryPointFiles.includes(p)) {
        entryPointFiles.push(p);
      }
    }

    for (const file of byFile.keys()) {
      if (entryPointFiles.includes(file)) continue;
      const hasRun = yield* Effect.promise(() => fileHasTopLevelRunCall(file));
      if (hasRun) entryPointFiles.push(file);
    }

    // Optionally build the deduplicated service map
    let serviceMap: ProjectServiceMap | undefined;
    if (options.buildServiceMap) {
      try {
        const { Project } = loadTsMorph();
        const project = new Project({
          skipAddingFilesFromTsConfig: true,
          compilerOptions: { allowJs: true },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sourceFileMap = new Map<string, any>();
        for (const file of byFile.keys()) {
          try {
            const sf = project.addSourceFileAtPath(file);
            sourceFileMap.set(file, sf);
          } catch {
            // skip files that can't be loaded
          }
        }
        serviceMap = buildProjectServiceMap(byFile, sourceFileMap);
      } catch {
        // Fall back to IR-only service map (no AST-level extraction)
        serviceMap = buildProjectServiceMap(byFile);
      }
    }

    return {
      byFile,
      allPrograms,
      entryPointFiles,
      fileCount: files.length,
      failedFiles,
      zeroProgramFiles,
      serviceMap,
    };
  });
}

// =============================================================================
// Coverage audit (missing-gaps: discovered vs analyzed, failed/skipped list)
// =============================================================================

/**
 * Run a coverage audit over a directory: discover all .ts/.tsx files, analyze each,
 * and return counts plus per-file outcomes (ok / zero programs / failed with reason).
 * Does not swallow failures; every file gets an outcome.
 */
export function runCoverageAudit(
  dirPath: string,
  options: AnalyzeProjectOptions = {},
): Effect.Effect<CoverageAuditResult> {
  const extensions = (options.extensions ?? DEFAULT_OPTIONS.extensions)!;
  const maxDepth = (options.maxDepth ?? DEFAULT_OPTIONS.maxDepth)!;
  return Effect.gen(function* () {
    const startMs = Date.now();
    const files = yield* Effect.promise(() =>
      findTsFiles(dirPath, extensions, maxDepth, 0),
    );
    const outcomes: FileOutcome[] = [];
    let totalNodes = 0;
    let unknownNodes = 0;
    const fileUnknownRates: { file: string; total: number; unknown: number }[] = [];
    const unknownReasonsCorpus = new Map<string, number>();

    const includePerFileTiming = options.includePerFileTiming === true;
    for (const file of files) {
      const fileStartMs = includePerFileTiming ? Date.now() : 0;
      const result = yield* analyze(file, {
        tsConfigPath: options.tsconfig,
        knownEffectInternalsRoot: options.knownEffectInternalsRoot,
      })
        .all()
        .pipe(
          Effect.map((programs) => ({ _tag: 'ok' as const, programs })),
          Effect.catchAll((err) =>
            Effect.succeed({
              _tag: 'fail' as const,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      const durationMs = includePerFileTiming ? Date.now() - fileStartMs : undefined;
      if (result._tag === 'ok') {
        const count = result.programs.length;
        let fileTotal = 0;
        let fileUnknown = 0;
        for (const ir of result.programs) {
          const counts = countNodes(ir.root.children);
          totalNodes += counts.total;
          unknownNodes += counts.unknown;
          fileTotal += counts.total;
          fileUnknown += counts.unknown;
          const reasonCounts = countUnknownReasons(ir.root.children);
          for (const [reason, n] of reasonCounts) {
            unknownReasonsCorpus.set(reason, (unknownReasonsCorpus.get(reason) ?? 0) + n);
          }
        }
        if (fileTotal > 0) {
          fileUnknownRates.push({ file, total: fileTotal, unknown: fileUnknown });
        }
        outcomes.push(
          count > 0
            ? { file, status: 'ok', programCount: count, ...(durationMs !== undefined ? { durationMs } : {}) }
            : { file, status: 'zero', programCount: 0, ...(durationMs !== undefined ? { durationMs } : {}) },
        );
      } else {
        const msg = result.error ?? '';
        const isZeroPrograms =
          msg.includes('No Effect programs found') || msg.includes('NO_EFFECTS_FOUND');
        outcomes.push(
          isZeroPrograms
            ? { file, status: 'zero', programCount: 0, ...(durationMs !== undefined ? { durationMs } : {}) }
            : { file, status: 'fail', error: result.error, ...(durationMs !== undefined ? { durationMs } : {}) },
        );
      }
    }

    const discovered = files.length;
    const analyzed = outcomes.filter((o) => o.status === 'ok').length;
    const zeroPrograms = outcomes.filter((o) => o.status === 'zero').length;
    const failed = outcomes.filter((o) => o.status === 'fail').length;
    const percentage = discovered > 0 ? (analyzed / discovered) * 100 : 0;
    const analyzableCoverage = (analyzed + failed) > 0
      ? (analyzed / (analyzed + failed)) * 100
      : 100;

    const excludePatterns = options.excludeFromSuspiciousZeros ?? [];
    const isExcludedFromSuspicious = (filePath: string): boolean => {
      const normalized = filePath.replace(/\\/g, '/');
      return excludePatterns.some(
        (p) => normalized.includes(p.replace(/\\/g, '/')) || normalized.endsWith(p.replace(/\\/g, '/')),
      );
    };
    const zeroProgramCategoryCounts: Record<ZeroProgramCategory, number> = {
      barrel_or_index: 0,
      config_or_build: 0,
      test_or_dtslint: 0,
      type_only: 0,
      suspicious: 0,
      other: 0,
    };
    const suspiciousZeros: string[] = [];
    const zeroProgramClassifications: ZeroProgramClassification[] = [];

    const zeroOutcomes = outcomes.filter((o) => o.status === 'zero');
    for (const o of zeroOutcomes) {
      const importsEffect = fileImportsEffect(o.file);
      const expectedCategory = detectExpectedZeroCategory(o.file);
      const category: ZeroProgramCategory =
        importsEffect && !isExcludedFromSuspicious(o.file) && expectedCategory === undefined
          ? 'suspicious'
          : (expectedCategory ?? 'other');

      zeroProgramCategoryCounts[category]++;
      zeroProgramClassifications.push({ file: o.file, category, importsEffect });
      if (category === 'suspicious') suspiciousZeros.push(o.file);
    }
    const unknownNodeRate = totalNodes > 0 ? unknownNodes / totalNodes : 0;
    const topUnknownFiles = fileUnknownRates
      .filter((f) => f.total > 0)
      .sort((a, b) => (b.unknown / b.total) - (a.unknown / a.total))
      .slice(0, 10)
      .map((f) => f.file);

    const unknownReasonCounts: Record<string, number> = {};
    for (const [reason, n] of unknownReasonsCorpus) unknownReasonCounts[reason] = n;
    const topUnknownReasons = [...unknownReasonsCorpus.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([reason, count]) => ({ reason, count }));

    const durationMs = Date.now() - startMs;
    return {
      discovered,
      analyzed,
      zeroPrograms,
      failed,
      outcomes,
      percentage,
      analyzableCoverage,
      unknownNodeRate,
      totalNodes,
      unknownNodes,
      suspiciousZeros,
      zeroProgramCategoryCounts,
      zeroProgramClassifications,
      topUnknownFiles,
      unknownReasonCounts,
      topUnknownReasons,
      durationMs,
    };
  });
}
