/**
 * CLI entry point.
 *
 * Dispatch only: `main` reads the parsed options and hands off to one mode.
 * Mode bodies live in `cli-mode-*.ts`, argument parsing in `cli-options.ts`,
 * and the shared plumbing in `cli-support.ts`.
 */

import './register-node-ts-morph';
import { runAnalysis } from './cli-mode-analysis';
import { runLintSourceMode, runReportsMode, runRulesMode } from './cli-mode-reports';
import { runCoverageAuditCli, runProjectMode } from './cli-mode-project';
import { runApiDocsMode, runJsonSchemaMode, runOpenApiRuntime } from './cli-mode-api';
import { runStatechartMode } from './cli-mode-statechart';
import { runDiffMode, runExtraAnalyzers, runMigration } from './cli-mode-extras';
import { resolve, basename } from 'path';
import * as fs from 'node:fs/promises';
import { Effect, Console, Exit, Option } from 'effect';
import { analyzeStateMachines } from './state-machine';
import { runWatchMode } from './watch-mode';
import { cliFail, cliTry, expandCliPaths, resolveCliPath } from './cli-support';
import { parseArgs, type CLIOptions } from './cli-options';
import {
  isProxiedTsgoCommand,
  proxyTsgoCommand,
  runDiagnosticsCommand,
} from './cli-diagnostics';
import { computeStateMachineCoverage } from './state-machine-coverage';
import { renderStatechartsMermaid } from './output/mermaid-statechart';
import { analyzeProject } from './project-analyzer';
import { detectServiceCycles } from './service-cycles';



























/** Formats whose renderers take a single entry point, not a list of files. */
const SINGLE_PATH_FORMATS = new Set<CLIOptions['format']>([
  'migration',
  'api-docs',
  'openapi-paths',
  'openapi-runtime',
  'json-schema',
  'mermaid-statechart',
  'svg-statechart',
  'statechart-html',
  'xstate-config',
  'statechart-coverage',
]);

/**
 * Analyze every path a shell or a pattern produced.
 *
 * Modes that read a directory, follow one file, or write one output file cannot
 * mean anything over a list, so they are refused with the reason rather than
 * run against whichever path happened to come first.
 */
const runManyPaths = (paths: readonly string[], options: CLIOptions) =>
  Effect.gen(function* () {
    const refusal =
      options.output
        ? '--output writes one file. Drop it, or pass one path.'
        : options.watch
          ? '--watch follows one path.'
          : options.coverageAudit || options.serviceCycles
            ? '--coverage-audit and --service-cycles read one directory.'
            : options.entryPoints || options.configLeaks || options.cliCommands
              ? '--entry-points, --config-leaks and --cli-commands read one file.'
              : SINGLE_PATH_FORMATS.has(options.format)
                ? `--format ${options.format} reads one path.`
                : undefined;
    if (refusal) {
      return yield* cliFail(`${String(paths.length)} paths given. ${refusal}`);
    }

    for (const path of paths) {
      const resolved = resolveCliPath(path);
      const stats = yield* cliTry(() => fs.stat(resolved)).pipe(Effect.option);
      if (Option.isNone(stats)) {
        return yield* cliFail(`Path not found: ${resolved}`);
      }
      if (stats.value.isDirectory()) {
        return yield* cliFail(
          `${resolved} is a directory. Analyze a directory on its own, not alongside other paths.`,
        );
      }
    }

    // JSON is collected and printed as one array: several documents in a row
    // are not a document. Every other format concatenates as it always has.
    const documents: string[] = [];
    const collect = options.format === 'json'
      ? (rendered: string) => Effect.sync(() => void documents.push(rendered))
      : undefined;

    for (const path of paths) {
      const resolved = resolveCliPath(path);
      if (!options.quiet) {
        yield* Console.error(`Analyzing ${resolved}...`);
      }
      yield* runAnalysis(resolved, options, collect);
    }

    if (collect) {
      yield* Console.log(`[${documents.join(',')}]`);
    }
  });

