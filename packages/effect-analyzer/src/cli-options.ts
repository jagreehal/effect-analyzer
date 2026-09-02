/**
 * Command-line options and the argument parser.
 *
 * Pure: it turns `process.argv` into a `CLIOptions` and nothing else. Keeping it
 * out of `cli.ts` means the flag surface can grow without the file that runs
 * the analyses growing with it.
 */

import { parseTsgoProjectArgument } from './tsgo-diagnostics';
import { printHelp } from './cli-help';
import type { CouplingIssueType, CouplingPriorityMap } from './agent-report';
import type { FailOnSeverity } from './lint-session';

export type MermaidDirection = 'TB' | 'LR' | 'BT' | 'RL';
export type TestRunner = 'vitest' | 'jest' | 'mocha';

export interface CLIOptions {
  readonly format: 'auto' | 'json' | 'mermaid' | 'mermaid-paths' | 'mermaid-enhanced' | 'mermaid-railway' | 'mermaid-services' | 'mermaid-errors' | 'mermaid-decisions' | 'mermaid-causes' | 'mermaid-concurrency' | 'mermaid-timeline' | 'mermaid-layers' | 'mermaid-retry' | 'mermaid-testability' | 'mermaid-dataflow' | 'mermaid-statechart' | 'svg-statechart' | 'statechart-html' | 'xstate-config' | 'statechart-coverage' | 'stats' | 'migration' | 'showcase' | 'explain' | 'summary' | 'matrix' | 'architecture' | 'api-docs' | 'openapi-paths' | 'openapi-runtime' | 'json-schema';
  readonly openapiExport: string | undefined;
  readonly output: string | undefined;
  readonly pretty: boolean;
  readonly includeMetadata: boolean;
  readonly direction: MermaidDirection;
  readonly detail: 'compact' | 'standard' | 'verbose' | undefined;
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
  readonly minCoverage: number | undefined;
  readonly coverageJson: boolean;
  readonly open: boolean;
  readonly excludeFromSuspiciousZeros: string[];
  readonly knownEffectInternalsRoot: string | undefined;
  readonly maxAuditFailedFiles: number | undefined;
  readonly maxAuditSuspiciousZeros: number | undefined;
  readonly minAuditEffectAdoption: number | undefined;
  readonly minAuditSourceResolution: number | undefined;
  readonly quiet: boolean;
  readonly color: boolean;
  readonly quality: boolean;
  readonly assertDiagramFidelity: boolean;
  readonly qualityEslint: string | undefined;
  readonly styleGuide: boolean;
  readonly serviceMap: boolean;
  readonly diff: boolean;
  readonly diffSources: readonly string[];
  readonly regression: boolean;
  readonly includeTrivial: boolean;
  readonly test: boolean;
  readonly testRunner: TestRunner;
  readonly testOverwrite: boolean;
  readonly entryPoints: boolean;
  readonly configLeaks: boolean;
  readonly cliCommands: boolean;
  readonly listRules: boolean;
  readonly indexRules: boolean;
  readonly searchRules: string | undefined;
  readonly explainRule: string | undefined;
  readonly profile: 'strict' | 'ci' | 'migration' | 'docs' | undefined;
  readonly exportSession: string | undefined;
  readonly importSession: string | undefined;
  readonly maxFiles: number | undefined;
  readonly cursor: number;
  readonly lintSource: boolean;
  readonly tsgoProject: string | undefined;
  readonly sarif: boolean;
  readonly baseline: string | undefined;
  readonly failOnNew: boolean;
  readonly requireSuppressionReason: boolean;
  readonly failOnStaleSuppressions: boolean;
  readonly failOn: FailOnSeverity | undefined;
  readonly serviceCycles: boolean;
  readonly bundleOutput: string | undefined;
  readonly scorecard: boolean;
  readonly agentReport: boolean;
  readonly errorChannel: boolean;
  readonly serviceHealth: boolean;
  readonly performance: boolean;
  readonly improve: boolean;
  readonly improveDryRun: boolean;
  readonly improveMaxFixes: number | undefined;
  readonly improveRules: string[] | undefined;
  readonly improveExcludeRules: string[] | undefined;
  readonly improveMinPriority: 'P0' | 'P1' | 'P2' | 'P3' | undefined;
  readonly coupling: boolean;
  readonly couplingTransitive: boolean;
  readonly couplingPriority: CouplingPriorityMap | undefined;
}

