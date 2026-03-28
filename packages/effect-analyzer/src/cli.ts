/**
 * CLI entry point for effect-analyzer
 */

import './register-node-ts-morph';
import { resolve, sep, join, dirname, extname } from 'path';
import { watch, existsSync } from 'fs';
import * as fs from 'node:fs/promises';
import { Project } from 'ts-morph';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { Effect, Console, Exit, Option } from 'effect';
import { analyze } from './analyze';
import { analyzeEffectSource, analyzeEffectFile } from './static-analyzer';
import {
  getStaticChildren,
  type StaticFlowNode,
  type StaticEffectIR,
  type DiagramQuality,
} from './types';
import {
  renderMermaid,
  renderStaticMermaid,
  renderPathsMermaid,
  renderEnhancedMermaid,
} from './output/mermaid';
import { renderRailwayMermaid } from './output/mermaid-railway';
import { renderServicesMermaid, renderServicesMermaidFromMap } from './output/mermaid-services';
import { renderErrorsMermaid } from './output/mermaid-errors';
import { renderDecisionsMermaid } from './output/mermaid-decisions';
import { renderCausesMermaid } from './output/mermaid-causes';
import { renderConcurrencyMermaid } from './output/mermaid-concurrency';
import { renderTimelineMermaid } from './output/mermaid-timeline';
import { renderLayersMermaid } from './output/mermaid-layers';
import { renderRetryMermaid } from './output/mermaid-retry';
import { renderTestabilityMermaid } from './output/mermaid-testability';
import { renderDataflowMermaid } from './output/mermaid-dataflow';
import { selectFormats } from './output/auto-format';
import { diffPrograms, renderDiffMarkdown, renderDiffJSON, renderDiffMermaid, parseSourceArg, resolveGitSource, resolveGitHubPR } from './diff';
import { generatePaths } from './path-generator';
import { renderJSON, renderMultipleJSON } from './output/json';
import { generateMultipleShowcase } from './output/showcase';
import {
  findMigrationOpportunities,
  findMigrationOpportunitiesInProject,
  formatMigrationReport,
} from './migration-assistant';
import { getCached, setCached } from './analysis-cache';
import { runCoverageAudit, analyzeProject } from './project-analyzer';
import { writeColocatedOutputForFile, writeAllServiceArtifacts } from './output/colocate';
import { renderMultipleExplanations } from './output/explain';
import { renderMultipleSummaries } from './output/summary';
import { renderDependencyMatrix, renderDependencyMatrixFromServiceMap } from './output/matrix';
import { renderServiceGraphMermaid } from './output/mermaid';
import { renderApiDocsMarkdown, renderOpenApiPaths } from './output/api-docs';
import { extractHttpApiStructure, type HttpApiStructure } from './http-api-extractor';
import {
  computeProgramDiagramQuality,
  computeFileDiagramQuality,
  buildTopOffendersReport,
  type DiagramQualityHintInput,
} from './diagram-quality';
import { loadDiagramQualityHintsFromEslintJson } from './diagram-quality-eslint';

type MermaidDirection = 'TB' | 'LR' | 'BT' | 'RL';

/** ANSI colors for gold-tier verbose output (disabled when --no-color or not TTY). */
function createStyle(useColor: boolean) {
  const c = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    dim: c(2),
    green: c(32),
    cyan: c(36),
    yellow: c(33),
    red: c(31),
    bold: c(1),
  };
}

interface CLIOptions {
  readonly format: 'auto' | 'json' | 'mermaid' | 'mermaid-paths' | 'mermaid-enhanced' | 'mermaid-railway' | 'mermaid-services' | 'mermaid-errors' | 'mermaid-decisions' | 'mermaid-causes' | 'mermaid-concurrency' | 'mermaid-timeline' | 'mermaid-layers' | 'mermaid-retry' | 'mermaid-testability' | 'mermaid-dataflow' | 'stats' | 'migration' | 'showcase' | 'explain' | 'summary' | 'matrix' | 'api-docs' | 'openapi-paths' | 'openapi-runtime';
  readonly openapiExport: string | undefined;
  readonly output: string | undefined;
  readonly pretty: boolean;
  readonly includeMetadata: boolean;
  readonly direction: MermaidDirection;
  readonly tsconfig: string | undefined;
  readonly colocate: boolean;
  readonly noColocate: boolean;
  readonly colocateSuffix: string;
  readonly colocateEnhanced: boolean;
  readonly watch: boolean;
  readonly migration: boolean;
  readonly cache: boolean;
  readonly coverageAudit: boolean;
  readonly showSuspiciousZeros: boolean;
  readonly showTopUnknown: boolean;
  readonly showTopUnknownReasons: boolean;
  readonly showOkZeroFailByFolder: boolean;
  readonly jsonSummary: boolean;
  readonly perFileTiming: boolean;
  readonly minMeaningfulNodes: number | undefined;
  readonly excludeFromSuspiciousZeros: string[];
  readonly knownEffectInternalsRoot: string | undefined;
  readonly quiet: boolean;
  readonly color: boolean;
  readonly quality: boolean;
  readonly qualityEslint: string | undefined;
  readonly styleGuide: boolean;
  readonly serviceMap: boolean;
  readonly diff: boolean;
  readonly diffSources: readonly string[];
  readonly regression: boolean;
  readonly includeTrivial: boolean;
}

