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

import { execFileSync } from 'node:child_process';
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
  readonly line: number;
  readonly column: number;
  readonly severity: 'error' | 'warning' | 'message';
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
 * Extract the `@effect/tsgo` plugin options from a tsconfig, as inline JSON for
 * `--lspconfig`.
 *
 * `effect-tsgo diagnostics` does NOT read plugin options out of tsconfig — with
 * only a `plugins` entry it reports `filesChecked: 0` and no diagnostics at all.
 * Forwarding the options ourselves is what makes the CLI agree with the editor.
 * ts-morph's config loader is used because tsconfig is JSONC and plugin options
 * may be inherited through `extends`. `{}` means "enable with rule defaults"
 * and is used only when no plugin entry can be loaded.
 */
export const readTsgoLspConfig = (projectPath: string): string => {
  try {
    const { Project } = loadTsMorph();
    const project = new Project({
      tsConfigFilePath: projectPath,
      skipAddingFilesFromTsConfig: true,
    });
    const plugins = project.getCompilerOptions().plugins as
      | readonly Record<string, unknown>[]
      | undefined;
    const plugin = plugins?.find((p) => p['name'] === '@effect/tsgo');
    if (!plugin) return '{}';
    const { name: _name, ...options } = plugin;
    return JSON.stringify(options);
  } catch {
    return '{}';
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
export const parseTsgoOutput = (stdout: string): readonly TsgoDiagnostic[] | undefined => {
  const start = stdout.indexOf('{');
  if (start === -1) return undefined;
  let parsed: { diagnostics?: readonly TsgoJsonDiagnostic[] };
  try {
    parsed = JSON.parse(stdout.slice(start)) as { diagnostics?: readonly TsgoJsonDiagnostic[] };
  } catch {
    return undefined;
  }
  const diagnostics = parsed.diagnostics;
  if (!Array.isArray(diagnostics)) return undefined;

  return diagnostics.map((d: TsgoJsonDiagnostic) => ({
    filePath: d.file,
    rule: d.name,
    severity: toSeverity(d.severity),
    message: d.message,
    line: d.line,
    column: d.column,
  }));
};

/**
 * Run `effect-tsgo diagnostics --format json` over a project.
 *
 * Non-zero exits that contain valid diagnostic JSON are accepted. Missing
 * binaries, invalid projects, and unparseable failures throw an actionable
 * error because callers only invoke this function after explicitly requesting
 * official type-aware diagnostics.
 */
export const runTsgoDiagnostics = (options: {
  readonly project: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}): readonly TsgoDiagnostic[] => {
  const bin = resolveTsgoBin();
  if (!bin) {
    throw new TsgoDiagnosticsError(
      'Unable to resolve @effect/tsgo. Reinstall effect-analyzer and its platform dependencies.',
    );
  }

  const projectResolutionCwd = options.cwd ?? process.cwd();
  const projectPath = resolveTsgoProjectPath(options.project, projectResolutionCwd);
  // When the caller supplies an absolute project from another cwd, execute in
  // the project directory so effect-tsgo resolves that consumer's TypeScript
  // and Effect packages rather than packages belonging to the host process.
  const cwd = options.cwd ?? dirname(projectPath);

  let stdout: string;
  try {
    stdout = execFileSync(
      process.execPath,
      [
        bin,
        'diagnostics',
        '--project',
        projectPath,
        '--format',
        'json',
        '--lspconfig',
        readTsgoLspConfig(projectPath),
      ],
      {
        cwd,
        encoding: 'utf-8',
        // A non-zero exit just means diagnostics were found; the JSON is still
        // on stdout, so read it from the thrown error rather than bailing out.
        maxBuffer: 64 * 1024 * 1024,
        timeout: options.timeoutMs ?? 120_000,
        stdio: ['ignore', 'pipe', 'pipe'],
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
    const diagnostics = parseTsgoOutput(stdout);
    if (diagnostics) return diagnostics;

    const stderr = processError.stderr;
    const detail = stderr === undefined
      ? ''
      : typeof stderr === 'string'
        ? stderr.trim()
        : stderr.toString('utf-8').trim();
    throw new TsgoDiagnosticsError(
      detail.length > 0
        ? `@effect/tsgo diagnostics failed: ${detail}`
        : `@effect/tsgo diagnostics failed for ${projectPath}`,
      error,
    );
  }

  const diagnostics = parseTsgoOutput(stdout);
  if (!diagnostics) {
    throw new TsgoDiagnosticsError(
      `@effect/tsgo returned unparseable diagnostics for ${projectPath}`,
    );
  }
  return diagnostics;
};
