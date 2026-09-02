/**
 * Bridge to the official Effect language service (`@effect/tsgo`).
 *
 * `@effect/tsgo` ships ~95 *type-aware* Effect rules backed by TypeScript-Go.
 * We do not reimplement those — we shell out to its JSON diagnostics mode and
 * merge the results into our findings, so effect-analyzer stays focused on the
 * things it uniquely does (structure, diagrams, IR, migration progress).
 *
 * It is a direct dependency so `--tsgo` is a reliable first-class capability.
 * The target project still supplies TypeScript 7: `@effect/tsgo` discovers that
 * installation and selects the matching native artifact, keeping diagnostics
 * aligned with the compiler and language service used by the project.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { nodeModuleLocation } from './register-node-ts-morph';
import { loadTsMorph } from './ts-morph-loader';

export interface TsgoDiagnostic {
  readonly filePath: string;
  readonly rule: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  /** Byte offset and width of the span, as `@effect/tsgo` reports them. */
  readonly start: number;
  readonly length: number;
  /**
   * The synthesized TypeScript error code. Every Effect language service
   * diagnostic lives in the 377xxx range, which is what lets a consumer prove a
   * finding came from the Effect LSP rather than from the type checker.
   */
  readonly code: number;
  readonly source: 'tsgo';
}

/** `@effect/tsgo`'s own run summary. `filesChecked: 0` means nothing was checked. */
export interface TsgoSummary {
  readonly filesChecked: number;
  readonly totalFiles: number;
  readonly errors: number;
  readonly warnings: number;
  readonly messages: number;
}

/** Per-file Effect versions, present only for a `--list-files` run. */
export interface TsgoFileVersion {
  readonly file: string;
  readonly detectedEffect: string;
  readonly supportedEffect: string;
}

export interface TsgoResult {
  readonly diagnostics: readonly TsgoDiagnostic[];
  readonly summary: TsgoSummary;
  readonly files: readonly TsgoFileVersion[];
}

export class TsgoDiagnosticsError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TsgoDiagnosticsError';
    this.cause = cause;
  }
}

interface TsgoJsonDiagnostic {
  readonly file: string;
  readonly start: number;
  readonly length: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: 'error' | 'warning' | 'message';
  readonly code: number;
  readonly name: string;
  readonly message: string;
}

const resolveTsgoBinFrom = (from: string): string | undefined => {
  try {
    const require = createRequire(from);
    const manifestPath = require.resolve('@effect/tsgo/package.json');
    const manifest = require('@effect/tsgo/package.json') as {
      bin?: string | Record<string, string>;
      publishConfig?: { bin?: string | Record<string, string> };
    };
    // Published builds declare the real entry under publishConfig.bin; the
    // source checkout points `bin` at a .ts file that node cannot run.
    const bin = manifest.publishConfig?.bin ?? manifest.bin;
    const entry = typeof bin === 'string' ? bin : bin?.['effect-tsgo'];
    if (!entry) return undefined;
    return join(dirname(manifestPath), entry);
  } catch {
    return undefined;
  }
};

/**
 * Absolute path to the `effect-tsgo` entry script, or `undefined` when the peer
 * is not installed.
 *
 * Tries our own package location first, then the consumer's cwd — under `npx`
 * the CLI runs from a temp dir that cannot see the project's node_modules.
 */
export const resolveTsgoBin = (from?: string): string | undefined => {
  const roots = from
    ? [from]
    : [nodeModuleLocation, join(process.cwd(), 'noop.js')];
  for (const root of roots) {
    const found = resolveTsgoBinFrom(root);
    if (found) return found;
  }
  return undefined;
};

const toSeverity = (severity: TsgoJsonDiagnostic['severity']): TsgoDiagnostic['severity'] =>
  severity === 'message' ? 'info' : severity;

/**
 * Absolute paths a tsconfig actually includes.
 *
 * A file we scanned that is absent from this list was never in the language
 * service's scope, so its lack of diagnostics is not evidence that it is clean.
 */
