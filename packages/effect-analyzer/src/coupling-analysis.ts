/**
 * Coupling Analysis — file-level import dependency metrics.
 *
 * Computes fan-in (incoming imports) and fan-out (outgoing imports) per file
 * across a TypeScript project. Detects high-coupling files ("god modules")
 * and supports known-hub annotations to suppress intentional hubs.
 *
 * Known-hub annotation — accepted forms (anywhere in the leading comment
 * block at the top of a file):
 *   // effect-analyzer-known-hub <reason>
 *   /** @known-hub <reason> *\/
 * The first match wins. Marks the file as an intentional hub, excluding it
 * from high-fan-in alerts while still reporting its metrics. Critical fan-in
 * is still reported as low-impact info so growth can be monitored.
 */

import { existsSync, readFileSync } from 'fs';
import { extname, relative, resolve, sep, dirname } from 'path';
import type { Project } from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';

// =============================================================================
// Types
// =============================================================================

export interface FileCouplingMetrics {
  readonly filePath: string;
  readonly projectFilePath: string;
  readonly fanIn: number;
  readonly fanOut: number;
  readonly knownHub: boolean;
  readonly knownHubReason: string;
  readonly importSources: readonly string[];
  readonly importedBy: readonly string[];
}

export interface CouplingIssue {
  readonly type: 'high-fanin' | 'critical-fanin' | 'high-fanout' | 'hub-without-annotation';
  readonly filePath: string;
  readonly projectFilePath: string;
  readonly metric: string;
  readonly value: number;
  readonly threshold: number;
  readonly description: string;
  readonly suggestion: string;
  readonly estimatedImpact: 'low' | 'medium' | 'high';
  readonly knownHub: boolean;
  readonly knownHubReason: string;
}

export interface CouplingAnalysis {
  readonly metrics: readonly FileCouplingMetrics[];
  readonly issues: readonly CouplingIssue[];
  readonly summary: CouplingSummary;
  readonly knownHubs: readonly FileCouplingMetrics[];
}

export interface CouplingSummary {
  readonly totalFiles: number;
  readonly analyzedFiles: number;
  readonly highFanInFiles: number;
  readonly criticalFanInFiles: number;
  readonly highFanOutFiles: number;
  readonly knownHubs: number;
  readonly unannotatedHubs: number;
  readonly parseFailures: number;
}

// =============================================================================
// Default thresholds
// =============================================================================

const DEFAULT_HIGH_FANIN = 15;
const DEFAULT_CRITICAL_FANIN = 30;
const DEFAULT_HIGH_FANOUT = 20;

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Node ESM convention: imports of TypeScript source use the compiled .js
 * extension. Map each runtime extension to the TS source extensions that
 * could compile to it, so `import '../foo.js'` resolves to `../foo.ts`.
 */
const JS_TO_TS_FALLBACKS: Record<string, readonly string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

// =============================================================================
// Path alias support (tsconfig.json compilerOptions.paths)
// =============================================================================

interface PathAliasEntry {
  readonly prefix: string;
  readonly target: string;
  readonly hasStar: boolean;
}

interface ResolvedAliases {
  readonly baseUrl: string;
  readonly aliases: readonly PathAliasEntry[];
}

function parseTsconfigPaths(tsconfigPath: string): ResolvedAliases | null {
  try {
    const content = readFileSync(tsconfigPath, 'utf-8');
    const parsed = JSON.parse(content);
    const compilerOptions = parsed.compilerOptions;
    if (!compilerOptions?.paths) return null;

    const tsconfigDir = dirname(resolve(tsconfigPath));
    const baseUrl = compilerOptions.baseUrl
      ? resolve(tsconfigDir, compilerOptions.baseUrl)
      : tsconfigDir;

    const aliases: PathAliasEntry[] = [];
    for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
      const targetArr = Array.isArray(targets) ? targets : [targets];
      const target = targetArr[0];
      if (typeof target !== 'string') continue;

      const hasStar = pattern.includes('*');
      const prefix = hasStar ? pattern.slice(0, pattern.indexOf('*')) : pattern;

      aliases.push({ prefix, target, hasStar });
    }

    aliases.sort((a, b) => b.prefix.length - a.prefix.length);

    return { baseUrl, aliases };
  } catch {
    return null;
  }
}

/**
 * Try to resolve an import specifier through configured tsconfig path aliases.
 * Returns null if no alias matches or the resolved path doesn't exist as a
 * known file.
 */
