/**
 * `effect-analyze diagnostics` — `effect-tsgo diagnostics` plus the analyzer's
 * own rules.
 *
 * The design rule here is that we do not reimplement anything `@effect/tsgo`
 * already does. Its argv is forwarded untouched, so it validates its own flags,
 * applies its own severity semantics and picks its own exit code; its stdout is
 * passed through byte for byte, so its formatting and its diagnostic ordering
 * are its own. We strip only our two additions (`--no-analyzer`, `--fail-on`)
 * and, when we have findings to contribute, splice them into the stream it
 * produced. A run with nothing to add *is* the upstream run.
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lintSourceCode } from './source-linter';
import {
  readTsgoProjectFiles,
  resolveTsgoBin,
  spawnTsgoDiagnostics,
  TsgoDiagnosticsError,
} from './tsgo-diagnostics';

/**
 * `@effect/tsgo` subcommands we forward verbatim.
 *
 * These configure the toolchain rather than report on it — an interactive rule
 * picker, the binary patcher — so there is nothing for us to add and every
 * reason not to reimplement a surface that moves on `@effect/tsgo`'s release
 * cadence. Forwarding keeps one command for users and no drift for us.
 */
export const PROXIED_TSGO_COMMANDS = [
  'setup',
  'config',
  'patch',
  'unpatch',
  'get-exe-path',
] as const;

export type ProxiedTsgoCommand = (typeof PROXIED_TSGO_COMMANDS)[number];

export const isProxiedTsgoCommand = (value: string): value is ProxiedTsgoCommand =>
  (PROXIED_TSGO_COMMANDS as readonly string[]).includes(value);

/**
 * Run an `@effect/tsgo` subcommand as-is, inheriting stdio so interactive
 * prompts work, and return its exit code unchanged.
 */