export const readTsgoProjectFiles = (projectPath: string): readonly string[] => {
  try {
    const { Project } = loadTsMorph();
    const project = new Project({ tsConfigFilePath: projectPath });
    return project.getSourceFiles().map((f) => resolve(f.getFilePath()));
  } catch {
    return [];
  }
};

export interface ParsedTsgoProjectArgument {
  readonly project: string;
  readonly consumed: 0 | 1;
}

/**
 * Parse bare `--tsgo` without stealing a positional source path. A separated
 * project path remains supported after the source path for compatibility;
 * option-first callers use `--tsgo=<path>` for an explicit project.
 */
export const parseTsgoProjectArgument = (
  args: readonly string[],
  index: number,
  hasPathArg: boolean,
): ParsedTsgoProjectArgument => {
  const next = args[index + 1];
  if (hasPathArg && next !== undefined && !next.startsWith('-')) {
    return { project: next, consumed: 1 };
  }
  return { project: 'tsconfig.json', consumed: 0 };
};

/** Resolve the project exactly as the child process will resolve it. */
export const resolveTsgoProjectPath = (project: string, cwd: string): string =>
  isAbsolute(project) ? project : resolve(cwd, project);

/**
 * Parse the `--format json` payload. Tolerates leading noise on stdout and
 * returns `undefined` rather than throwing on anything unexpected.
 */
export const parseTsgoOutput = (stdout: string): TsgoResult | undefined => {
  const start = stdout.indexOf('{');
  if (start === -1) return undefined;
  type TsgoJsonOutput = {
    diagnostics?: readonly TsgoJsonDiagnostic[];
    summary?: Partial<TsgoSummary>;
    files?: readonly TsgoFileVersion[];
  };
  let parsed: TsgoJsonOutput;
  try {
    parsed = JSON.parse(stdout.slice(start)) as TsgoJsonOutput;
  } catch {
    return undefined;
  }
  const diagnostics = parsed.diagnostics;
  if (!Array.isArray(diagnostics)) return undefined;

  const summary = parsed.summary ?? {};
  return {
    diagnostics: diagnostics.map((d: TsgoJsonDiagnostic) => ({
      filePath: d.file,
      rule: d.name,
      severity: toSeverity(d.severity),
      message: d.message,
      line: d.line,
      column: d.column,
      endLine: d.endLine,
      endColumn: d.endColumn,
      start: d.start,
      length: d.length,
      code: d.code,
      source: 'tsgo' as const,
    })),
    summary: {
      filesChecked: summary.filesChecked ?? 0,
      totalFiles: summary.totalFiles ?? 0,
      errors: summary.errors ?? 0,
      warnings: summary.warnings ?? 0,
      messages: summary.messages ?? 0,
    },
    files: parsed.files ?? [],
  };
};

/**
 * Run `effect-tsgo diagnostics --format json` over a project.
 *
 * Non-zero exits that contain valid diagnostic JSON are accepted. Missing
 * binaries, invalid projects, and unparseable failures throw an actionable
 * error because callers only invoke this function after explicitly requesting
 * official type-aware diagnostics.
 */
export interface TsgoProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

/**
 * Run `effect-tsgo diagnostics` with the caller's own argv and return its raw
 * output.
 *
 * Nothing here interprets or re-renders what comes back: `@effect/tsgo`
 * validates its own flags, formats its own diagnostics and chooses its own exit
 * code, which is the only way a wrapper stays identical to it across releases.
 */