function tryResolveAlias(
  specifier: string,
  project: Project,
  projectRoot: string,
  resolvedAliases: ResolvedAliases,
): string | null {
  for (const alias of resolvedAliases.aliases) {
    if (!specifier.startsWith(alias.prefix)) continue;

    let rest: string;
    if (alias.hasStar) {
      rest = specifier.slice(alias.prefix.length);
      if (!rest && alias.prefix === specifier) {
        rest = '';
      }
      const targetPath = alias.target.replace('*', rest);
      const resolved = resolve(resolvedAliases.baseUrl, targetPath);
      const found = resolveAliasToFile(resolved, project);
      if (found && found.startsWith(projectRoot)) return found;
    } else {
      if (specifier !== alias.prefix && !specifier.startsWith(alias.prefix + '/')) {
        continue;
      }
      const resolved = resolve(resolvedAliases.baseUrl, alias.target);
      const found = resolveAliasToFile(resolved, project);
      if (found && found.startsWith(projectRoot)) return found;
    }
  }
  return null;
}

/**
 * Given a resolved absolute path (from tsconfig alias resolution), try to find
 * the actual source file by checking with and without extensions, and as a
 * directory with an index file.
 */
function resolveAliasToFile(resolved: string, project: Project): string | null {
  const ext = extname(resolved);
  if (ext && RESOLVE_EXTENSIONS.includes(ext)) {
    if (candidateExists(resolved, project)) return resolved;
    return null;
  }

  for (const e of RESOLVE_EXTENSIONS) {
    const candidate = resolved + e;
    if (candidateExists(candidate, project)) return candidate;
  }

  for (const e of RESOLVE_EXTENSIONS) {
    const candidate = resolve(resolved, `index${e}`);
    if (candidateExists(candidate, project)) return candidate;
  }

  return null;
}

// =============================================================================
// Known-hub annotation detection
// =============================================================================

const LINE_HUB_RE = /\/\/\s*effect-analyzer-known-hub\b\s*(.*)$/m;
const JSDOC_HUB_RE = /@known-hub\b\s*([^\n*]*)/;

/**
 * Extract the leading comment block (line + block comments and blanks) from a
 * source file, stopping at the first non-comment, non-blank line. This is more
 * robust than a fixed line window — license headers + JSDoc can easily exceed
 * 10 lines.
 */
function extractLeadingCommentBlock(content: string): string {
  const lines = content.split('\n');
  const captured: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlock) {
      captured.push(raw);
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line === '') {
      captured.push(raw);
      continue;
    }
    if (line.startsWith('//')) {
      captured.push(raw);
      continue;
    }
    if (line.startsWith('/*')) {
      captured.push(raw);
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    break;
  }
  return captured.join('\n');
}

function detectKnownHub(filePath: string, project: Project): { hub: boolean; reason: string } {
  let content: string | undefined;
  const sf = project.getSourceFile(filePath);
  if (sf) {
    content = sf.getFullText();
  } else {
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      return { hub: false, reason: '' };
    }
  }
  const header = extractLeadingCommentBlock(content);
  const lineMatch = LINE_HUB_RE.exec(header);
  if (lineMatch) {
    return { hub: true, reason: (lineMatch[1] ?? '').trim() || 'intentional hub' };
  }
  const jsdocMatch = JSDOC_HUB_RE.exec(header);
  if (jsdocMatch) {
    return { hub: true, reason: (jsdocMatch[1] ?? '').trim() || 'intentional hub' };
  }
  return { hub: false, reason: '' };
}

// =============================================================================
// Analysis
// =============================================================================

export interface AnalyzeCouplingOptions {
  readonly highFanInThreshold?: number;
  readonly criticalFanInThreshold?: number;
  readonly highFanOutThreshold?: number;
  readonly knownHubPaths?: readonly string[];
  readonly excludePatterns?: readonly string[];
  /**
   * Optional prebuilt ts-morph Project. When supplied, files are read from the
   * Project (which may use an in-memory file system) instead of disk. Useful
   * for tests and for sharing a Project across analyzers.
   */
  readonly project?: Project | undefined;
  /**
   * Path to tsconfig.json. When provided, `compilerOptions.paths` and
   * `compilerOptions.baseUrl` are used to resolve path aliases (e.g. `@/*`,
   * `~/*`, `@org/foo/*`). The longest-prefix-wins matching strategy is used,
   * with `*` wildcard support.
   */
  readonly tsconfig?: string | undefined;
  /**
   * Map of workspace package names to their source root directories. When a
   * specifier matches a package name, it is resolved against the mapped path.
   * Useful for pnpm/yarn workspaces where sibling packages import each other
   * by name without explicit tsconfig paths.
   */
  readonly workspacePackages?: Record<string, string> | undefined;
  /**
   * When true, fan-in is computed transitively through `export ... from`
   * re-exports. A consumer of a barrel file is also counted as a consumer of
   * the modules the barrel re-exports. Default: false (direct fan-in only).
   */
  readonly transitive?: boolean | undefined;
}