const VALID_COUPLING_TYPES: ReadonlySet<CouplingIssueType> = new Set([
  'critical-fanin',
  'high-fanin',
  'high-fanout',
  'accidental-hub',
  'hub-without-annotation',
]);
const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3'] as const);

function parseCouplingPriority(raw: string): CouplingPriorityMap | null {
  const map: Record<string, 'P0' | 'P1' | 'P2' | 'P3'> = {};
  for (const pair of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq < 0) return null;
    const key = pair.slice(0, eq).trim() as CouplingIssueType;
    const val = pair.slice(eq + 1).trim() as 'P0' | 'P1' | 'P2' | 'P3';
    if (!VALID_COUPLING_TYPES.has(key)) return null;
    if (!VALID_PRIORITIES.has(val)) return null;
    map[key] = val;
  }
  return Object.keys(map).length > 0 ? (map) : null;
}

/** Spelled out for the error messages; the parser still matches on literals. */
const DIRECTION_VALUES = ['TB', 'LR', 'BT', 'RL'] as const;
const DETAIL_VALUES = ['compact', 'standard', 'verbose'] as const;
const PROFILE_VALUES = ['strict', 'ci', 'migration', 'docs'] as const;
const TEST_RUNNER_VALUES = ['vitest', 'jest', 'mocha'] as const;