export const spawnTsgoDiagnostics = (
  argv: readonly string[],
  options: { readonly cwd?: string; readonly timeoutMs?: number; readonly inheritStderr?: boolean } = {},
): TsgoProcessResult => {
  const bin = resolveTsgoBin();
  if (!bin) {
    throw new TsgoDiagnosticsError(
      'Unable to resolve @effect/tsgo. Reinstall effect-analyzer and its platform dependencies.',
    );
  }
  const result = spawnSync(process.execPath, [bin, 'diagnostics', ...argv], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 120_000,
    stdio: ['ignore', 'pipe', options.inheritStderr === true ? 'inherit' : 'pipe'],
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
};

export interface RunTsgoOptions {
  /** Project to check. Optional when `file` is given, as upstream allows. */
  readonly project?: string | undefined;
  /** Single file to check, forwarded as `--file`. */
  readonly file?: string | undefined;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Inline JSON replacing the project's plugin options, as `--lspconfig`. */
  readonly lspconfig?: string | undefined;
  readonly severity?: string | undefined;
  readonly strict?: boolean;
  readonly progress?: boolean;
  readonly listFiles?: boolean;
}

export const runTsgoDiagnostics = (options: RunTsgoOptions): TsgoResult => {
  const bin = resolveTsgoBin();
  if (!bin) {
    throw new TsgoDiagnosticsError(
      'Unable to resolve @effect/tsgo. Reinstall effect-analyzer and its platform dependencies.',
    );
  }

  const projectResolutionCwd = options.cwd ?? process.cwd();
  const projectPath = options.project === undefined
    ? undefined
    : resolveTsgoProjectPath(options.project, projectResolutionCwd);
  // When the caller supplies an absolute project from another cwd, execute in
  // the project directory so effect-tsgo resolves that consumer's TypeScript
  // and Effect packages rather than packages belonging to the host process.
  const cwd = options.cwd ?? (projectPath === undefined ? process.cwd() : dirname(projectPath));

  // Only what the caller asked for: `@effect/tsgo` reads the project's own
  // `@effect/language-service` plugin options, and synthesising one here would
  // replace configured severities with rule defaults.
  const lspconfig = options.lspconfig;

  const argv = [
    bin,
    'diagnostics',
    ...(projectPath === undefined ? [] : ['--project', projectPath]),
    ...(options.file === undefined ? [] : ['--file', options.file]),
    '--format',
    'json',
    ...(options.severity === undefined ? [] : ['--severity', options.severity]),
    ...(options.strict === true ? ['--strict'] : []),
    ...(options.progress === true ? ['--progress'] : []),
    ...(options.listFiles === true ? ['--list-files'] : []),
    ...(lspconfig === undefined ? [] : ['--lspconfig', lspconfig]),
  ];

  let stdout: string;
  try {
    stdout = execFileSync(
      process.execPath,
      argv,
      {
        cwd,
        encoding: 'utf-8',
        // A non-zero exit just means diagnostics were found; the JSON is still
        // on stdout, so read it from the thrown error rather than bailing out.
        maxBuffer: 64 * 1024 * 1024,
        timeout: options.timeoutMs ?? 120_000,
        // `--progress` narrates to stderr; let it through so it reaches the
        // user's terminal instead of being buffered and discarded.
        stdio: ['ignore', 'pipe', options.progress === true ? 'inherit' : 'pipe'],
      },
    );
  } catch (error) {
    const processError = error as {
      readonly stdout?: string | Buffer;
      readonly stderr?: string | Buffer;
    };
    const out = processError.stdout;
    stdout = out === undefined
      ? ''
      : typeof out === 'string'
        ? out
        : out.toString('utf-8');
    const result = parseTsgoOutput(stdout);
    if (result) return result;

    const stderr = processError.stderr;
    const detail = stderr === undefined
      ? ''
      : typeof stderr === 'string'
        ? stderr.trim()
        : stderr.toString('utf-8').trim();
    const target = projectPath ?? options.file ?? '(no target)';
    throw new TsgoDiagnosticsError(
      detail.length > 0
        ? `@effect/tsgo diagnostics failed: ${detail}`
        : `@effect/tsgo diagnostics failed for ${target}`,
      error,
    );
  }

  const result = parseTsgoOutput(stdout);
  if (!result) {
    throw new TsgoDiagnosticsError(
      `@effect/tsgo returned unparseable diagnostics for ${projectPath ?? options.file ?? '(no target)'}`,
    );
  }
  return result;
};