export function analyzeCoupling(
  files: readonly string[],
  projectRoot: string,
  options: AnalyzeCouplingOptions = {},
): CouplingAnalysis {
  const highFanIn = options.highFanInThreshold ?? DEFAULT_HIGH_FANIN;
  const criticalFanIn = options.criticalFanInThreshold ?? DEFAULT_CRITICAL_FANIN;
  const highFanOut = options.highFanOutThreshold ?? DEFAULT_HIGH_FANOUT;
  const knownHubPaths = new Set(options.knownHubPaths ?? []);
  const excludePatterns = options.excludePatterns ?? [];

  const tsFiles = files.filter((f) => {
    if (!TS_EXTENSIONS.has(extname(f))) return false;
    for (const pat of excludePatterns) {
      if (f.includes(pat)) return false;
    }
    return true;
  });

  const normalizedRoot = resolve(projectRoot) + sep;

  // Path alias resolution from tsconfig
  const resolvedAliases: ResolvedAliases | null =
    options.tsconfig ? parseTsconfigPaths(options.tsconfig) : null;

  // Workspace package name → path mapping
  const workspacePackageMap = options.workspacePackages
    ? new Map(Object.entries(options.workspacePackages))
    : undefined;

  // Use a caller-supplied Project if provided (e.g. an in-memory one from
  // tests), otherwise build one and load files from disk. Skip tsconfig so we
  // don't pull in incidental files from typeRoots/lib settings.
  let project: Project;
  let parseFailures = 0;
  if (options.project) {
    project = options.project;
  } else {
    const { Project } = loadTsMorph();
    project = new Project({ skipAddingFilesFromTsConfig: true });
    for (const filePath of tsFiles) {
      try {
        project.addSourceFileAtPath(filePath);
      } catch {
        parseFailures++;
      }
    }
  }

  // File -> resolved import paths (internal only)
  const importMap = new Map<string, string[]>();
  // File -> set of files that import it (fan-in tracking)
  const reverseMap = new Map<string, Set<string>>();
  // File -> resolved re-export targets (only for export ... from declarations)
  const reexportMap = new Map<string, string[]>();

  for (const filePath of tsFiles) {
    const { imports, reexports } = parseImportsAst(project, filePath, normalizedRoot, resolvedAliases, workspacePackageMap);
    importMap.set(filePath, imports);
    if (reexports.length > 0) {
      reexportMap.set(filePath, reexports);
    }
  }

  for (const [importer, imported] of importMap) {
    for (const target of imported) {
      let set = reverseMap.get(target);
      if (!set) {
        set = new Set();
        reverseMap.set(target, set);
      }
      set.add(importer);
    }
  }

  const metrics: FileCouplingMetrics[] = [];
  for (const filePath of tsFiles) {
    const outbound = importMap.get(filePath) ?? [];
    const inbound = reverseMap.get(filePath);
    const fanOut = outbound.length;
    const fanIn = inbound?.size ?? 0;
    const projectFilePath = relative(normalizedRoot, filePath);
    const knownHubConfig = knownHubPaths.has(filePath);
    const { hub: knownHubComment, reason } = detectKnownHub(filePath, project);
    const knownHub = knownHubConfig || knownHubComment;
    const knownHubReason = knownHubComment ? reason : knownHubConfig ? 'configured hub' : '';

    metrics.push({
      filePath,
      projectFilePath,
      fanIn,
      fanOut,
      knownHub,
      knownHubReason,
      importSources: outbound,
      importedBy: inbound ? [...inbound] : [],
    });
  }

  // Transitive fan-in: propagate importers through re-export chains
  if (options.transitive && reexportMap.size > 0) {
    const reverseReexportMap = new Map<string, Set<string>>();
    for (const [reexporter, targets] of reexportMap) {
      for (const target of targets) {
        let set = reverseReexportMap.get(target);
        if (!set) {
          set = new Set();
          reverseReexportMap.set(target, set);
        }
        set.add(reexporter);
      }
    }

    for (const metric of metrics) {
      const transitiveFans = computeTransitiveImporters(
        metric.filePath,
        reverseMap,
        reverseReexportMap,
      );
      if (transitiveFans.size > metric.fanIn) {
        (metric as { fanIn: number }).fanIn = transitiveFans.size;
      }
    }
  }

  const issues: CouplingIssue[] = [];
  let highFanInFiles = 0;
  let criticalFanInFiles = 0;
  let highFanOutFiles = 0;
  let unannotatedHubs = 0;

  for (const m of metrics) {
    if (m.fanIn >= criticalFanIn) {
      if (m.knownHub) {
        issues.push({
          type: 'critical-fanin',
          filePath: m.filePath,
          projectFilePath: m.projectFilePath,
          metric: 'fan-in',
          value: m.fanIn,
          threshold: criticalFanIn,
          description: `File "${m.projectFilePath}" has fan-in ${m.fanIn} (critical) — marked as known hub (${m.knownHubReason}), but worth monitoring`,
          suggestion: 'Review if this hub is growing as expected. Consider splitting if fan-in continues to rise.',
          estimatedImpact: 'low',
          knownHub: m.knownHub,
          knownHubReason: m.knownHubReason,
        });
      } else {
        issues.push({
          type: 'critical-fanin',
          filePath: m.filePath,
          projectFilePath: m.projectFilePath,
          metric: 'fan-in',
          value: m.fanIn,
          threshold: criticalFanIn,
          description: `File "${m.projectFilePath}" has fan-in ${m.fanIn} (critical) — changes affect ${m.fanIn} dependents`,
          suggestion: 'Consider splitting this file into smaller modules. Extract stable interfaces. Add a `// effect-analyzer-known-hub <reason>` comment or `@known-hub <reason>` JSDoc tag if this is intentional.',
          estimatedImpact: 'high',
          knownHub: false,
          knownHubReason: '',
        });
        criticalFanInFiles++;
        unannotatedHubs++;
      }
    }

    if (m.fanIn >= highFanIn && m.fanIn < criticalFanIn) {
      if (m.knownHub) continue;
      issues.push({
        type: 'high-fanin',
        filePath: m.filePath,
        projectFilePath: m.projectFilePath,
        metric: 'fan-in',
        value: m.fanIn,
        threshold: highFanIn,
        description: `File "${m.projectFilePath}" has fan-in ${m.fanIn} (high) — changes affect ${m.fanIn} dependents`,
        suggestion: 'Consider reducing the import surface. Add a `// effect-analyzer-known-hub <reason>` comment or `@known-hub <reason>` JSDoc tag if this is intentional.',
        estimatedImpact: 'medium',
        knownHub: false,
        knownHubReason: '',
      });
      highFanInFiles++;
      unannotatedHubs++;
    }

    if (m.fanOut >= highFanOut) {
      issues.push({
        type: 'high-fanout',
        filePath: m.filePath,
        projectFilePath: m.projectFilePath,
        metric: 'fan-out',
        value: m.fanOut,
        threshold: highFanOut,
        description: `File "${m.projectFilePath}" imports ${m.fanOut} internal modules (high) — broad dependency scope`,
        suggestion: 'Reduce the number of internal imports. Consider consolidating dependencies or splitting the file by concern.',
        estimatedImpact: 'medium',
        knownHub: false,
        knownHubReason: '',
      });
      highFanOutFiles++;
    }
  }

  const typeOrder: Record<CouplingIssue['type'], number> = {
    'critical-fanin': 0,
    'high-fanin': 1,
    'hub-without-annotation': 2,
    'high-fanout': 3,
  };
  const sortedIssues = [...issues].sort((a, b) => {
    const cmp = typeOrder[a.type] - typeOrder[b.type];
    if (cmp !== 0) return cmp;
    return b.value - a.value;
  });

  // Only count known hubs that actually meet the high-fan-in threshold
  // (files annotated below threshold aren't really hubs at scale)
  const thresholdKnownHubs = metrics.filter(
    (m) => m.knownHub && m.fanIn >= highFanIn,
  );

  return {
    metrics,
    issues: sortedIssues,
    summary: {
      totalFiles: files.length,
      analyzedFiles: tsFiles.length,
      highFanInFiles,
      criticalFanInFiles,
      highFanOutFiles,
      knownHubs: thresholdKnownHubs.length,
      unannotatedHubs,
      parseFailures,
    },
    knownHubs: metrics.filter((m) => m.knownHub),
  };
}

