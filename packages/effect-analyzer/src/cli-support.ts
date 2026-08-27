/**
 * Shared CLI plumbing.
 *
 * The tagged error commands fail with, terminal styling, path resolution, and
 * the small output helpers every mode needs. No mode logic lives here.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import { isAbsolute, resolve } from 'path';
import { Console, Data, Effect, Option } from 'effect';
import type { LintFinding } from './lint-session';

/**
 * The CLI's failure channel. It terminates at the process boundary — nothing
 * pattern-matches on it, it is rendered and the process exits — so one tag
 * carrying a message keeps the channel typed without inventing a taxonomy that
 * would have no consumer.
 */
export class CliError extends Data.TaggedError('CliError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const cliFail = (message: string, cause?: unknown): Effect.Effect<never, CliError> =>
  Effect.fail(cause === undefined ? new CliError({ message }) : new CliError({ message, cause }));

/** `Effect.tryPromise` with the CLI's tagged error instead of an untyped channel. */
export const cliTry = <A>(thunk: () => Promise<A>): Effect.Effect<A, CliError> =>
  Effect.tryPromise({
    try: thunk,
    catch: (cause) =>
      new CliError({ message: cause instanceof Error ? cause.message : String(cause), cause }),
  });

/**
 * Read each file into a line array for fix generation.
 *
 * Files that cannot be read are skipped, not fatal — a single unreadable file
 * must not abort an `--improve` run over a whole project. Exported so that skip
 * is testable; it previously used `try/catch` around a `yield*`, which cannot
 * catch an Effect failure, so the guard never fired.
 */
export const buildSourceLinesMap = (
  filePaths: Iterable<string>,
): Effect.Effect<ReadonlyMap<string, readonly string[]>, never> =>
  Effect.gen(function* () {
    const sourceLinesMap = new Map<string, readonly string[]>();
    for (const filePath of filePaths) {
      const content = yield* cliTry(() => fs.readFile(filePath, 'utf-8')).pipe(Effect.option);
      if (Option.isSome(content)) {
        sourceLinesMap.set(filePath, content.value.split('\n'));
      }
    }
    return sourceLinesMap;
  });

/** ANSI colors for gold-tier verbose output (disabled when --no-color or not TTY). */
export function createStyle(useColor: boolean) {
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

export const resolveCliPath = (inputPath: string | undefined): string => {
  const candidate = inputPath ?? '.';
  if (isAbsolute(candidate)) return candidate;

  const fromCurrent = resolve(candidate);
  if (existsSync(fromCurrent)) return fromCurrent;

  const fallbackBases = [process.env.INIT_CWD, process.env.PWD, process.env.OLDPWD];
  for (const base of fallbackBases) {
    if (!base || base.trim().length === 0) continue;
    const fromBase = resolve(base, candidate);
    if (existsSync(fromBase)) return fromBase;
  }

  return fromCurrent;
};

/** Best-effort open of a file in the OS default application. */
export const openInBrowser = (file: string): Effect.Effect<void> =>
  Effect.sync(() => {
    let cmd: string;
    let args: string[];
    if (process.platform === 'darwin') {
      cmd = 'open';
      args = [file];
    } else if (process.platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', '', file];
    } else {
      cmd = 'xdg-open';
      args = [file];
    }
    try {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    } catch {
      // best-effort; a failed open should not fail the command
    }
  });

export const extractBaselineFindings = (raw: unknown): readonly LintFinding[] => {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const direct = obj.findings;
  const data = obj.data;
  const candidates = Array.isArray(direct)
    ? direct
    : Array.isArray(data)
      ? data
      : [];
  return candidates.filter((item): item is LintFinding => {
    if (!item || typeof item !== 'object') return false;
    const rec = item as Record<string, unknown>;
    return (
      typeof rec.filePath === 'string' &&
      typeof rec.rule === 'string' &&
      typeof rec.severity === 'string' &&
      typeof rec.message === 'string' &&
      typeof rec.line === 'number' &&
      typeof rec.column === 'number' &&
      typeof rec.fingerprint === 'string'
    );
  });
};

/**
 * Render a per-analyzer report and either write it to `options.output` or log
 * it to stdout. Picks between the JSON and markdown renderer based on
 * `options.format`. Shared by all single-analyzer modes (--error-channel,
 * --service-health, --performance, --coupling) so they stay in lockstep.
 */
export const writeAnalyzerOutput = <A>(
  analysis: A,
  options: { readonly format: string; readonly pretty: boolean; readonly output: string | undefined },
  renderers: { readonly json: (a: A, pretty: boolean) => string; readonly markdown: (a: A) => string },
) =>
  Effect.gen(function* () {
    const text =
      options.format === 'json'
        ? renderers.json(analysis, options.pretty)
        : renderers.markdown(analysis);
    if (options.output) {
      yield* cliTry(() => fs.writeFile(resolve(options.output!), text, 'utf-8'));
    } else {
      yield* Console.log(text);
    }
  });