function parseArgs(args: readonly string[]): { pathArg: string | undefined; options: CLIOptions } {
  let pathArg: string | undefined;
  let format: CLIOptions['format'] = 'auto';
  let output: string | undefined;
  let pretty = true;
  let includeMetadata = true;
  let direction: MermaidDirection = 'TB';
  let tsconfig: string | undefined;
  let colocate = false;
  let noColocate = false;
  let colocateSuffix = 'effect-analysis';
  let colocateEnhanced = true;
  let watch = false;
  let migration = false;
  let cache = false;
  let coverageAudit = false;
  let showSuspiciousZeros = false;
  let showTopUnknown = false;
  let explicitNoShowTopUnknown = false;
  let showTopUnknownReasons = false;
  let explicitNoShowTopUnknownReasons = false;
  let showOkZeroFailByFolder = false;
  let jsonSummary = false;
  let perFileTiming = false;
  let minMeaningfulNodes: number | undefined;
  const excludeFromSuspiciousZeros: string[] = [];
  let knownEffectInternalsRoot: string | undefined;
  let quiet = false;
  let color = true;
  let quality = false;
  let qualityEslint: string | undefined;
  let styleGuide = false;
  let explicitNoStyleGuide = false;
  let serviceMap = true;
  let openapiExport: string | undefined;
  let diff = false;
  let regression = false;
  let includeTrivial = false;
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (!arg.startsWith('-')) {
      positionalArgs.push(arg);
      pathArg ??= arg;
      continue;
    }

    if (arg === '--format' || arg === '-f') {
      const value = args[++i];
      if (
        value === 'auto' ||
        value === 'json' ||
        value === 'mermaid' ||
        value === 'mermaid-paths' ||
        value === 'mermaid-enhanced' ||
        value === 'mermaid-railway' ||
        value === 'mermaid-services' ||
        value === 'mermaid-errors' ||
        value === 'mermaid-decisions' ||
        value === 'mermaid-causes' ||
        value === 'mermaid-concurrency' ||
        value === 'mermaid-timeline' ||
        value === 'mermaid-layers' ||
        value === 'mermaid-retry' ||
        value === 'mermaid-testability' ||
        value === 'mermaid-dataflow' ||
        value === 'stats' ||
        value === 'migration' ||
        value === 'showcase' ||
        value === 'explain' ||
        value === 'summary' ||
        value === 'matrix' ||
        value === 'api-docs' ||
        value === 'openapi-paths' ||
        value === 'openapi-runtime'
      ) {
        format = value;
      }
    } else if (arg === '--export') {
      openapiExport = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      output = args[++i];
    } else if (arg === '--compact' || arg === '-c') {
      pretty = false;
    } else if (arg === '--pretty') {
      pretty = true;
    } else if (arg === '--no-metadata') {
      includeMetadata = false;
    } else if (arg === '--direction' || arg === '-d') {
      const value = args[++i];
      if (
        value === 'TB' ||
        value === 'LR' ||
        value === 'BT' ||
        value === 'RL'
      ) {
        direction = value;
      }
    } else if (arg === '--tsconfig') {
      tsconfig = args[++i];
    } else if (arg.startsWith('--tsconfig=')) {
      tsconfig = arg.slice('--tsconfig='.length);
    } else if (arg === '--colocate') {
      colocate = true;
    } else if (arg === '--no-colocate') {
      noColocate = true;
    } else if (arg === '--no-colocate-enhanced') {
      colocateEnhanced = false;
    } else if (arg === '--colocate-suffix') {
      const value = args[++i];
      if (value) {
        colocateSuffix = value;
      }
    } else if (arg.startsWith('--colocate-suffix=')) {
      colocateSuffix = arg.slice('--colocate-suffix='.length);
    } else if (arg === '--watch' || arg === '-w') {
      watch = true;
    } else if (arg === '--migration' || arg === '-m') {
      migration = true;
    } else if (arg === '--cache') {
      cache = true;
    } else if (arg === '--coverage-audit') {
      coverageAudit = true;
    } else if (arg === '--show-suspicious-zeros') {
      showSuspiciousZeros = true;
    } else if (arg === '--show-top-unknown') {
      showTopUnknown = true;
    } else if (arg === '--no-show-top-unknown') {
      showTopUnknown = false;
      explicitNoShowTopUnknown = true;
    } else if (arg === '--show-top-unknown-reasons') {
      showTopUnknownReasons = true;
    } else if (arg === '--no-show-top-unknown-reasons') {
      showTopUnknownReasons = false;
      explicitNoShowTopUnknownReasons = true;
    } else if (arg === '--show-by-folder') {
      showOkZeroFailByFolder = true;
    } else if (arg === '--per-file-timing') {
      perFileTiming = true;
    } else if (arg === '--min-meaningful-nodes') {
      const value = args[++i];
      if (value !== undefined) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          minMeaningfulNodes = parsed;
        }
      }
    } else if (arg === '--exclude-from-suspicious-zero') {
      const value = args[++i];
      if (value !== undefined) excludeFromSuspiciousZeros.push(value);
    } else if (arg === '--known-effect-internals-root') {
      knownEffectInternalsRoot = args[++i];
    } else if (arg === '--json-summary') {
      jsonSummary = true;
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else if (arg === '--no-color') {
      color = false;
    } else if (arg === '--quality') {
      quality = true;
    } else if (arg === '--quality-eslint') {
      qualityEslint = args[++i];
    } else if (arg.startsWith('--quality-eslint=')) {
      qualityEslint = arg.slice('--quality-eslint='.length);
    } else if (arg === '--style-guide') {
      styleGuide = true;
    } else if (arg === '--no-style-guide') {
      styleGuide = false;
      explicitNoStyleGuide = true;
    } else if (arg === '--service-map') {
      serviceMap = true;
    } else if (arg === '--no-service-map') {
      serviceMap = false;
    } else if (arg === '--diff') {
      diff = true;
    } else if (arg === '--regression') {
      regression = true;
    } else if (arg === '--include-trivial') {
      includeTrivial = true;
    }
  }

  // In diff mode, all positional args are diff sources
  const diffSources = diff ? positionalArgs : [];

  if (migration) format = 'migration';

  // Format-dependent defaults: mermaid-paths benefits from style-guide heuristics
  if (format === 'mermaid-paths' && !explicitNoStyleGuide && !styleGuide) {
    styleGuide = true;
  }

  // Coverage audit: show top unknown files and reasons by default (bounded, useful for prioritization)
  if (coverageAudit) {
    if (!explicitNoShowTopUnknown) showTopUnknown = true;
    if (!explicitNoShowTopUnknownReasons) showTopUnknownReasons = true;
  }

  const options: CLIOptions = {
    format,
    output,
    pretty,
    includeMetadata,
    direction,
    tsconfig,
    colocate,
    noColocate,
    colocateSuffix,
    colocateEnhanced,
    watch,
    migration,
    cache,
    coverageAudit,
    showSuspiciousZeros,
    showTopUnknown,
    showTopUnknownReasons,
    showOkZeroFailByFolder,
    jsonSummary,
    perFileTiming,
    minMeaningfulNodes,
    excludeFromSuspiciousZeros,
    knownEffectInternalsRoot,
    quiet,
    color,
    quality,
    qualityEslint,
    styleGuide,
    serviceMap,
    openapiExport,
    diff,
    diffSources,
    regression,
    includeTrivial,
  };
  return { pathArg, options };
}