export const proxyTsgoCommand = (command: ProxiedTsgoCommand, args: readonly string[]): number => {
  const bin = resolveTsgoBin();
  if (!bin) {
    throw new TsgoDiagnosticsError(
      'Unable to resolve @effect/tsgo. Reinstall effect-analyzer and its platform dependencies.',
    );
  }
  const result = spawnSync(process.execPath, [bin, command, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

/** Upstream's severity domain. `message` is what we call `info` elsewhere. */
export type TsgoSeverity = 'error' | 'warning' | 'message';

export type DiagnosticsFormat = 'json' | 'pretty' | 'text' | 'github-actions';

/**
 * One diagnostic in `effect-tsgo diagnostics --format json`'s own schema.
 *
 * `source` is the single additive field: `tsgo` for a type-aware Effect
 * language service diagnostic, `analyzer` for one of our AST rules. Analyzer
 * entries carry `code: 0`, outside the 377xxx Effect range, so a consumer that
 * filters on that range keeps seeing exactly what it saw before.
 */
export interface Diagnostic {
  readonly file: string;
  readonly start: number;
  readonly length: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: TsgoSeverity;
  readonly code: number;
  readonly name: string;
  readonly message: string;
  readonly source: 'tsgo' | 'analyzer';
}

/** Code reserved for analyzer rules: never inside the 377xxx Effect range. */
export const ANALYZER_DIAGNOSTIC_CODE = 0;

const SEVERITY_ORDER: Record<TsgoSeverity, number> = { error: 3, warning: 2, message: 1 };

// =============================================================================
// Argument handling
// =============================================================================

export interface DiagnosticsInvocation {
  /** Arguments to forward to `effect-tsgo diagnostics`, untouched. */
  readonly forwarded: readonly string[];
  readonly analyzer: boolean;
  readonly failOn: TsgoSeverity | 'none' | undefined;
  readonly project: string | undefined;
  readonly file: string | undefined;
  readonly format: DiagnosticsFormat;
  readonly severity: string | undefined;
  readonly lspconfig: string | undefined;
  readonly strict: boolean;
  readonly progress: boolean;
  readonly errors: readonly string[];
}

const FORMATS: readonly string[] = ['json', 'pretty', 'text', 'github-actions'];

const VALUE_FLAGS = ['--project', '--file', '--format', '--severity', '--lspconfig'] as const;

/**
 * Split our own flags out of argv, noting what we need for our own work.
 *
 * Everything else is forwarded verbatim, values included: an unknown flag, an
 * unsupported `--format` or an odd `--severity` list is `@effect/tsgo`'s to
 * judge, in its own words and with its own exit code. Reading a value here
 * never means validating it.
 */
export const splitDiagnosticsArgs = (args: readonly string[]): DiagnosticsInvocation => {
  const forwarded: string[] = [];
  const errors: string[] = [];
  let analyzer = true;
  let failOn: TsgoSeverity | 'none' | undefined;
  let project: string | undefined;
  let file: string | undefined;
  let format: DiagnosticsFormat = 'pretty';
  let severity: string | undefined;
  let lspconfig: string | undefined;
  let strict = false;
  let progress = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === '--no-analyzer') {
      analyzer = false;
      continue;
    }
    if (arg === '--fail-on' || arg.startsWith('--fail-on=')) {
      const raw = arg.startsWith('--fail-on=') ? arg.slice('--fail-on='.length) : args[++i];
      const value = (raw ?? '').trim().toLowerCase();
      if (value === 'none') failOn = 'none';
      else if (value === 'error' || value === 'warning' || value === 'message') failOn = value;
      else if (value === 'info') failOn = 'message';
      else {
        errors.push(
          `Invalid value for --fail-on: ${String(raw)} (expected error, warning, message or none)`,
        );
      }
      continue;
    }

    const prefix = VALUE_FLAGS.find((f) => arg === f || arg.startsWith(`${f}=`));
    if (prefix !== undefined) {
      forwarded.push(arg);
      let value: string | undefined;
      if (arg.startsWith(`${prefix}=`)) {
        value = arg.slice(prefix.length + 1);
      } else {
        value = args[i + 1];
        if (value !== undefined) {
          forwarded.push(value);
          i++;
        }
      }
      if (prefix === '--project') project = value;
      else if (prefix === '--file') file = value;
      else if (prefix === '--severity') severity = value;
      else if (prefix === '--lspconfig') lspconfig = value;
      else if (value !== undefined && FORMATS.includes(value)) format = value as DiagnosticsFormat;
      continue;
    }

    if (arg === '--strict') strict = true;
    if (arg === '--progress') progress = true;
    forwarded.push(arg);
  }

  return {
    forwarded,
    analyzer,
    failOn,
    project,
    file,
    format,
    severity,
    lspconfig,
    strict,
    progress,
    errors,
  };
};

/**
 * `@effect/tsgo`'s own `--severity` semantics, ported exactly: entries are
 * trimmed and lowercased, unrecognised ones are ignored, and a list with no
 * recognised entry disables filtering rather than failing the run.
 */
export const parseSeverityFilter = (
  value: string | undefined,
): ReadonlySet<TsgoSeverity> | undefined => {
  if (value === undefined || value === '') return undefined;
  const result = new Set<TsgoSeverity>();
  for (const item of value.split(',')) {
    const level = item.trim().toLowerCase();
    if (level === 'error' || level === 'warning' || level === 'message') result.add(level);
  }
  return result.size === 0 ? undefined : result;
};

// =============================================================================
// Rendering the analyzer's own findings, in upstream's formats
// =============================================================================

/**
 * GitHub workflow command escaping, exactly as `@effect/tsgo` applies it.
 *
 * Escaping `%` first is what stops a message containing a literal `%0A` from
 * being decoded by the runner as a newline and ending the command early.
 */
const escapeWorkflowData = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const GITHUB_COMMAND: Record<TsgoSeverity, string> = {
  error: 'error',
  warning: 'warning',
  message: 'notice',
};

const COLOUR: Record<TsgoSeverity, string> = {
  error: '[91m',
  warning: '[93m',
  message: '[96m',
};

/** Analyzer rules are labelled distinctly from upstream's `effect(name)`. */
const label = (name: string): string => `effect-analyzer(${name})`;

/**
 * Render one analyzer finding the way `@effect/tsgo` renders its own, so a
 * merged stream reads as a single report. `pretty` reproduces its source line
 * and span underline.
 */
export const renderAnalyzerDiagnostic = (
  d: Diagnostic,
  format: DiagnosticsFormat,
  source: string,
): string => {
  switch (format) {
    case 'json':
      return '';
    case 'github-actions':
      return `::${GITHUB_COMMAND[d.severity]} file=${d.file},line=${String(d.line)},col=${String(
        d.column,
      )},endLine=${String(d.endLine)},endColumn=${String(d.endColumn)},title=${
        d.name
      }::${escapeWorkflowData(d.message)}\n`;
    case 'text':
      return `${d.file}(${String(d.line)},${String(d.column)}): ${d.severity} ${label(d.name)}: ${
        d.message
      }\n`;
    case 'pretty': {
      const colour = COLOUR[d.severity];
      const reset = '[0m';
      const header = `${colour}${d.file}:${String(d.line)}:${String(d.column)} - ${
        d.severity
      } ${label(d.name)}:${reset} ${d.message}\n`;
      const lines = source.split('\n');
      if (d.line <= 0 || d.line > lines.length) return header;
      const text = (lines[d.line - 1] ?? '').replace(/\r$/, '');
      const underline =
        ' '.repeat(Math.max(d.column - 1, 0)) + '~'.repeat(Math.max(d.endColumn - d.column, 1));
      return `${header}\n${String(d.line)} ${text}\n  ${colour}${underline}${reset}\n\n`;
    }
  }
};

/**
 * Whether `@effect/tsgo` actually produced a diagnostics report.
 *
 * It exits 1 for a missing target, an unsupported flag, unparseable
 * `--lspconfig` and `--help` just as it does for a run that found errors, so
 * the status alone cannot tell a failed invocation from a failing check. The
 * report itself can: JSON mode parses to a `diagnostics` array, and every
 * textual mode ends with the summary trailer. Without one, upstream's output
 * and status are the entire answer — merging findings into a help screen, or
 * letting `--fail-on` turn a usage error into a pass, would report a run that
 * never happened as a clean one.
 */
export const producedReport = (stdout: string, format: DiagnosticsFormat): boolean => {
  if (format === 'json') {
    const start = stdout.indexOf('{');
    if (start === -1) return false;
    try {
      const parsed = JSON.parse(stdout.slice(start)) as { diagnostics?: unknown };
      return Array.isArray(parsed.diagnostics);
    } catch {
      return false;
    }
  }
  return splitTrailer(stdout).trailer.length > 0;
};

/**
 * Split upstream's textual output into the diagnostics it rendered and its
 * trailing summary block, so analyzer findings can be appended to the former
 * without disturbing a byte of it.
 */
export const splitTrailer = (
  stdout: string,
): { readonly body: string; readonly trailer: string } => {
  const match =
    /(?:Effect version per file:\n(?:  .*\n)*)?Checked \d+ files out of \d+ files\. \n\d+ errors, \d+ warnings and \d+ messages\.\n$/.exec(
      stdout,
    );
  if (!match) return { body: stdout, trailer: '' };
  return { body: stdout.slice(0, match.index), trailer: match[0] };
};

/** Rewrite upstream's counts line so it accounts for the analyzer's findings. */
export const retotalTrailer = (trailer: string, ours: readonly Diagnostic[]): string => {
  const match = /(\d+) errors, (\d+) warnings and (\d+) messages\.\n$/.exec(trailer);
  if (!match) return trailer;
  const count = (severity: TsgoSeverity): number =>
    ours.filter((d) => d.severity === severity).length;
  return (
    trailer.slice(0, match.index) +
    `${String(Number(match[1]) + count('error'))} errors, ` +
    `${String(Number(match[2]) + count('warning'))} warnings and ` +
    `${String(Number(match[3]) + count('message'))} messages.\n`
  );
};

/**
 * Splice analyzer findings into upstream's JSON.
 *
 * Its `diagnostics` array is preserved exactly as it came back — same entries,
 * same order — and ours are appended after it, so a consumer relying on
 * upstream's ordering still gets it.
 */
export const mergeJson = (stdout: string, ours: readonly Diagnostic[]): string => {
  const start = stdout.indexOf('{');
  if (start === -1) return stdout;
  interface UpstreamJson {
    diagnostics?: readonly Record<string, unknown>[];
    files?: readonly unknown[];
    summary?: Record<string, number>;
  }
  let parsed: UpstreamJson;
  try {
    parsed = JSON.parse(stdout.slice(start)) as UpstreamJson;
  } catch {
    return stdout;
  }
  const diagnostics = [
    ...(parsed.diagnostics ?? []).map((d) => ({ ...d, source: 'tsgo' })),
    ...ours,
  ];
  const count = (severity: TsgoSeverity): number =>
    diagnostics.filter((d) => (d as { severity?: unknown }).severity === severity).length;
  return `${JSON.stringify(
    {
      diagnostics,
      ...(parsed.files === undefined ? {} : { files: parsed.files }),
      summary: {
        ...(parsed.summary ?? {}),
        errors: count('error'),
        warnings: count('warning'),
        messages: count('message'),
      },
    },
    null,
    2,
  )}\n`;
};

// =============================================================================
// Running
// =============================================================================

/** Byte offset of a 1-indexed line and column within `source`. */
const offsetOf = (source: string, line: number, column: number): number => {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = source.indexOf('\n', offset);
    if (next === -1) return offset;
    offset = next + 1;
  }
  return offset + Math.max(0, column - 1);
};

