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
import { cliFail, cliTry, resolveCliPath } from './cli-support';
import { parseArgs } from './cli-options';
import { computeStateMachineCoverage } from './state-machine-coverage';
import { renderStatechartsMermaid } from './output/mermaid-statechart';
import { analyzeProject } from './project-analyzer';
import { detectServiceCycles } from './service-cycles';



























const main = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const { pathArg, options } = parseArgs(args);

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

  const resolvedPath = resolveCliPath(pathArg);

  const s = yield* cliTry(() => fs.stat(resolvedPath)).pipe(
    Effect.option,
  );
  if (Option.isNone(s)) {
    yield* Console.error(`Error: Path not found: ${resolvedPath}`);
    return yield* cliFail('Path not found');
  }

  const isDir = s.value.isDirectory();

  if (options.coverageAudit) {
    if (!isDir) {
      yield* Console.error('Error: --coverage-audit requires a directory path');
      return yield* cliFail('Coverage audit requires directory');
    }
    yield* runCoverageAuditCli(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (options.serviceCycles) {
    if (!isDir) {
      yield* Console.error('Error: --service-cycles requires a directory path');
      return yield* cliFail('Service cycles requires directory');
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
      yield* Console.error('openapi-runtime requires a file path (entrypoint), not a directory.');
      return yield* cliFail('openapi-runtime needs entrypoint file');
    }
    yield* runOpenApiRuntime(resolvedPath, options);
    return Exit.succeed(undefined);
  }

  if (options.format === 'json-schema') {
    if (isDir) {
      yield* Console.error('json-schema requires a file path, not a directory.');
      return yield* cliFail('json-schema needs a file');
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
    yield* Console.log(`Analyzing ${resolvedPath}...`);
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
      yield* Console.error(`Fatal error: ${error.message}`);
      return Exit.fail(error);
    }),
  ),
);

// Run the program
Effect.runPromise(main).then(
  (exit) => {
    if (Exit.isFailure(exit)) {
      const cause = exit.cause;
      const rendered = JSON.stringify(cause);
      if (rendered) {
        console.error(`Error: ${rendered}`);
      }
      process.exit(1);
      return;
    }
    // Respect an exit code set during the run (e.g. coverage CI gate).
    process.exit(process.exitCode ?? 0);
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
