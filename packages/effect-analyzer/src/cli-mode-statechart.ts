/**
 * Statechart modes: diagram, coverage gate, XState export, and the local
 * visualizer page. Dispatched early because they read machines straight from
 * source rather than going through the Effect IR pipeline.
 */

/**
 * CLI entry point for effect-analyzer
 */

import './register-node-ts-morph';
import { join, extname, basename } from 'path';
import * as fs from 'node:fs/promises';
import { Effect, Console, Option } from 'effect';
import { analyzeStateMachines, summarizeAlphabet, type StateMachine } from './state-machine';
import {
  cliTry,
  openInBrowser,
} from './cli-support';
import {
  type CLIOptions,
} from './cli-options';
import { diagnoseStateMachines } from './state-machine-diagnostics';
import {
  computeStateMachineCoverage,
  type StateMachineCoverage,
} from './state-machine-coverage';
import { renderStatechartsMermaid } from './output/mermaid-statechart';
import { renderStatechartSVG, renderStatechartHTML } from './output/svg-statechart';
import { renderStatechartVisualizerHTML } from './output/statechart-html';
import { renderXStateConfig } from './output/xstate-config';
import {
  renderCoverageReport,
  summarizeCoverage,
} from './output/statechart-coverage';

/**
 * Run a statechart format (mermaid-statechart | svg-statechart | statechart-html | xstate-config).
 * These read `@typeonce/effect-machine` machines directly from source
 * (`Machine.make({...}).handle({...})`) — no Effect IR required.
 */
export const runStatechartMode = (
  resolvedPath: string,
  options: CLIOptions,
) =>
  Effect.gen(function* () {
    let files: string[];
    const stat = yield* cliTry(() => fs.stat(resolvedPath)).pipe(
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
      files = yield* cliTry(() => walk(resolvedPath, 0));
    } else {
      files = [resolvedPath];
    }

    const machines: StateMachine[] = [];
    for (const file of files) {
      // Unparseable files are skipped, not fatal.
      machines.push(
        ...(yield* Effect.try(() => analyzeStateMachines(file).machines).pipe(
          Effect.orElseSucceed(() => [] as readonly StateMachine[]),
        )),
      );
    }

    if (machines.length === 0) {
      const rejections = files.flatMap((file) => {
        try {
          return [...diagnoseStateMachines(file).rejected];
        } catch {
          return [];
        }
      });
      if (rejections.length === 0) {
        yield* Console.error(
          'No state machines found. See https://jagreehal.github.io/effect-analyzer/reference/state-machines/ for the Machine.make(...).handle(...) shape.',
        );
      } else {
        yield* Console.error(
          `No state machines found, but ${rejections.length} declaration${rejections.length === 1 ? '' : 's'} came close:`,
        );
        for (const r of rejections) {
          const loc = r.location
            ? ` ${basename(r.location.filePath)}:${r.location.line}`
            : '';
          yield* Console.error(`  • ${r.name} (${r.kind})${loc}`);
          yield* Console.error(`      ${r.reason}`);
          yield* Console.error(`      fix: ${r.hint}`);
        }
      }
      return;
    }

    const coverages: StateMachineCoverage[] = machines.map(
      computeStateMachineCoverage,
    );

    // Summary header to stderr so stdout (config/diagram) stays pipe-clean.
    if (!options.quiet) {
      yield* Console.error(
        `Found ${machines.length} state machine${machines.length === 1 ? '' : 's'}:`,
      );
      for (const m of machines) {
        const { states: stateCount, events: eventCount } = summarizeAlphabet(m);
        yield* Console.error(
          `  • ${m.name}: ${stateCount} state${stateCount === 1 ? '' : 's'}, ${eventCount} event${eventCount === 1 ? '' : 's'}` +
            (m.alphabetSource ? ` (${m.alphabetSource})` : ''),
        );
      }
    }

    let output: string;
    if (options.format === 'xstate-config') {
      output = machines.map(renderXStateConfig).join('\n\n');
    } else if (options.format === 'statechart-html') {
      output = renderStatechartVisualizerHTML(machines, coverages);
    } else if (options.format === 'svg-statechart') {
      output = renderStatechartHTML(
        machines.map((m, i) => renderStatechartSVG(m, coverages[i])),
      );
    } else if (options.format === 'statechart-coverage') {
      const summary = summarizeCoverage(coverages, options.minCoverage);
      output = options.coverageJson
        ? JSON.stringify({ machines: coverages, summary }, null, options.pretty ? 2 : undefined)
        : renderCoverageReport(coverages, { minCoverage: options.minCoverage });
      // Non-zero exit for CI on any warning or sub-threshold machine.
      if (!summary.passed) {
        yield* Effect.sync(() => {
          process.exitCode = 1;
        });
      }
    } else {
      output = renderStatechartsMermaid({ machines }, coverages);
    }

    // HTML formats are documents, not pipeable text: when no -o is given, write
    // a file next to the input and print its path rather than dumping markup.
    const isHtml =
      options.format === 'statechart-html' ||
      options.format === 'svg-statechart';
    const firstFile = files[0];
    const defaultHtmlPath =
      files.length === 1 && firstFile
        ? `${basename(firstFile).replace(/\.[^.]+$/, '')}.statechart.html`
        : 'effect-statecharts.html';
    const outputPath = options.output ?? (isHtml ? defaultHtmlPath : undefined);

    if (outputPath) {
      yield* cliTry(() => fs.writeFile(outputPath, output, 'utf-8'));
      yield* Console.log(
        isHtml ? `Statechart written to ${outputPath}` : `Output written to ${outputPath}`,
      );
      if (options.open && isHtml) {
        yield* Console.log(`Opening ${outputPath}…`);
        yield* openInBrowser(outputPath);
      }
    } else {
      yield* Console.log(output);
    }
  });