/**
 * Compute transitive fan-in for a file by walking upward through re-export
 * chains. If file C is re-exported by B, and B is imported by A, then A is
 * also a transitive importer of C.
 */
function computeTransitiveImporters(
  filePath: string,
  reverseMap: Map<string, Set<string>>,
  reverseReexportMap: Map<string, Set<string>>,
): Set<string> {
  const result = new Set(reverseMap.get(filePath) ?? []);
  const visited = new Set<string>();
  const queue = [...(reverseReexportMap.get(filePath) ?? [])];

  while (queue.length > 0) {
    const reexporter = queue.shift()!;
    if (visited.has(reexporter)) continue;
    visited.add(reexporter);

    const importersOfReexporter = reverseMap.get(reexporter);
    if (importersOfReexporter) {
      for (const imp of importersOfReexporter) {
        result.add(imp);
      }
    }

    const higherReexporters = reverseReexportMap.get(reexporter);
    if (higherReexporters) {
      for (const hr of higherReexporters) {
        if (!visited.has(hr)) {
          queue.push(hr);
        }
      }
    }
  }

  return result;
}

// =============================================================================
// Import parsing (AST)
// =============================================================================

/**
 * Walk import/export declarations and dynamic imports via the TS AST. Returns
 * resolved file paths for internal imports (within the project root), with
 * duplicates collapsed.
 */