export function parseArgs(args: readonly string[]): {
  pathArg: string | undefined;
  options: CLIOptions;
  errors: readonly string[];
} {
  // Records the typo and leaves the option at its default, so the caller can
  // refuse to run instead of analyzing with something the user did not ask for.
  // Omit `accepted` when the list is too long to print (`--format` has 32).
  const errors: string[] = [];
  const rejectValue = (
    flag: string,
    value: string | undefined,
    accepted?: readonly string[],
  ): void => {
    const hint = accepted
      ? `Accepted: ${accepted.join(', ')}.`
      : 'See --help for accepted values.';
    errors.push(
      value === undefined
        ? `Missing value for ${flag}. ${hint}`
        : `Unknown value for ${flag}: ${value}. ${hint}`,
    );
  };

  let pathArg: string | undefined;
  let format: CLIOptions['format'] = 'auto';
  let output: string | undefined;
  let pretty = true;
  let includeMetadata = true;
  let direction: MermaidDirection = 'TB';
  let detail: CLIOptions['detail'] = undefined;
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
  let minCoverage: number | undefined;
  let coverageJson = false;
  let open = false;
  const excludeFromSuspiciousZeros: string[] = [];
  let knownEffectInternalsRoot: string | undefined;
  let maxAuditFailedFiles: number | undefined;
  let maxAuditSuspiciousZeros: number | undefined;
  let minAuditEffectAdoption: number | undefined;
  let minAuditSourceResolution: number | undefined;
  let quiet = false;
  let color = true;
  let quality = false;
  let assertDiagramFidelity = false;
  let qualityEslint: string | undefined;
  let styleGuide = false;
  let explicitNoStyleGuide = false;
  let serviceMap = true;
  let openapiExport: string | undefined;
  let diff = false;
  let regression = false;
  let includeTrivial = false;
  let test = false;
  let testRunner: TestRunner = 'vitest';
  let testOverwrite = false;
  let entryPoints = false;
  let configLeaks = false;
  let cliCommands = false;
  let listRules = false;
  let indexRules = false;
  let searchRules: string | undefined;
  let explainRuleCode: string | undefined;
  let profile: CLIOptions['profile'] = undefined;
  let exportSession: string | undefined;
  let importSession: string | undefined;
  let maxFiles: number | undefined;
  let cursor = 0;
  let lintSource = false;
  let tsgoProject: string | undefined;
  let sarif = false;
  let baseline: string | undefined;
  let failOnNew = false;
  let requireSuppressionReason = false;
  let failOnStaleSuppressions = false;
  let failOn: FailOnSeverity | undefined;
  let serviceCycles = false;
  let bundleOutput: string | undefined;
  let scorecard = false;
  let agentReport = false;
  let errorChannel = false;
  let serviceHealth = false;
  let performance = false;
  let coupling = false;
  let couplingTransitive = false;
  let couplingPriority: CouplingPriorityMap | undefined;
  let improve = false;
  let improveDryRun = true;
  let improveMaxFixes: number | undefined;
  const improveRules: string[] = [];
  const improveExcludeRules: string[] = [];
  let improveMinPriority: 'P0' | 'P1' | 'P2' | 'P3' | undefined;
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
        value === 'mermaid-statechart' ||
        value === 'svg-statechart' ||
        value === 'statechart-html' ||
        value === 'xstate-config' ||
        value === 'statechart-coverage' ||
        value === 'stats' ||
        value === 'migration' ||
        value === 'showcase' ||
        value === 'explain' ||
        value === 'summary' ||
        value === 'architecture' ||
        value === 'matrix' ||
        value === 'api-docs' ||
        value === 'openapi-paths' ||
        value === 'json-schema' ||
        value === 'openapi-runtime'
      ) {
        format = value;
      } else {
        rejectValue('--format', value);
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
      } else {
        rejectValue('--direction', value, DIRECTION_VALUES);
      }
    } else if (arg === '--detail') {
      const value = args[++i];
      if (value === 'compact' || value === 'standard' || value === 'verbose') {
        detail = value;
      } else {
        rejectValue('--detail', value, DETAIL_VALUES);
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
      const parsed = Number.parseInt(args[++i] ?? '', 10);
      if (Number.isFinite(parsed) && parsed >= 0) minMeaningfulNodes = parsed;
    } else if (arg === '--min-coverage') {
      const parsed = Number.parseFloat(args[++i] ?? '');
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) minCoverage = parsed;
    } else if (arg === '--coverage-json') {
      coverageJson = true;
    } else if (arg === '--open') {
      open = true;
    } else if (arg === '--exclude-from-suspicious-zero') {
      const value = args[++i];
      if (value !== undefined) excludeFromSuspiciousZeros.push(value);
    } else if (arg === '--known-effect-internals-root') {
      knownEffectInternalsRoot = args[++i];
    } else if (arg === '--max-audit-failed-files') {
      const parsed = Number.parseInt(args[++i] ?? '', 10);
      if (Number.isFinite(parsed) && parsed >= 0) maxAuditFailedFiles = parsed;
    } else if (arg === '--max-audit-suspicious-zeros') {
      const parsed = Number.parseInt(args[++i] ?? '', 10);
      if (Number.isFinite(parsed) && parsed >= 0) maxAuditSuspiciousZeros = parsed;
    } else if (arg === '--min-audit-effect-adoption') {
      const parsed = Number.parseFloat(args[++i] ?? '');
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
        minAuditEffectAdoption = parsed / 100;
      }
    } else if (arg === '--min-audit-source-resolution') {
      const parsed = Number.parseFloat(args[++i] ?? '');
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
        minAuditSourceResolution = parsed / 100;
      }
    } else if (arg === '--json-summary') {
      jsonSummary = true;
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else if (arg === '--no-color') {
      color = false;
    } else if (arg === '--quality') {
      quality = true;
    } else if (arg === '--assert-diagram-fidelity') {
      assertDiagramFidelity = true;
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
    } else if (arg === '--entry-points') {
      entryPoints = true;
    } else if (arg === '--config-leaks') {
      configLeaks = true;
    } else if (arg === '--cli-commands') {
      cliCommands = true;
    } else if (arg === '--list-rules') {
      listRules = true;
    } else if (arg === '--index-rules') {
      indexRules = true;
    } else if (arg === '--search-rules') {
      searchRules = args[++i];
    } else if (arg.startsWith('--search-rules=')) {
      searchRules = arg.slice('--search-rules='.length);
    } else if (arg === '--explain-rule') {
      explainRuleCode = args[++i];
    } else if (arg.startsWith('--explain-rule=')) {
      explainRuleCode = arg.slice('--explain-rule='.length);
    } else if (arg === '--profile') {
      const value = args[++i];
      if (value === 'strict' || value === 'ci' || value === 'migration' || value === 'docs') {
        profile = value;
      } else {
        rejectValue('--profile', value, PROFILE_VALUES);
      }
    } else if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length);
      if (value === 'strict' || value === 'ci' || value === 'migration' || value === 'docs') {
        profile = value;
      } else {
        rejectValue('--profile', value, PROFILE_VALUES);
      }
    } else if (arg === '--export-session') {
      exportSession = args[++i];
    } else if (arg.startsWith('--export-session=')) {
      exportSession = arg.slice('--export-session='.length);
    } else if (arg === '--import-session') {
      importSession = args[++i];
    } else if (arg.startsWith('--import-session=')) {
      importSession = arg.slice('--import-session='.length);
    } else if (arg === '--max-files') {
      const parsed = Number.parseInt(args[++i] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) maxFiles = parsed;
    } else if (arg.startsWith('--max-files=')) {
      const value = arg.slice('--max-files='.length);
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) maxFiles = parsed;
    } else if (arg === '--cursor') {
      const parsed = Number.parseInt(args[++i] ?? '', 10);
      if (Number.isFinite(parsed) && parsed >= 0) cursor = parsed;
    } else if (arg.startsWith('--cursor=')) {
      const value = arg.slice('--cursor='.length);
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 0) cursor = parsed;
    } else if (arg === '--lint-source') {
      lintSource = true;
    } else if (arg === '--tsgo') {
      const parsed = parseTsgoProjectArgument(args, i, pathArg !== undefined);
      tsgoProject = parsed.project;
      i += parsed.consumed;
    } else if (arg.startsWith('--tsgo=')) {
      tsgoProject = arg.slice('--tsgo='.length);
    } else if (arg === '--sarif') {
      sarif = true;
    } else if (arg === '--baseline') {
      baseline = args[++i];
    } else if (arg.startsWith('--baseline=')) {
      baseline = arg.slice('--baseline='.length);
    } else if (arg === '--fail-on-new') {
      failOnNew = true;
    } else if (arg === '--require-suppression-reason') {
      requireSuppressionReason = true;
    } else if (arg === '--fail-on-stale-suppressions') {
      failOnStaleSuppressions = true;
    } else if (arg === '--fail-on' || arg.startsWith('--fail-on=')) {
      const value = arg === '--fail-on' ? args[++i] : arg.slice('--fail-on='.length);
      if (value === 'error' || value === 'warning' || value === 'info') {
        failOn = value;
      } else {
        rejectValue('--fail-on', value);
      }
    } else if (arg === '--service-cycles') {
      serviceCycles = true;
    } else if (arg === '--bundle-output') {
      bundleOutput = args[++i];
    } else if (arg.startsWith('--bundle-output=')) {
      bundleOutput = arg.slice('--bundle-output='.length);
    } else if (arg === '--scorecard') {
      scorecard = true;
    } else if (arg === '--agent-report') {
      agentReport = true;
    } else if (arg === '--error-channel') {
      errorChannel = true;
    } else if (arg === '--service-health') {
      serviceHealth = true;
    } else if (arg === '--performance') {
      performance = true;
    } else if (arg === '--coupling') {
      coupling = true;
    } else if (arg === '--coupling-transitive') {
      couplingTransitive = true;
    } else if (arg === '--coupling-priority' || arg.startsWith('--coupling-priority=')) {
      const raw = arg === '--coupling-priority' ? args[++i] : arg.slice('--coupling-priority='.length);
      if (!raw) {
        console.error('--coupling-priority requires a value, e.g. "critical-fanin=P0,high-fanin=P1"');
        process.exit(2);
      }
      const parsed = parseCouplingPriority(raw);
      if (!parsed) {
        console.error(`--coupling-priority: invalid value "${raw}". Expected pairs like "critical-fanin=P0,high-fanin=P1". Valid types: critical-fanin, high-fanin, high-fanout, accidental-hub, hub-without-annotation. Valid priorities: P0, P1, P2, P3.`);
        process.exit(2);
      }
      couplingPriority = parsed;
    } else if (arg === '--improve') {
      improve = true;
      improveDryRun = false;
    } else if (arg === '--improve-dry-run') {
      improveDryRun = true;
      improve = true;
    } else if (arg === '--improve-max-fixes') {
      const parsed = Number.parseInt(args[++i] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) improveMaxFixes = parsed;
    } else if (arg === '--improve-rule') {
      const value = args[++i];
      if (value) improveRules.push(value);
    } else if (arg === '--improve-exclude-rule') {
      const value = args[++i];
      if (value) improveExcludeRules.push(value);
    } else if (arg === '--improve-min-priority') {
      const value = args[++i];
      if (value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3') {
        improveMinPriority = value;
      } else {
        rejectValue('--improve-min-priority', value, [...VALID_PRIORITIES]);
      }
    } else if (arg === '--test') {
      test = true;
    } else if (arg === '--no-test') {
      test = false;
    } else if (arg === '--test-overwrite') {
      testOverwrite = true;
    } else if (arg === '--test-runner') {
      const value = args[++i];
      if (value === 'vitest' || value === 'jest' || value === 'mocha') {
        testRunner = value;
      } else {
        // Was `process.stderr.write` + `process.exit(1)` from inside the
        // parser, which made this branch untestable and killed the process
        // before the caller could decide anything.
        rejectValue('--test-runner', value, TEST_RUNNER_VALUES);
      }
    } else if (arg.startsWith('--test-runner=')) {
      const value = arg.slice('--test-runner='.length).trim();
      if (value === 'vitest' || value === 'jest' || value === 'mocha') {
        testRunner = value;
      } else {
        rejectValue('--test-runner', value, TEST_RUNNER_VALUES);
      }
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
  if (coverageAudit && !quiet) {
    if (!explicitNoShowTopUnknown) showTopUnknown = true;
    if (!explicitNoShowTopUnknownReasons) showTopUnknownReasons = true;
  }

  const options: CLIOptions = {
    format,
    output,
    pretty,
    includeMetadata,
    direction,
    detail,
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
    minCoverage,
    coverageJson,
    open,
    excludeFromSuspiciousZeros,
    knownEffectInternalsRoot,
    maxAuditFailedFiles,
    maxAuditSuspiciousZeros,
    minAuditEffectAdoption,
    minAuditSourceResolution,
    quiet,
    color,
    quality,
    assertDiagramFidelity,
    qualityEslint,
    styleGuide,
    serviceMap,
    openapiExport,
    diff,
    diffSources,
    regression,
    includeTrivial,
    test,
    testRunner,
    testOverwrite,
    entryPoints,
    configLeaks,
    cliCommands,
    listRules,
    indexRules,
    searchRules,
    explainRule: explainRuleCode,
    profile,
    exportSession,
    importSession,
    maxFiles,
    cursor,
    lintSource,
    tsgoProject,
    sarif,
    baseline,
    failOnNew,
    requireSuppressionReason,
    failOnStaleSuppressions,
    failOn,
    serviceCycles,
    bundleOutput,
    scorecard,
    agentReport,
    errorChannel,
    serviceHealth,
    performance,
    coupling,
    couplingTransitive,
    couplingPriority,
    improve,
    improveDryRun,
    improveMaxFixes,
    improveRules: improveRules.length > 0 ? improveRules : undefined,
    improveExcludeRules: improveExcludeRules.length > 0 ? improveExcludeRules : undefined,
    improveMinPriority,
  };
  return { pathArg, options, errors };
}
