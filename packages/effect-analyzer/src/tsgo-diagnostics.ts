/**
 * Bridge to the official Effect language service (`@effect/tsgo`).
 *
 * `@effect/tsgo` ships ~95 *type-aware* Effect rules backed by TypeScript-Go.
 * We do not reimplement those — we shell out to its JSON diagnostics mode and
 * merge the results into our findings, so effect-analyzer stays focused on the
 * things it uniquely does (structure, diagrams, IR, migration progress).
 *
 * It is an *optional peer* dependency rather than a direct one on purpose:
 * `@effect/tsgo` picks its Go binary by resolving the consumer's `typescript`
 * package and matching its exact `gitHead` against the builds packaged in the
 * platform artifact. Only the consumer's own install can satisfy that, so
 * bundling a version of our own would nest a second copy that disagrees with
 * the one their editor runs. When it is absent, this module returns `undefined`
 * and callers carry on with the built-in source rules only.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export interface TsgoDiagnostic {
  readonly filePath: string;
  readonly rule: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly line: number;
  readonly column: number;
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
  const roots = from ? [from] : [import.meta.url, join(process.cwd(), 'noop.js')];
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
 * `{}` means "enable with rule defaults", so it is the right fallback for a
 * project with no plugin entry, an `extends` chain we do not follow, or a
 * tsconfig with comments we cannot parse.
 */
export const readTsgoLspConfig = (projectPath: string): string => {
  try {
    const parsed = JSON.parse(readFileSync(projectPath, 'utf-8')) as {
      compilerOptions?: { plugins?: readonly Record<string, unknown>[] };
    };
    const plugin = parsed.compilerOptions?.plugins?.find((p) => p['name'] === '@effect/tsgo');
    if (!plugin) return '{}';
    const { name: _name, ...options } = plugin;
    return JSON.stringify(options);
  } catch {
    return '{}';
  }
};

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
 * Returns `undefined` when `@effect/tsgo` is not installed or the run failed to
 * produce parseable output — never throws, because these diagnostics are an
 * enhancement, not a hard requirement.
 */
export const runTsgoDiagnostics = (options: {
  readonly project: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}): readonly TsgoDiagnostic[] | undefined => {
  const bin = resolveTsgoBin();
  if (!bin) return undefined;

  let stdout: string;
  try {
    stdout = execFileSync(
      process.execPath,
      [
        bin,
        'diagnostics',
        '--project',
        options.project,
        '--format',
        'json',
        '--lspconfig',
        readTsgoLspConfig(options.project),
      ],
      {
        cwd: options.cwd ?? process.cwd(),
        encoding: 'utf-8',
        // A non-zero exit just means diagnostics were found; the JSON is still
        // on stdout, so read it from the thrown error rather than bailing out.
        maxBuffer: 64 * 1024 * 1024,
        timeout: options.timeoutMs ?? 120_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch (error) {
    const out = (error as { stdout?: string | Buffer }).stdout;
    if (out === undefined) return undefined;
    stdout = typeof out === 'string' ? out : out.toString('utf-8');
  }

  return parseTsgoOutput(stdout);
};