function parseImportsAst(
  project: Project,
  filePath: string,
  projectRoot: string,
  resolvedAliases: ResolvedAliases | null = null,
  workspacePackageMap?: Map<string, string>,
): { imports: string[]; reexports: string[] } {
  const sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) return { imports: [], reexports: [] };

  const { SyntaxKind } = loadTsMorph();
  const importSpecifiers = new Set<string>();
  const reexportSpecifiers = new Set<string>();

  for (const decl of sourceFile.getImportDeclarations()) {
    importSpecifiers.add(decl.getModuleSpecifierValue());
  }
  for (const decl of sourceFile.getExportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec) {
      // Re-exports (export ... from ...)
      reexportSpecifiers.add(spec);
      importSpecifiers.add(spec);
    }
  }
  // Dynamic imports: import('...')
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [arg] = call.getArguments();
    if (arg?.getKind() === SyntaxKind.StringLiteral) {
      importSpecifiers.add(arg.getText().slice(1, -1));
    }
  }

  const resolvedImports: string[] = [];
  const resolvedReexports: string[] = [];
  for (const spec of importSpecifiers) {
    const r = tryResolveInternal(spec, filePath, projectRoot, project, resolvedAliases, workspacePackageMap);
    if (r) resolvedImports.push(r);
  }
  for (const spec of reexportSpecifiers) {
    const r = tryResolveInternal(spec, filePath, projectRoot, project, resolvedAliases, workspacePackageMap);
    if (r) resolvedReexports.push(r);
  }

  return {
    imports: [...new Set(resolvedImports)],
    reexports: [...new Set(resolvedReexports)],
  };
}

/**
 * Check whether a candidate path is a known file. Looks in the Project first
 * (so in-memory file systems work), then falls back to a disk existence check.
 */
function candidateExists(candidate: string, project: Project): boolean {
  if (project.getSourceFile(candidate)) return true;
  return existsSync(candidate);
}

/**
 * Try to resolve an import specifier to an internal file path within the
 * project root. Returns null for external/npm imports.
 */