const printHelp = (): void => {
  process.stdout.write(`
effect-analyzer - Static analysis for Effect-TS

Usage: effect-analyze [PATH] [options]

  PATH is optional and defaults to the current directory (.).
  When PATH is a directory: analyzes all TypeScript files and writes colocated
  .effect-analysis.md next to each file that contains Effect programs (gold-tier:
  verbose output, enhanced Mermaid, colors). Use --no-colocate to skip writing files.

Options:
  -f, --format <format>    Output format: auto | json | mermaid | mermaid-paths | mermaid-enhanced | mermaid-railway | mermaid-services | mermaid-errors | mermaid-decisions | mermaid-causes | mermaid-concurrency | mermaid-timeline | mermaid-layers | mermaid-retry | mermaid-testability | mermaid-dataflow | stats | showcase | explain | summary | matrix | api-docs | openapi-paths | openapi-runtime (default: auto)
  --export <name>          For openapi-runtime: export name of HttpApi (default: first/default)
  -o, --output <file>      Output file (default: stdout)
  -d, --direction <dir>    Mermaid diagram direction: TB | LR | BT | RL (default: TB)
  -c, --compact            Compact output (no formatting)
  --pretty                 Pretty-print output (default; overrides --compact)
  --tsconfig <path>        Path to tsconfig.json for resolution (e.g. when analyzing external repo)
  --no-metadata            Exclude metadata from output
  --colocate               (Single file) Write analysis next to source as markdown
  --no-colocate            (Project mode) Do not write colocated files; print summary only
  --no-colocate-enhanced   Use standard Mermaid in colocated docs (default: enhanced)
  --colocate-suffix <s>    Suffix for colocated files (default: "effect-analysis")
                           Result: foo/bar.ts -> foo/bar.effect-analysis.md
  -q, --quiet              Minimal output (no per-file lines)
  --no-color               Disable colored output
  -w, --watch              Watch mode: re-analyze on file change
  -m, --migration          Run migration assistant (report try/catch, Promise.*, etc.)
  --coverage-audit         Run coverage audit on a directory (discovered/analyzed/failed, %%)
  --show-suspicious-zeros  With --coverage-audit: list files that import Effect but have 0 programs
  --show-top-unknown       With --coverage-audit: list top files by unknown node rate (default: on)
  --no-show-top-unknown    Disable top-unknown output (e.g. for minimal CI output)
  --show-top-unknown-reasons  With --coverage-audit: list top unknown node reasons (default: on)
  --no-show-top-unknown-reasons  Disable top-unknown-reasons output
  --show-by-folder         With --coverage-audit: show ok/zero/fail counts by top-level folder
  --per-file-timing        With --coverage-audit: include per-file durationMs in audit (optional timing)
  --min-meaningful-nodes <n>  Filter analyzed programs with fewer than n non-unknown nodes (public-output mode)
  --exclude-from-suspicious-zero <pattern>  With --coverage-audit: exclude paths matching pattern from suspicious zeros (repeatable)
  --known-effect-internals-root <path>      With --coverage-audit: treat local imports under path as Effect (improve.md §1)
  --json-summary           With --coverage-audit: print only audit JSON to stdout (CI mode)
  --quality                Add heuristic diagram readability estimate and top offenders report
  --quality-eslint <path>  Ingest existing ESLint JSON for optional quality hints
  --style-guide            Apply summary-style rendering heuristics (default: on for --format mermaid-paths)
  --no-style-guide         Disable style-guide (e.g. for plain mermaid-paths output)
  --service-map            Build deduplicated service map (default: on)
  --no-service-map         Disable service map
  --cache                  Use cache for watch (future: persist IR)
  -h, --help               Show this help message

Examples:
  npx effect-analyzer                    # Analyze current directory; write colocated .md (gold tier)
  effect-analyze                           # Same
  effect-analyze ./src                     # Analyze ./src (directory -> project mode)
  effect-analyze ./program.ts              # Single file; auto-selected diagrams to stdout
  effect-analyze ./packages --coverage-audit -o coverage-baseline.json
  effect-analyze ./src --quality
  effect-analyze ./src --quality --quality-eslint ./.cache/eslint.json
  effect-analyze ./program.ts --format mermaid-paths --style-guide
  effect-analyze ./program.ts --format json --output result.json
  effect-analyze ./program.ts --colocate   # Single file + write foo.effect-analysis.md
  effect-analyze ./src --format api-docs   # Extract HttpApi structure, emit API docs markdown
  effect-analyze ./src --format openapi-paths -o paths.json  # Emit OpenAPI paths JSON
  effect-analyze ./src/api.ts --format openapi-runtime --export TodoApi -o openapi.json  # Runtime OpenApi.fromApi
` + '\n');
};

const loadQualityHintsByFile = (
  options: CLIOptions,
  style: ReturnType<typeof createStyle>,
): Effect.Effect<Map<string, DiagramQualityHintInput>> =>
  Effect.gen(function* () {
    if (!options.quality || !options.qualityEslint) {
      return new Map<string, DiagramQualityHintInput>();
    }
    const eslintPath = resolve(options.qualityEslint);
    const hints = yield* Effect.tryPromise(() =>
      loadDiagramQualityHintsFromEslintJson(eslintPath),
    ).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Console.error(
            style.yellow(
              `Warning: could not load --quality-eslint file (${String(error)}). Continuing without ESLint hints.`,
            ),
          );
          return new Map<string, DiagramQualityHintInput>();
        }),
      ),
    );
    return hints;
  });

const buildProgramQualities = (
  irs: readonly StaticEffectIR[],
  hintsByFile: ReadonlyMap<string, DiagramQualityHintInput>,
  styleGuide: boolean,
): Map<string, DiagramQuality> => {
  const out = new Map<string, DiagramQuality>();
  for (const ir of irs) {
    const hints = hintsByFile.get(resolve(ir.metadata.filePath));
    const quality = computeProgramDiagramQuality(ir, {
      styleGuideSummary: styleGuide,
      hints,
    });
    out.set(ir.root.id, quality);
  }
  return out;
};

/** Diff mode: compare two versions of Effect programs and render the diff. */
const runDiffMode = (
  options: CLIOptions,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const sources = options.diffSources;

    if (sources.length === 0) {
      yield* Console.error('--diff requires at least one source argument');
      return;
    }

    const resolveSource = (arg: ReturnType<typeof parseSourceArg>): Effect.Effect<readonly import('./types').StaticEffectIR[], unknown> => {
      if (arg.kind === 'git-ref' && arg.ref && arg.filePath) {
        const { ref, filePath: fp } = arg;
        return Effect.gen(function* () {
          const src = yield* Effect.try(() => resolveGitSource(ref, fp));
          return yield* analyzeEffectSource(src, fp);
        });
      }
      if (arg.kind === 'github-pr' && arg.prUrl) {
        const { prUrl } = arg;
        return Effect.gen(function* () {
          yield* Console.error('GitHub PR diff requires two resolved refs. Use: --diff <base-ref>:<path> <head-ref>:<path>');
          yield* Console.error(`To resolve PR refs: gh pr view "${prUrl}" --json baseRefName,headRefName`);
          return [] as readonly import('./types').StaticEffectIR[];
        });
      }
      if (!arg.filePath) {
        return Effect.gen(function* () {
          yield* Console.error(`Cannot resolve source: ${JSON.stringify(arg)}`);
          return [] as readonly import('./types').StaticEffectIR[];
        });
      }
      return analyzeEffectFile(arg.filePath);
    };

    let beforeIRs: readonly import('./types').StaticEffectIR[];
    let afterIRs: readonly import('./types').StaticEffectIR[];

    // Check for GitHub PR URL — resolve both sides automatically
    const firstSource = sources[0];
    if (!firstSource) {
      yield* Console.error('No sources specified for diff');
      return;
    }
    const firstParsed = parseSourceArg(firstSource);
    if (firstParsed.kind === 'github-pr' && firstParsed.prUrl) {
      const prUrl = firstParsed.prUrl;
      const prInfo = yield* Effect.try(() => resolveGitHubPR(prUrl));
      // For PR diffs, we need a specific file path
      if (sources.length < 2) {
        yield* Console.error('GitHub PR diff requires a file path: --diff <pr-url> <file-path>');
        return;
      }
      const filePath = sources[1] ?? '';
      const baseSrc = yield* Effect.try(() => resolveGitSource(prInfo.baseRef, filePath));
      const headSrc = yield* Effect.try(() => resolveGitSource(prInfo.headRef, filePath));
      beforeIRs = yield* analyzeEffectSource(baseSrc, filePath);
      afterIRs = yield* analyzeEffectSource(headSrc, filePath);
    } else if (sources.length === 1) {
      // Single source: compare HEAD vs working copy
      const filePath = firstSource;
      const headSrc = yield* Effect.try(() => resolveGitSource('HEAD', filePath));
      beforeIRs = yield* analyzeEffectSource(headSrc, filePath);
      afterIRs = yield* analyzeEffectFile(filePath);
    } else {
      beforeIRs = yield* resolveSource(parseSourceArg(firstSource));
      afterIRs = yield* resolveSource(parseSourceArg(sources[1] ?? ''));
    }

    // Match programs by name and diff each pair
    const sections: string[] = [];
    const matchedBeforeNames = new Set<string>();

    for (const afterIR of afterIRs) {
      const beforeIR = beforeIRs.find(b => b.root.programName === afterIR.root.programName);

      if (beforeIR) {
        matchedBeforeNames.add(beforeIR.root.programName);
        const diff = diffPrograms(beforeIR, afterIR, {
          regressionMode: options.regression,
        });

        if (options.format === 'json') {
          sections.push(renderDiffJSON(diff, { pretty: options.pretty }));
        } else if (options.format === 'mermaid' || options.format === 'mermaid-enhanced') {
          sections.push(`%% diff: ${afterIR.root.programName}\n${renderDiffMermaid(afterIR, diff, { direction: options.direction })}`);
        } else {
          sections.push(renderDiffMarkdown(diff));
        }
      } else {
        // Program only in after — wholly added
        const addedSteps = afterIR.root.children.map(c => {
          const callee = c.type === 'effect' ? (c as { callee?: string }).callee : c.displayName ?? c.name ?? c.type;
          return callee ?? c.type;
        });
        if (options.format === 'json') {
          sections.push(JSON.stringify({ added: afterIR.root.programName, steps: addedSteps }));
        } else {
          sections.push(`## Added program: \`${afterIR.root.programName}\`\n\nSteps: ${addedSteps.map(s => `\`${s}\``).join(', ')}`);
        }
      }
    }

    // Programs only in before — wholly removed
    for (const beforeIR of beforeIRs) {
      if (!matchedBeforeNames.has(beforeIR.root.programName)) {
        const removedSteps = beforeIR.root.children.map(c => {
          const callee = c.type === 'effect' ? (c as { callee?: string }).callee : c.displayName ?? c.name ?? c.type;
          return callee ?? c.type;
        });
        if (options.format === 'json') {
          sections.push(JSON.stringify({ removed: beforeIR.root.programName, steps: removedSteps }));
        } else {
          const warning = options.regression ? '⚠️ ' : '';
          sections.push(`## ${warning}Removed program: \`${beforeIR.root.programName}\`\n\nSteps: ${removedSteps.map(s => `\`${s}\``).join(', ')}`);
        }
      }
    }

    // Use \n\n for Mermaid (splitDiagrams in MermaidDiagram.tsx handles multi-diagram),
    // --- for markdown (valid markdown HR), JSON array for json
    const isMermaid = options.format === 'mermaid' || options.format === 'mermaid-enhanced';
    const separator = options.format === 'json' ? ',\n' : isMermaid ? '\n\n' : '\n\n---\n\n';
    const output = options.format === 'json'
      ? `[${sections.join(separator)}]`
      : sections.join(separator);
    if (options.output) {
      const outputPath = options.output;
      yield* Effect.tryPromise(() => fs.writeFile(outputPath, output, 'utf-8'));
      yield* Console.log(`Diff output written to ${outputPath}`);
    } else {
      yield* Console.log(output);
    }
  });