interface AnalyzerFinding {
  readonly diagnostic: Diagnostic;
  readonly source: string;
}

/** Analyzer AST rules over the given files, in the upstream schema. */
const analyzerDiagnostics = async (
  files: readonly string[],
  severity: ReadonlySet<TsgoSeverity> | undefined,
): Promise<readonly AnalyzerFinding[]> => {
  const out: AnalyzerFinding[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = await readFile(file, 'utf-8');
    } catch {
      continue;
    }
    for (const issue of lintSourceCode(source, file).issues) {
      const line = issue.location?.line ?? 1;
      const column = issue.location?.column ?? 1;
      const endLine = issue.location?.endLine ?? line;
      const endColumn = issue.location?.endColumn ?? column;
      const mapped: TsgoSeverity = issue.severity === 'info' ? 'message' : issue.severity;
      if (severity !== undefined && !severity.has(mapped)) continue;
      const start = offsetOf(source, line, column);
      const end = offsetOf(source, endLine, endColumn);
      out.push({
        source,
        diagnostic: {
          file,
          start,
          length: Math.max(0, end - start),
          line,
          column,
          endLine,
          endColumn,
          severity: mapped,
          code: ANALYZER_DIAGNOSTIC_CODE,
          name: issue.rule,
          message: issue.message,
          source: 'analyzer',
        },
      });
    }
  }
  return out;
};