function tryResolveInternal(
  specifier: string,
  sourceFile: string,
  projectRoot: string,
  project: Project,
  resolvedAliases: ResolvedAliases | null = null,
  workspacePackageMap?: Map<string, string>,
): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    // Try tsconfig path aliases first (longest-prefix-wins)
    if (resolvedAliases) {
      const aliasResult = tryResolveAlias(specifier, project, projectRoot, resolvedAliases);
      if (aliasResult) return aliasResult;
    }
    // Try workspace package names (e.g. @org/foo resolves to packages/foo/src)
    if (workspacePackageMap) {
      for (const [pkgName, pkgPath] of workspacePackageMap) {
        if (specifier === pkgName || specifier.startsWith(pkgName + '/')) {
          const rest = specifier.slice(pkgName.length);
          const candidate = resolve(pkgPath, rest.length > 0 ? rest.slice(1) : '.');
          const found = resolveAliasToFile(candidate, project);
          if (found && found.startsWith(projectRoot)) return found;
        }
      }
    }
    return null;
  }

  const sourceDir = resolve(sourceFile, '..');
  const ext = extname(specifier);

  if (ext && RESOLVE_EXTENSIONS.includes(ext)) {
    const direct = resolve(sourceDir, specifier);
    if (!direct.startsWith(projectRoot)) return null;
    if (candidateExists(direct, project)) return direct;

    // Node ESM: import path uses .js but on-disk source is .ts. Try the
    // matching TS source extension before giving up.
    const tsFallbacks = JS_TO_TS_FALLBACKS[ext];
    if (tsFallbacks) {
      const base = direct.slice(0, -ext.length);
      for (const tsExt of tsFallbacks) {
        const candidate = base + tsExt;
        if (candidateExists(candidate, project)) return candidate;
      }
    }
    return direct;
  }

  // Try with each extension.
  for (const e of RESOLVE_EXTENSIONS) {
    const candidate = resolve(sourceDir, specifier + e);
    if (!candidate.startsWith(projectRoot)) continue;
    if (candidateExists(candidate, project)) return candidate;
  }

  // Try as directory with index file.
  for (const e of RESOLVE_EXTENSIONS) {
    const candidate = resolve(sourceDir, specifier, `index${e}`);
    if (!candidate.startsWith(projectRoot)) continue;
    if (candidateExists(candidate, project)) return candidate;
  }

  // Best-guess fallback (used when the target file isn't on disk yet, e.g.
  // mid-refactor); still constrained to the project root.
  const guessed = resolve(sourceDir, specifier + '.ts');
  return guessed.startsWith(projectRoot) ? guessed : null;
}

// =============================================================================
// Renderers
// =============================================================================

export const renderCouplingReport = (analysis: CouplingAnalysis): string => {
  const lines: string[] = [];
  const s = analysis.summary;

  lines.push('# Module Coupling Analysis\n');
  lines.push('## Summary\n');
  lines.push(`- Total files: ${s.totalFiles}`);
  lines.push(`- Analyzed files: ${s.analyzedFiles}`);
  lines.push(`- High fan-in files: ${s.highFanInFiles}`);
  lines.push(`- Critical fan-in files: ${s.criticalFanInFiles}`);
  lines.push(`- High fan-out files: ${s.highFanOutFiles}`);
  lines.push(`- Known hubs (annotated at scale): ${s.knownHubs}`);
  lines.push(`- Unannotated hubs: ${s.unannotatedHubs}`);
  if (s.parseFailures > 0) {
    lines.push(`- ⚠️ Parse failures: ${s.parseFailures} (fan-in numbers may undercount)`);
  }
  lines.push('');

  if (analysis.issues.length > 0) {
    lines.push('## Issues\n');
    for (const issue of analysis.issues) {
      const icon = issue.type === 'critical-fanin' ? '🔴' : issue.type === 'high-fanin' ? '🟡' : '🟢';
      lines.push(`${icon} **[${issue.type}]** \`${issue.projectFilePath || issue.filePath}\``);
      lines.push(`   ${issue.description}`);
      lines.push(`   💡 ${issue.suggestion}`);
      lines.push('');
    }
  }

  if (analysis.knownHubs.length > 0) {
    lines.push('## Known Hubs (Annotated)\n');
    for (const hub of analysis.knownHubs) {
      lines.push(`- \`${hub.projectFilePath}\` — fan-in: ${hub.fanIn}, fan-out: ${hub.fanOut} — ${hub.knownHubReason}`);
    }
    lines.push('');
  }

  if (analysis.metrics.length > 0) {
    lines.push('## All Files (sorted by fan-in)\n');
    const sorted = [...analysis.metrics].sort((a, b) => b.fanIn - a.fanIn);
    lines.push('| File | Fan-in | Fan-out | Known hub |');
    lines.push('|------|--------|---------|-----------|');
    for (const m of sorted.slice(0, 30)) {
      const known = m.knownHub ? ` (${m.knownHubReason})` : '';
      lines.push(`| \`${m.projectFilePath}\` | ${m.fanIn} | ${m.fanOut} | ${m.knownHub ? '✅' + known : ''} |`);
    }
    if (sorted.length > 30) {
      lines.push(`| ... and ${sorted.length - 30} more (use \`--format json\` for full list) |`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

export const renderCouplingJson = (
  analysis: CouplingAnalysis,
  pretty = true,
): string => JSON.stringify(analysis, null, pretty ? 2 : 0);