const main = Effect.gen(function* () {
  const args = process.argv.slice(2);

  // Subcommands are matched before flag parsing so `effect-analyze` can stand in
  // for `effect-tsgo` one-for-one.
  const [subcommand, ...subcommandArgs] = args;
  if (subcommand !== undefined && isProxiedTsgoCommand(subcommand)) {
    process.exitCode = yield* cliTry(() => Promise.resolve(proxyTsgoCommand(subcommand, subcommandArgs)));
    return Exit.succeed(undefined);
  }
  if (subcommand === 'diagnostics') {
    const result = yield* cliTry(() => runDiagnosticsCommand(subcommandArgs));
    // Written raw: this is effect-tsgo's own output, and Console.log would add
    // a newline it did not emit.
    yield* Effect.sync(() => {
      process.stdout.write(result.output);
      if (result.stderr.length > 0) process.stderr.write(result.stderr);
    });
    process.exitCode = result.exitCode;
    return Exit.succeed(undefined);
  }

  const { pathArg, pathArgs, options, errors: argErrors } = parseArgs(args);

  if (argErrors.length > 0) {
    return yield* cliFail(argErrors.join('\n'));
  }

  // `--diff` reads the positionals itself; every other mode reached before path
  // resolution takes one path, so extra ones are refused rather than dropped.
  const takesOnePath =
    options.lintSource ||
    options.agentReport ||
    options.errorChannel ||
    options.serviceHealth ||
    options.performance ||
    options.coupling ||
    options.improve ||
    options.listRules ||
    options.indexRules ||
    options.searchRules !== undefined ||
    options.explainRule !== undefined;
  if (pathArgs.length > 1 && !options.diff && takesOnePath) {
    return yield* cliFail(
      `Expected one path, received ${String(pathArgs.length)}: ${pathArgs.join(', ')}`,
    );
  }

  if (options.importSession) {
    const imported = yield* cliTry(() => fs.readFile(resolve(options.importSession!), 'utf-8'));
    const parsed = JSON.parse(imported);
    yield* Console.log(options.format === 'json' ? JSON.stringify(parsed, null, options.pretty ? 2 : 0) : imported);
    return Exit.succeed(undefined);
  }

  if (options.lintSource) {
    yield* runLintSourceMode(pathArg, options);
    return Exit.succeed(undefined);
  }

  // Agent report, error channel, service health, performance, coupling, improve modes
  if (options.agentReport || options.errorChannel || options.serviceHealth || options.performance || options.coupling || options.improve) {
    yield* runReportsMode(pathArg, options);
    return Exit.succeed(undefined);
  }

  if (options.listRules || options.indexRules || options.searchRules || options.explainRule) {
    yield* runRulesMode(pathArg, options);
    return Exit.succeed(undefined);
  }

  // Diff mode: compare two versions of an Effect program
  // Must run before path resolution since diff sources use ref:path syntax (e.g. HEAD:file.ts)
  if (options.diff) {
    yield* runDiffMode(options);
    return Exit.succeed(undefined);
  }

  const paths = yield* expandCliPaths(pathArgs);

  if (paths.length > 1) {
    yield* runManyPaths(paths, options);
    return Exit.succeed(undefined);
  }

  const resolvedPath = resolveCliPath(paths[0] ?? pathArg);

  const s = yield* cliTry(() => fs.stat(resolvedPath)).pipe(
    Effect.option,
  );
  if (Option.isNone(s)) {
    return yield* cliFail(`Path not found: ${resolvedPath}`);
  }

  const isDir = s.value.isDirectory();

  if (options.coverageAudit) {
    if (!isDir) {
      return yield* cliFail('--coverage-audit requires a directory path');
    }
    yield* runCoverageAuditCli(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (options.serviceCycles) {
    if (!isDir) {
      return yield* cliFail('--service-cycles requires a directory path');
    }
    const project = yield* analyzeProject(resolvedPath, {
      tsconfig: options.tsconfig,
      knownEffectInternalsRoot: options.knownEffectInternalsRoot,
      buildServiceMap: true,
      buildArchitecture: false,
    });
    const cycles = project.serviceMap ? detectServiceCycles(project.serviceMap) : [];
    const payload = {
      path: resolvedPath,
      serviceCount: project.serviceMap?.services.size ?? 0,
      unresolvedServices: project.serviceMap?.unresolvedServices.length ?? 0,
      cycleCount: cycles.length,
      cycles,
    };
    const text =
      options.format === 'json'
        ? JSON.stringify(payload, null, options.pretty ? 2 : 0)
        : cycles.length === 0
          ? 'No service dependency cycles detected.'
          : [
              `Detected ${String(cycles.length)} service cycle(s):`,
              ...cycles.map((cycle, idx) => `${String(idx + 1)}. ${cycle.services.join(' -> ')} -> ${cycle.services[0]}`),
            ].join('\n');
    if (options.output) {
      yield* cliTry(() => fs.writeFile(resolve(options.output!), text, 'utf-8'));
    } else {
      yield* Console.log(text);
    }
    return Exit.succeed(undefined);
  }

  if (options.entryPoints || options.configLeaks || options.cliCommands) {
    if (isDir) {
      yield* Console.error(
        'Error: --entry-points / --config-leaks / --cli-commands operate on single files, not directories.',
      );
      return yield* cliFail('Specific analyzer flag requires a file path');
    }
    yield* runExtraAnalyzers(resolvedPath, options);
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

  if (
    options.format === 'mermaid-statechart' ||
    options.format === 'svg-statechart' ||
    options.format === 'statechart-html' ||
    options.format === 'xstate-config' ||
    options.format === 'statechart-coverage'
  ) {
    yield* runStatechartMode(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (options.format === 'openapi-runtime') {
    if (isDir) {
      return yield* cliFail(
        'openapi-runtime requires a file path (entrypoint), not a directory.',
      );
    }
    yield* runOpenApiRuntime(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (options.format === 'json-schema') {
    if (isDir) {
      return yield* cliFail('json-schema requires a file path, not a directory.');
    }
    yield* runJsonSchemaMode(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (isDir) {
    yield* runProjectMode(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (options.watch) {
    yield* runWatchMode(resolvedPath, options, (path, watchOpts) =>
      runAnalysis(path, watchOpts),
    );
    return yield* Effect.never;
  }

  if (!options.quiet) {
    yield* Console.error(`Analyzing ${resolvedPath}...`);
  }
  yield* runAnalysis(resolvedPath, options);

  // Discoverability: in the default (auto) view, surface any state machines in
  // the file so users find the feature without knowing the --format flag.
  if (options.format === 'auto' && !options.output && !options.colocate) {
    const machines = yield* Effect.sync(() => {
      try {
        return analyzeStateMachines(resolvedPath).machines;
      } catch {
        return [];
      }
    });
    if (machines.length > 0) {
      const coverages = machines.map(computeStateMachineCoverage);
      yield* Console.log(
        `\n%% statechart\n${renderStatechartsMermaid({ machines }, coverages)}`,
      );
      if (!options.quiet) {
        yield* Console.error(
          `\n${machines.length} state machine${machines.length === 1 ? '' : 's'} detected. ` +
            `For diagram + coverage + XState config: effect-analyze ${basename(resolvedPath)} --format statechart-html`,
        );
      }
    }
  }

  return Exit.succeed(undefined);
}).pipe(
  Effect.catch((error: Error) =>
    Effect.gen(function* () {
      // The only place a failed run is reported. Modes carry their detail in
      // the error itself, so nothing prints ahead of this and nothing needs to
      // render the Cause behind it.
      yield* Console.error(`Error: ${error.message}`);
      return Exit.fail(error);
    }),
  ),
);

/**
 * Exit once stdout has drained.
 *
 * `process.exit` discards data still queued on a pipe, which silently truncated
 * every JSON report larger than the pipe buffer. Writing to a file hid it
 * because file writes complete synchronously.
 */
const exitWhenFlushed = (code: number): void => {
  process.exitCode = code;
  if (process.stdout.writableLength === 0) {
    process.exit(code);
  }
  process.stdout.once('drain', () => process.exit(code));
};

// Run the program
Effect.runPromise(main).then(
  (exit) => {
    if (Exit.isFailure(exit)) {
      // Already reported by the handler above. Stringifying the Cause here put
      // `{"_id":"Cause","failures":[...]}` in front of users who have no reason
      // to know the CLI is written in Effect.
      exitWhenFlushed(1);
      return;
    }
    // Respect an exit code set during the run (e.g. coverage CI gate).
    exitWhenFlushed(Number(process.exitCode ?? 0));
  },
  (err: unknown) => {
    const message =
      err instanceof Error ? err.message : String(err);
    if (message) {
      console.error(`Error: ${message}`);
    }
    exitWhenFlushed(1);
  },
);