/** Highest severity upstream reported, read back from its own output. */
const upstreamWorstSeverity = (stdout: string): number => {
  const counts =
    /"errors":\s*(\d+),\s*"warnings":\s*(\d+),\s*"messages":\s*(\d+)/.exec(stdout) ??
    /(\d+) errors, (\d+) warnings and (\d+) messages\./.exec(stdout);
  if (!counts) return 0;
  if (Number(counts[1]) > 0) return SEVERITY_ORDER.error;
  if (Number(counts[2]) > 0) return SEVERITY_ORDER.warning;
  if (Number(counts[3]) > 0) return SEVERITY_ORDER.message;
  return 0;
};

export interface DiagnosticsRunResult {
  readonly output: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export const runDiagnosticsCommand = async (
  args: readonly string[],
): Promise<DiagnosticsRunResult> => {
  const invocation = splitDiagnosticsArgs(args);
  if (invocation.errors.length > 0) throw new TsgoDiagnosticsError(invocation.errors.join('\n'));

  // Forwarded exactly as given. `@effect/tsgo` reads the project's own
  // `@effect/language-service` plugin options, so synthesising a `--lspconfig`
  // here would replace the severities a project configured with rule defaults.
  const tsgo = spawnTsgoDiagnostics(invocation.forwarded, {
    inheritStderr: invocation.progress,
  });

  // Upstream did not produce a report: its output and its status are the whole
  // answer, and nothing of ours belongs in them.
  if (!producedReport(tsgo.stdout, invocation.format)) {
    return { output: tsgo.stdout, stderr: tsgo.stderr, exitCode: tsgo.status };
  }

  // `--project` and `--file` together are a union upstream, not a narrowing.
  const analyzerFiles = !invocation.analyzer
    ? []
    : [
        ...new Set([
          ...(invocation.project === undefined
            ? []
            : readTsgoProjectFiles(resolve(invocation.project))),
          ...(invocation.file === undefined ? [] : [resolve(invocation.file)]),
        ]),
      ];

  const findings = await analyzerDiagnostics(
    analyzerFiles,
    parseSeverityFilter(invocation.severity),
  );
  const ours = findings.map((f) => f.diagnostic);

  const exitCode = ((): number => {
    if (invocation.failOn === 'none') return 0;
    if (invocation.failOn !== undefined) {
      const worst = Math.max(
        upstreamWorstSeverity(tsgo.stdout),
        ...ours.map((d) => SEVERITY_ORDER[d.severity]),
        0,
      );
      return worst >= SEVERITY_ORDER[invocation.failOn] ? 1 : 0;
    }
    // Upstream already decided about its own diagnostics under its own rule;
    // only ours can add a failure it did not see.
    const threshold = invocation.strict ? SEVERITY_ORDER.warning : SEVERITY_ORDER.error;
    return Math.max(tsgo.status, ours.some((d) => SEVERITY_ORDER[d.severity] >= threshold) ? 1 : 0);
  })();

  // JSON is re-serialised even with nothing to add, so `source` is always
  // present and the schema does not change shape with `--no-analyzer`. Entry
  // order and every upstream field are preserved by the merge.
  if (invocation.format === 'json') {
    return { output: mergeJson(tsgo.stdout, ours), stderr: tsgo.stderr, exitCode };
  }

  // Every other format is upstream's own output, byte for byte, when we have
  // nothing to contribute to it.
  if (ours.length === 0) {
    return { output: tsgo.stdout, stderr: tsgo.stderr, exitCode };
  }

  const { body, trailer } = splitTrailer(tsgo.stdout);
  const rendered = findings
    .map((f) => renderAnalyzerDiagnostic(f.diagnostic, invocation.format, f.source))
    .join('');
  return {
    output: `${body}${rendered}${retotalTrailer(trailer, ours)}`,
    stderr: tsgo.stderr,
    exitCode,
  };
};