const runAnalysis = (
  resolvedPath: string,
  options: CLIOptions,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const style = createStyle(options.color && process.stdout.isTTY);
    const countMeaningfulNodes = (nodes: readonly StaticFlowNode[]): number => {
      let count = 0;
      const walk = (list: readonly StaticFlowNode[]) => {
        for (const node of list) {
          if (node.type !== 'unknown') count++;
          const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
          if (children.length > 0) walk(children);
        }
      };
      walk(nodes);
      return count;
    };

    const analyzerOptions =
      options.tsconfig !== undefined
        ? { tsConfigPath: options.tsconfig }
        : undefined;

    let irs: readonly import('./types').StaticEffectIR[];
    const useCache = options.cache && !resolvedPath.includes('*');
    if (useCache) {
      const content = yield* Effect.tryPromise(() =>
        fs.readFile(resolvedPath, 'utf-8'),
      ).pipe(
        Effect.catchAll(() => Effect.succeed(null as string | null)),
      );
      if (content !== null) {
        const cached = yield* Effect.tryPromise(() =>
          getCached(resolvedPath, content),
        ).pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (cached !== null && cached.length > 0) {
          irs = cached;
          yield* Console.log(`(cache hit) Found ${String(irs.length)} program(s)`);
        } else {
          irs = yield* analyze(resolvedPath, analyzerOptions)
            .all()
            .pipe(Effect.tapError((e) => Console.error(`Error: ${e.message}`)));
          yield* Effect.tryPromise(() =>
            setCached(resolvedPath, content, irs),
          ).pipe(Effect.ignore);
          yield* Console.log(`Found ${String(irs.length)} program(s)`);
        }
      } else {
        irs = yield* analyze(resolvedPath, analyzerOptions)
          .all()
          .pipe(Effect.tapError((e) => Console.error(`Error: ${e.message}`)));
        yield* Console.log(`Found ${String(irs.length)} program(s)`);
      }
    } else {
      irs = yield* analyze(resolvedPath, analyzerOptions)
        .all()
        .pipe(Effect.tapError((error) => Console.error(`Error: ${error.message}`)));
      yield* Console.log(`Found ${String(irs.length)} program(s)`);
    }

    const minN = options.minMeaningfulNodes;
    let filteredIrs: readonly import('./types').StaticEffectIR[] =
      minN !== undefined ? irs.filter((ir) => countMeaningfulNodes(ir.root.children) >= minN) : irs;
    if (minN !== undefined && filteredIrs.length !== irs.length) {
      yield* Console.log(
        `Filtered ${String(irs.length - filteredIrs.length)} low-signal program(s) with --min-meaningful-nodes=${String(minN)}`,
      );
    }

    // Filter trivial programs by default (class definitions, schema declarations, single-expression direct programs)
    if (!options.includeTrivial) {
      const beforeCount = filteredIrs.length;
      filteredIrs = filteredIrs.filter((ir) => {
        const { source, children } = ir.root;
        // Skip class-sourced programs (TaggedError, Schema class, Service tag)
        if (source === 'class' || source === 'classProperty' || source === 'classMethod') return false;
        // Skip single direct-expression programs with Schema/Data callees
        if (source === 'direct' && children.length === 1 && children[0]?.type === 'effect') {
          const callee = (children[0] as { callee?: string }).callee ?? '';
          if (callee.startsWith('Schema.') || callee.startsWith('Data.') || callee === 'Service') return false;
        }
        // Skip direct programs that are just thin wrappers (single expression, no generator)
        if (source === 'direct' && children.length <= 1) return false;
        return true;
      });
      const removed = beforeCount - filteredIrs.length;
      if (removed > 0 && !options.quiet) {
        yield* Console.log(`Filtered ${String(removed)} trivial program(s) (use --include-trivial to see all)`);
      }
    }

    const qualityHintsByFile = yield* loadQualityHintsByFile(options, style);
    const programQualities = options.quality
      ? buildProgramQualities(filteredIrs, qualityHintsByFile, options.styleGuide)
      : new Map<string, DiagramQuality>();

    if (options.colocate) {
      const outputFile = yield* writeColocatedOutputForFile(
        resolvedPath,
        filteredIrs,
        options.colocateSuffix,
        options.direction,
        options.colocateEnhanced,
        options.quality ? programQualities : undefined,
        options.styleGuide,
      );
      yield* Console.log(`Written: ${outputFile}`);
      return;
    }

    let output = '';

    // Auto-format renderer dispatch map
    const autoRenderers: Record<string, (ir: StaticEffectIR) => string> = {
      'mermaid': (ir) => renderStaticMermaid(ir, { direction: options.direction }),
      'mermaid-railway': (ir) => renderRailwayMermaid(ir, { direction: options.direction === 'TB' ? 'LR' : options.direction }),
      'mermaid-services': (ir) => renderServicesMermaid(ir, { direction: options.direction === 'TB' ? 'LR' : options.direction }),
      'mermaid-errors': (ir) => renderErrorsMermaid(ir, { direction: options.direction === 'TB' ? 'LR' : options.direction }),
      'mermaid-decisions': (ir) => renderDecisionsMermaid(ir, { direction: options.direction }),
      'mermaid-causes': (ir) => renderCausesMermaid(ir, { direction: options.direction }),
      'mermaid-concurrency': (ir) => renderConcurrencyMermaid(ir, { direction: options.direction }),
      'mermaid-timeline': (ir) => renderTimelineMermaid(ir),
      'mermaid-layers': (ir) => renderLayersMermaid(ir, { direction: options.direction }),
      'mermaid-retry': (ir) => renderRetryMermaid(ir, { direction: options.direction === 'TB' ? 'LR' : options.direction }),
      'mermaid-testability': (ir) => renderTestabilityMermaid(ir, { direction: options.direction === 'TB' ? 'LR' : options.direction }),
      'mermaid-dataflow': (ir) => renderDataflowMermaid(ir, { direction: options.direction === 'TB' ? 'LR' : options.direction }),
    };

    switch (options.format) {
      case 'auto': {
        const diagrams: string[] = [];
        const seenContent = new Set<string>();
        for (const ir of filteredIrs) {
          const formats = selectFormats(ir);
          for (const fmt of formats) {
            const renderer = autoRenderers[fmt];
            if (renderer) {
              const rendered = renderer(ir);
              // Skip empty/trivial diagrams
              if (rendered.includes('((No steps))') || rendered.includes('((No errors))') || rendered.includes('((No ')) continue;
              // Skip duplicate content
              if (seenContent.has(rendered)) continue;
              seenContent.add(rendered);
              const programLabel = filteredIrs.length > 1 ? ` [${ir.root.programName}]` : '';
              diagrams.push(`%% ${fmt}${programLabel}\n${rendered}`);
            }
          }
        }
        output = diagrams.join('\n\n');
        break;
      }
      case 'json': {
        if (!options.quality) {
          const firstIR = filteredIrs[0];
          if (filteredIrs.length === 1 && firstIR) {
            output = yield* renderJSON(firstIR, {
              pretty: options.pretty,
              includeMetadata: options.includeMetadata,
            });
          } else {
            output = yield* renderMultipleJSON(filteredIrs, {
              pretty: options.pretty,
              includeMetadata: options.includeMetadata,
            });
          }
        } else {
          const payload = filteredIrs.map((ir) => {
            const base = options.includeMetadata
              ? {
                  root: ir.root,
                  metadata: ir.metadata,
                  references:
                    ir.references instanceof Map
                      ? (Object.fromEntries(ir.references) as Record<string, import('./types').StaticEffectIR>)
                      : ir.references,
                }
              : { root: ir.root };
            const diagramQuality: DiagramQuality | undefined = programQualities.get(ir.root.id);
            return {
              ...base,
              diagramQuality,
            };
          });
          output = JSON.stringify(
            payload.length === 1 ? payload[0] : payload,
            null,
            options.pretty ? 2 : undefined,
          );
        }
        break;
      }
      case 'mermaid': {
        const diagrams: string[] = [];
        for (const ir of filteredIrs) {
          const diagram = yield* renderMermaid(ir, { direction: options.direction });
          diagrams.push(diagram);
        }
        output = diagrams.join('\n\n');
        break;
      }
      case 'mermaid-paths': {
        const pathDiagrams: string[] = [];
        for (const ir of filteredIrs) {
          const paths = generatePaths(ir);
          pathDiagrams.push(
            renderPathsMermaid(paths, {
              direction: options.direction,
              styleGuide: options.styleGuide,
            }),
          );
        }
        output = pathDiagrams.join('\n\n');
        break;
      }
      case 'mermaid-enhanced': {
        const enhancedDiagrams: string[] = [];
        for (const ir of filteredIrs) {
          enhancedDiagrams.push(renderEnhancedMermaid(ir, { direction: options.direction }));
        }
        output = enhancedDiagrams.join('\n\n');
        break;
      }
      case 'mermaid-railway': {
        const railwayDir = options.direction === 'TB' ? 'LR' : options.direction;
        const outputs = filteredIrs.map(ir => renderRailwayMermaid(ir, { direction: railwayDir }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-services': {
        const svcDir = options.direction === 'TB' ? 'LR' : options.direction;
        const outputs = filteredIrs.map(ir => renderServicesMermaid(ir, { direction: svcDir }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-errors': {
        const errDir = options.direction === 'TB' ? 'LR' : options.direction;
        const outputs = filteredIrs.map(ir => renderErrorsMermaid(ir, { direction: errDir }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-decisions': {
        const outputs = filteredIrs.map(ir => renderDecisionsMermaid(ir, { direction: options.direction }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-causes': {
        const outputs = filteredIrs.map(ir => renderCausesMermaid(ir, { direction: options.direction }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-concurrency': {
        const outputs = filteredIrs.map(ir => renderConcurrencyMermaid(ir, { direction: options.direction }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-timeline': {
        const outputs = filteredIrs.map(ir => renderTimelineMermaid(ir));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-layers': {
        const outputs = filteredIrs.map(ir => renderLayersMermaid(ir, { direction: options.direction }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-retry': {
        const retryDir = options.direction === 'TB' ? 'LR' : options.direction;
        const outputs = filteredIrs.map(ir => renderRetryMermaid(ir, { direction: retryDir }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-testability': {
        const testDir = options.direction === 'TB' ? 'LR' : options.direction;
        const outputs = filteredIrs.map(ir => renderTestabilityMermaid(ir, { direction: testDir }));
        output = outputs.join('\n\n');
        break;
      }
      case 'mermaid-dataflow': {
        const dfDir = options.direction === 'TB' ? 'LR' : options.direction;
        const outputs = filteredIrs.map(ir => renderDataflowMermaid(ir, { direction: dfDir }));
        output = outputs.join('\n\n');
        break;
      }
      case 'stats': {
        const stats = filteredIrs.map((ir) => ({
          program: ir.root.programName,
          stats: ir.metadata.stats,
          ...(options.quality
            ? { diagramQuality: programQualities.get(ir.root.id) }
            : {}),
        }));
        output = JSON.stringify(stats, null, options.pretty ? 2 : undefined);
        break;
      }
      case 'showcase': {
        const sourceCode = yield* Effect.tryPromise(() =>
          fs.readFile(resolvedPath, 'utf-8'),
        ).pipe(Effect.catchAll(() => Effect.succeed('')));
        const showcaseEntries = generateMultipleShowcase(
          filteredIrs,
          { direction: options.direction },
          sourceCode,
        );
        const showcasePayload = showcaseEntries.length === 1 ? showcaseEntries[0] : showcaseEntries;
        output = JSON.stringify(showcasePayload, null, options.pretty ? 2 : undefined);
        break;
      }
      case 'explain': {
        output = renderMultipleExplanations(filteredIrs);
        break;
      }
      case 'summary': {
        output = renderMultipleSummaries(filteredIrs);
        break;
      }
      case 'matrix': {
        output = renderDependencyMatrix(filteredIrs);
        break;
      }
    }

    const outputPath = options.output;
    if (outputPath) {
      yield* Effect.tryPromise(() => fs.writeFile(outputPath, output, 'utf-8'));
      yield* Console.log(`Output written to ${outputPath}`);
    } else {
      yield* Console.log(output);
    }
  });

/** Format and print coverage audit result; optionally write JSON to output path. */
const runCoverageAuditCli = (
  resolvedPath: string,
  options: CLIOptions,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const audit = yield* runCoverageAudit(resolvedPath, {
      tsconfig: options.tsconfig,
      includePerFileTiming: options.perFileTiming,
      excludeFromSuspiciousZeros: options.excludeFromSuspiciousZeros,
      knownEffectInternalsRoot: options.knownEffectInternalsRoot,
    });
    if (options.jsonSummary) {
      yield* Console.log(JSON.stringify({
        ...audit,
        timestamp: new Date().toISOString(),
        dirPath: resolvedPath,
      }, null, options.pretty ? 2 : undefined));
      return;
    }
    yield* Console.log(`Coverage audit for ${resolvedPath}...`);
    const lines: string[] = [
      `Discovered: ${audit.discovered}`,
      `Analyzed:   ${audit.analyzed}`,
      `Zero programs: ${audit.zeroPrograms}`,
      `Suspicious zeros: ${audit.suspiciousZeros.length}`,
      `Failed:     ${audit.failed}`,
      `Coverage:   ${audit.percentage.toFixed(1)}%`,
      `Analyzable coverage: ${audit.analyzableCoverage.toFixed(1)}%`,
      `Unknown node rate: ${(audit.unknownNodeRate * 100).toFixed(2)}%`,
      ...(audit.durationMs !== undefined ? [`Duration:   ${audit.durationMs}ms`] : []),
    ];
    yield* Console.log(lines.join('\n'));
    yield* Console.log(
      `Zero categories: barrel/index=${audit.zeroProgramCategoryCounts.barrel_or_index}, config/build=${audit.zeroProgramCategoryCounts.config_or_build}, test/dtslint=${audit.zeroProgramCategoryCounts.test_or_dtslint}, type-only=${audit.zeroProgramCategoryCounts.type_only}, suspicious=${audit.zeroProgramCategoryCounts.suspicious}, other=${audit.zeroProgramCategoryCounts.other}`,
    );
    if (options.showOkZeroFailByFolder && audit.outcomes.length > 0) {
      const byFolder = new Map<string, { ok: number; zero: number; fail: number }>();
      for (const o of audit.outcomes) {
        const rel = resolvedPath ? o.file.replace(resolvedPath, '').replace(/^[/\\]+/, '') : o.file;
        const topFolder = rel.split(sep)[0] ?? '(root)';
        const cur = byFolder.get(topFolder) ?? { ok: 0, zero: 0, fail: 0 };
        if (o.status === 'ok') cur.ok++;
        else if (o.status === 'zero') cur.zero++;
        else cur.fail++;
        byFolder.set(topFolder, cur);
      }
      yield* Console.log('\nBy top-level folder:');
      for (const [folder, counts] of [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        yield* Console.log(`  ${folder}: ok=${counts.ok} zero=${counts.zero} fail=${counts.fail}`);
      }
    }
    yield* Console.log('(Detection is heuristic; re-exports and some aliases may be under-detected.)');
    if (options.showSuspiciousZeros && audit.suspiciousZeros.length > 0) {
      yield* Console.log('\nSuspicious zeros (Effect import but 0 programs):');
      for (const f of audit.suspiciousZeros) {
        yield* Console.log(`  ${f}`);
      }
    } else if (audit.suspiciousZeros.length > 0) {
      const sample = audit.suspiciousZeros.slice(0, 10);
      yield* Console.log('\nSuspicious zeros (sample):');
      for (const f of sample) {
        yield* Console.log(`  ${f}`);
      }
      if (audit.suspiciousZeros.length > sample.length) {
        yield* Console.log(
          `  ... and ${audit.suspiciousZeros.length - sample.length} more (use --show-suspicious-zeros for full list)`,
        );
      }
    }
    if (options.showTopUnknown && audit.topUnknownFiles && audit.topUnknownFiles.length > 0) {
      yield* Console.log('\nTop files by unknown node rate:');
      for (const f of audit.topUnknownFiles) {
        yield* Console.log(`  ${f}`);
      }
    }
    if (options.showTopUnknownReasons && audit.topUnknownReasons && audit.topUnknownReasons.length > 0) {
      yield* Console.log('\nTop unknown node reasons (by count):');
      for (const { reason, count } of audit.topUnknownReasons) {
        yield* Console.log(`  ${count}\t${reason}`);
      }
    }
    const failedOrZero = audit.outcomes.filter(
      (o) => o.status === 'fail' || o.status === 'zero',
    );
    if (failedOrZero.length > 0) {
      yield* Console.log('\nFailed or zero programs:');
      for (const o of failedOrZero) {
        const reason =
          o.status === 'fail' ? ` error: ${o.error ?? ''}` : ' (0 programs)';
        yield* Console.log(`  ${o.file}${reason}`);
      }
    }
    const jsonPayload = {
      ...audit,
      timestamp: new Date().toISOString(),
      dirPath: resolvedPath,
    };
    const outputPath = options.output;
    if (outputPath) {
      const jsonStr = JSON.stringify(
        jsonPayload,
        null,
        options.pretty ? 2 : undefined,
      );
      yield* Effect.tryPromise(() => fs.writeFile(outputPath, jsonStr, 'utf-8'));
      yield* Console.log(`\nAudit written to ${outputPath}`);
    }
  });

/** Project mode: analyze directory, write colocated .md per file with Effect programs (gold tier). */
const runProjectMode = (
  resolvedPath: string,
  options: CLIOptions,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const useColor = options.color && process.stdout.isTTY;
    const style = createStyle(useColor);

    if (!options.quiet) {
      yield* Console.log(style.bold(`Analyzing ${resolvedPath}...`));
    }

    const projectResult = yield* analyzeProject(resolvedPath, {
      tsconfig: options.tsconfig,
      knownEffectInternalsRoot: options.knownEffectInternalsRoot,
      buildServiceMap: options.serviceMap,
    });

    const byFile = projectResult.byFile;
    const qualityHintsByFile = yield* loadQualityHintsByFile(options, style);
    const fileQualities = options.quality
      ? [...byFile.entries()].map(([filePath, programs]) =>
          computeFileDiagramQuality(filePath, programs, {
            styleGuideSummary: options.styleGuide,
            hints: qualityHintsByFile.get(resolve(filePath)),
          }),
        )
      : [];
    const programQualityByFile = new Map<string, Map<string, DiagramQuality>>();
    if (options.quality) {
      for (const [filePath, programs] of byFile) {
        const fileHint = qualityHintsByFile.get(resolve(filePath));
        const programQualities = buildProgramQualities(
          programs,
          new Map(fileHint ? [[resolve(filePath), fileHint]] : []),
          options.styleGuide,
        );
        programQualityByFile.set(filePath, programQualities);
      }
    }
    const fileCount = byFile.size;
    if (fileCount === 0) {
      yield* Console.log(
        style.yellow('No Effect programs found in discovered TypeScript files.'),
      );
      return;
    }

    const doColocate = !options.noColocate;
    let written = 0;
    if (doColocate) {
      for (const [filePath, programs] of byFile) {
        const outputPath = yield* writeColocatedOutputForFile(
          filePath,
          programs,
          options.colocateSuffix,
          options.direction,
          options.colocateEnhanced,
          programQualityByFile.get(filePath),
          options.styleGuide,
        );
        written++;
        if (!options.quiet) {
          yield* Console.log(
            style.green('  Written: ') + style.cyan(outputPath),
          );
        }
      }
    }

    // Write service artifacts if --service-map is enabled
    if (options.serviceMap && projectResult.serviceMap) {
      const svcMap = projectResult.serviceMap;
      const serviceCount = svcMap.services.size;
      if (serviceCount > 0) {
        if (doColocate) {
          const servicePaths = yield* writeAllServiceArtifacts(svcMap).pipe(
            Effect.catchAll(() => Effect.succeed([] as string[])),
          );
          for (const sp of servicePaths) {
            if (!options.quiet) {
              yield* Console.log(
                style.green('  Service: ') + style.cyan(sp),
              );
            }
          }

          // Write project-level service graph (only when colocating)
          const graphMd = renderServiceGraphMermaid(svcMap, { direction: options.direction });
          const graphPath = join(resolvedPath, 'service-graph.md');
          const graphContent = `# Service Dependency Graph\n\n\`\`\`mermaid\n${graphMd}\n\`\`\`\n`;
          yield* Effect.tryPromise(() => fs.writeFile(graphPath, graphContent, 'utf-8')).pipe(
            Effect.catchAll(() => Effect.succeed(undefined)),
          );
          if (!options.quiet) {
            yield* Console.log(
              style.green('  Service graph: ') + style.cyan(graphPath),
            );
          }
        }

        yield* Console.log(
          style.green(
            `Found ${String(serviceCount)} service(s)${svcMap.unresolvedServices.length > 0 ? `, ${String(svcMap.unresolvedServices.length)} unresolved` : ''}.`,
          ),
        );
      }
    }

    // Write API docs if HttpApi structure found (when colocating)
    if (doColocate) {
      const apiStructures = yield* Effect.tryPromise(() => {
        const project = options.tsconfig
          ? new Project({ tsConfigFilePath: options.tsconfig })
          : new Project({ skipAddingFilesFromTsConfig: true });
        const allStructures: HttpApiStructure[] = [];
        for (const filePath of byFile.keys()) {
          try {
            const sf = project.addSourceFileAtPath(filePath);
            allStructures.push(...extractHttpApiStructure(sf, filePath));
          } catch {
            // skip
          }
        }
        return Promise.resolve(allStructures);
      }).pipe(Effect.catchAll(() => Effect.succeed([] as HttpApiStructure[])));
      if (apiStructures.length > 0) {
        const apiDocsPath = join(resolvedPath, 'api-docs.md');
        const apiDocsContent = renderApiDocsMarkdown(apiStructures);
        yield* Effect.tryPromise(() => fs.writeFile(apiDocsPath, apiDocsContent, 'utf-8')).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
        if (!options.quiet) {
          yield* Console.log(
            style.green('  API docs: ') + style.cyan(apiDocsPath),
          );
        }
      }
    }

    // Format-specific project output
    if (options.format === 'matrix') {
      const matrixOutput = options.serviceMap && projectResult.serviceMap
        ? renderDependencyMatrixFromServiceMap(projectResult.serviceMap)
        : renderDependencyMatrix(projectResult.allPrograms);
      yield* Console.log('\n' + matrixOutput);
    } else if (options.format === 'mermaid-services') {
      const svcDir = options.direction === 'TB' ? 'LR' : options.direction;
      const svcOutput = options.serviceMap && projectResult.serviceMap
        ? renderServicesMermaidFromMap(projectResult.serviceMap, { direction: svcDir })
        : projectResult.allPrograms.map(ir => renderServicesMermaid(ir, { direction: svcDir })).join('\n\n---\n\n');
      yield* Console.log('\n' + svcOutput);
    } else if (options.format === 'explain') {
      yield* Console.log('\n' + renderMultipleExplanations(projectResult.allPrograms));
    } else if (options.format === 'summary') {
      yield* Console.log('\n' + renderMultipleSummaries(projectResult.allPrograms));
    }

    const totalPrograms = projectResult.allPrograms.length;
    const summary = doColocate
      ? style.green(
          `Analyzed ${String(fileCount)} file(s) with Effect programs, wrote ${String(written)} colocated .${options.colocateSuffix}.md file(s) (${String(totalPrograms)} program(s) total).`,
        )
      : style.dim(
          `Analyzed ${String(fileCount)} file(s), ${String(totalPrograms)} program(s). Use without --no-colocate to write .${options.colocateSuffix}.md files.`,
        );
    yield* Console.log(summary);

    if (options.quality && fileQualities.length > 0) {
      const offenders = buildTopOffendersReport(fileQualities, 10);
      const formatMetric = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
      const printBucket = (
        title: string,
        entries: readonly { filePath: string; metricValue: number; tip: string }[],
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Console.log(`\n${style.bold(title)}`);
          for (const entry of entries) {
            yield* Console.log(`  ${entry.filePath}  (${formatMetric(entry.metricValue)})`);
            yield* Console.log(`    ${style.dim(entry.tip)}`);
          }
        });

      yield* printBucket('Top offenders: largest programs', offenders.largestPrograms);
      yield* printBucket('Top offenders: most anonymous nodes', offenders.mostAnonymousNodes);
      yield* printBucket('Top offenders: most unknown nodes', offenders.mostUnknownNodes);
      yield* printBucket('Top offenders: highest log ratio', offenders.highestLogRatio);
    }
  });

/** Run openapi-runtime: spawn runner script to call OpenApi.fromApi on user's HttpApi. */
const runOpenApiRuntime = (
  entrypointPath: string,
  options: CLIOptions,
): Effect.Effect<void, unknown> =>
  Effect.async<undefined, Error>((resume) => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const runnerPath = join(__dirname, '..', 'scripts', 'openapi-runtime-runner.mjs');
    const absEntrypoint = resolve(process.cwd(), entrypointPath);
    const entrypointDir = dirname(absEntrypoint);
    // Walk up to find package root (dir with package.json) for module resolution
    const findPackageRoot = (dir: string): string => {
      let d = dir;
      for (let i = 0; i < 20; i++) {
        if (existsSync(join(d, 'package.json'))) return d;
        const parent = dirname(d);
        if (parent === d) break;
        d = parent;
      }
      return entrypointDir;
    };
    const cwd = findPackageRoot(entrypointDir);
    const runnerArgs = [
      absEntrypoint,
      options.openapiExport ?? 'default',
      ...(options.output ? ['--output', resolve(process.cwd(), options.output)] : []),
    ];
    const child = spawn('npx', ['tsx', runnerPath, ...runnerArgs], {
      stdio: options.output ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      shell: false,
      cwd,
    });
    if (options.output) {
      child.stdout?.on('data', (d) => process.stdout.write(d as Uint8Array));
    }
    child.on('close', (code) => {
      if (code === 0) resume(Effect.succeed(undefined));
      else resume(Effect.fail(new Error(`OpenAPI runtime exited with code ${code}`)));
    });
    child.on('error', (err) => { resume(Effect.fail(err)); });
  });

/** Run api-docs or openapi-paths format (HttpApi extractor, not Effect analyzer). */
const runApiDocsMode = (
  resolvedPath: string,
  options: CLIOptions,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const project = options.tsconfig
      ? new Project({ tsConfigFilePath: options.tsconfig })
      : new Project({ skipAddingFilesFromTsConfig: true });

    let files: string[];
    const stat = yield* Effect.tryPromise(() => fs.stat(resolvedPath)).pipe(
      Effect.option,
    );
    if (Option.isSome(stat) && stat.value.isDirectory()) {
      const exts = ['.ts', '.tsx'];
      const walk = async (dir: string, depth: number): Promise<string[]> => {
        if (depth > 10) return [];
        const result: string[] = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = join(dir, e.name);
          if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') {
            result.push(...(await walk(full, depth + 1)));
          } else if (e.isFile() && exts.includes(extname(e.name))) {
            result.push(full);
          }
        }
        return result;
      };
      files = yield* Effect.tryPromise(() => walk(resolvedPath, 0));
    } else {
      files = [resolvedPath];
    }

    const allStructures: HttpApiStructure[] = [];
    for (const file of files) {
      try {
        const sf = project.addSourceFileAtPath(file);
        const structures = extractHttpApiStructure(sf, file);
        allStructures.push(...structures);
      } catch {
        // skip parse errors
      }
    }

    const output = options.format === 'openapi-paths'
      ? JSON.stringify(renderOpenApiPaths(allStructures), null, options.pretty ? 2 : undefined)
      : renderApiDocsMarkdown(allStructures);

    const outputPath = options.output;
    if (outputPath) {
      yield* Effect.tryPromise(() => fs.writeFile(outputPath, output, 'utf-8'));
      yield* Console.log(`Output written to ${outputPath}`);
    } else {
      yield* Console.log(output);
    }
  });

const runMigration = (resolvedPath: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const s = yield* Effect.tryPromise(() => fs.stat(resolvedPath)).pipe(
      Effect.option,
    );
    const isDir = Option.isSome(s) && s.value.isDirectory();
    if (isDir) {
      const report = yield* Effect.tryPromise(() =>
        findMigrationOpportunitiesInProject(resolvedPath),
      ).pipe(
        Effect.catchAll((e) =>
          Effect.fail(new Error(e instanceof Error ? e.message : String(e))),
        ),
      );
      yield* Effect.sync(() => {
        process.stdout.write(formatMigrationReport(report) + '\n');
      });
    } else {
      const opportunities = yield* Effect.try({
        try: () => findMigrationOpportunities(resolvedPath),
        catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
      });
      yield* Effect.sync(() => {
        process.stdout.write(
          formatMigrationReport({ opportunities, fileCount: 1 }) + '\n',
        );
      });
    }
  }).pipe(
    Effect.catchAll((e) =>
      Effect.sync(() => {
        console.error('Migration failed:', e instanceof Error ? e.message : e);
      }),
    ),
  );

const main = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const { pathArg, options } = parseArgs(args);

  // Diff mode: compare two versions of an Effect program
  // Must run before path resolution since diff sources use ref:path syntax (e.g. HEAD:file.ts)
  if (options.diff) {
    yield* runDiffMode(options);
    return Exit.succeed(undefined);
  }

  const resolvedPath = resolve(pathArg ?? '.');

  const s = yield* Effect.tryPromise(() => fs.stat(resolvedPath)).pipe(
    Effect.option,
  );
  if (Option.isNone(s)) {
    yield* Console.error(`Error: Path not found: ${resolvedPath}`);
    return yield* Effect.fail(Exit.fail('Path not found'));
  }

  const isDir = s.value.isDirectory();

  if (options.coverageAudit) {
    if (!isDir) {
      yield* Console.error('Error: --coverage-audit requires a directory path');
      return yield* Effect.fail(Exit.fail('Coverage audit requires directory'));
    }
    yield* runCoverageAuditCli(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (options.format === 'migration') {
    yield* Console.log(`Migration report for ${resolvedPath}...`);
    yield* runMigration(resolvedPath);
    return Exit.succeed(undefined);
  }

  if (options.format === 'api-docs' || options.format === 'openapi-paths') {
    yield* runApiDocsMode(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (options.format === 'openapi-runtime') {
    if (isDir) {
      yield* Console.error('openapi-runtime requires a file path (entrypoint), not a directory.');
      return Exit.fail(new Error('openapi-runtime needs entrypoint file'));
    }
    yield* runOpenApiRuntime(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (isDir) {
    yield* runProjectMode(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (!options.quiet) {
    yield* Console.log(`Analyzing ${resolvedPath}...`);
  }
  yield* runAnalysis(resolvedPath, options);

  if (options.watch) {
    const watchOpts = { ...options, quiet: true };
    yield* Console.log(`\x1b[2m👁 Watching ${resolvedPath} for changes... (Ctrl+C to stop)\x1b[0m`);
    yield* Effect.sync(() => {
      let debounce: ReturnType<typeof setTimeout> | undefined;
      let runCount = 0;
      const watcher = watch(
        resolvedPath,
        { persistent: true },
        (_eventType, _filename) => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            runCount++;
            // Clear screen for clean live view
            process.stdout.write('\x1Bc');
            const time = new Date().toLocaleTimeString();
            process.stdout.write(`\x1b[2m👁 ${resolvedPath} — ${time} (#${runCount})\x1b[0m\n\n`);
            Effect.runPromise(
              runAnalysis(resolvedPath, watchOpts).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    process.stdout.write(`\n\x1b[2m✓ Updated. Waiting for changes...\x1b[0m\n`);
                  }),
                ),
                Effect.catchAll((e) =>
                  Effect.sync(() => {
                    process.stdout.write(`\n\x1b[31m✗ Error: ${e instanceof Error ? e.message : String(e)}\x1b[0m\n`);
                    process.stdout.write(`\x1b[2mWaiting for changes...\x1b[0m\n`);
                  }),
                ),
              ),
            ).catch(() => undefined);
          }, 300);
        },
      );
      process.on('SIGINT', () => {
        watcher.close();
        process.stdout.write('\n');
        process.exit(0);
      });
    });
    yield* Effect.never;
  }

  return Exit.succeed(undefined);
}).pipe(
  Effect.catchAll((error) =>
    Effect.gen(function* () {
      yield* Console.error(`Fatal error: ${String(error)}`);
      return Exit.fail(error);
    }),
  ),
);

// Run the program
Effect.runPromise(main).then(
  () => {
    process.exit(0);
  },
  (err: unknown) => {
    const message =
      err instanceof Error ? err.message : String(err);
    if (message) {
      console.error(`Error: ${message}`);
    }
    process.exit(1);
  },
);
