/**
 * Single-file analysis: the default mode.
 *
 * Runs the analyzer over one file, renders the requested format, and writes
 * whatever side artefacts the flags ask for (colocated markdown, test stubs,
 * quality hints).
 */

/**
 * CLI entry point for effect-analyzer
 */

import './register-node-ts-morph';
import { resolve, join, dirname } from 'path';
import * as fs from 'node:fs/promises';
import { Effect, Console } from 'effect';
import { analyze } from './analyze';
import {
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
import { renderServicesMermaid } from './output/mermaid-services';
import { renderErrorsMermaid } from './output/mermaid-errors';
import { renderDecisionsMermaid } from './output/mermaid-decisions';
import { countMeaningfulNodes } from './analysis-utils';
import { renderCausesMermaid } from './output/mermaid-causes';
import { renderConcurrencyMermaid } from './output/mermaid-concurrency';
import { renderTimelineMermaid } from './output/mermaid-timeline';
import { renderLayersMermaid } from './output/mermaid-layers';
import { renderRetryMermaid } from './output/mermaid-retry';
import { renderTestabilityMermaid } from './output/mermaid-testability';
import { renderDataflowMermaid } from './output/mermaid-dataflow';
import {
  cliFail,
  cliTry,
  createStyle,
} from './cli-support';
import {
  type CLIOptions,
  type TestRunner,
} from './cli-options';
import { selectFormats } from './output/auto-format';
import { generatePaths } from './path-generator';
import { generateTestMatrix, formatTestMatrixAsCode } from './output/test-matrix';
import { renderJSON, renderMultipleJSON } from './output/json';
import { generateMultipleShowcase } from './output/showcase';
import { getCached, setCached } from './analysis-cache';
import { writeColocatedOutputForFile } from './output/colocate';
import { renderExplanation, renderMultipleExplanations } from './output/explain';
import { renderMultipleSummaries } from './output/summary';
import { renderDependencyMatrix } from './output/matrix';
import {
  extractProjectArchitecture,
  renderProjectArchitecture,
} from './project-architecture';
import {
  computeProgramDiagramQuality,
  type DiagramQualityHintInput,
} from './diagram-quality';
import { loadDiagramQualityHintsFromEslintJson } from './diagram-quality-eslint';
import {
  computeDiagramFidelity,
  formatDiagramFidelity,
} from './diagram-fidelity';

export const loadQualityHintsByFile = (
  options: CLIOptions,
  style: ReturnType<typeof createStyle>,
): Effect.Effect<Map<string, DiagramQualityHintInput>> =>
  Effect.gen(function* () {
    if (!options.quality || !options.qualityEslint) {
      return new Map<string, DiagramQualityHintInput>();
    }
    const eslintPath = resolve(options.qualityEslint);
    const hints = yield* cliTry(() =>
      loadDiagramQualityHintsFromEslintJson(eslintPath),
    ).pipe(
      Effect.catch((error) =>
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

export const buildProgramQualities = (
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

/** Sanitize a program name into a safe filename. */
export const sanitizeProgramName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_.-]/g, '_');

/**
 * Write a `{programName}.test.ts` stub next to `sourcePath` for each IR.
 * Skips files that already exist unless `overwrite` is true.
 */
export const writeTestStubsForFile = (
  sourcePath: string,
  irs: readonly StaticEffectIR[],
  testRunner: TestRunner,
  overwrite: boolean,
) =>
  Effect.gen(function* () {
    const results: { path: string; skipped: boolean }[] = [];
    const dir = dirname(sourcePath);
    const seen = new Set<string>();
    for (const ir of irs) {
      const name = sanitizeProgramName(ir.root.programName || 'program');
      let target = join(dir, `${name}.test.ts`);
      // Disambiguate if multiple programs share a name after sanitization
      let suffix = 2;
      while (seen.has(target)) {
        target = join(dir, `${name}.${String(suffix++)}.test.ts`);
      }
      seen.add(target);

      const exists = yield* cliTry(() => fs.access(target)).pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (exists && !overwrite) {
        results.push({ path: target, skipped: true });
        continue;
      }

      const paths = generatePaths(ir);
      const matrix = generateTestMatrix(paths);
      const code = formatTestMatrixAsCode(matrix, {
        testRunner,
        programName: ir.root.programName,
      });
      yield* cliTry(() => fs.writeFile(target, code, 'utf-8'));
      results.push({ path: target, skipped: false });
    }
    return results;
  });

export const runAnalysis = (
  resolvedPath: string,
  options: CLIOptions,
) =>
  Effect.gen(function* () {
    const style = createStyle(options.color && process.stdout.isTTY);

    // Every progress line goes through here so none can forget `--quiet`.
    // The counts used to ignore it while the line explaining them respected
    // it, which left `--quiet` reporting "Found 2 program(s)" above a single
    // diagram with nothing saying where the other one went.
    const logProgress = (message: string): Effect.Effect<void> =>
      options.quiet ? Effect.void : Console.log(message);

    const analyzerOptions =
      options.tsconfig !== undefined
        ? { tsConfigPath: options.tsconfig }
        : undefined;

    let irs: readonly import('./types').StaticEffectIR[];
    const useCache = options.cache && !resolvedPath.includes('*');
    if (useCache) {
      const content = yield* cliTry(() =>
        fs.readFile(resolvedPath, 'utf-8'),
      ).pipe(
        Effect.catch(() => Effect.succeed(null as string | null)),
      );
      if (content !== null) {
        const cached = yield* cliTry(() =>
          getCached(resolvedPath, content),
        ).pipe(Effect.catch(() => Effect.succeed(null)));
        if (cached !== null && cached.length > 0) {
          irs = cached;
          yield* logProgress(`(cache hit) Found ${String(irs.length)} program(s)`);
        } else {
          irs = yield* analyze(resolvedPath, analyzerOptions)
            .all
            .pipe(Effect.tapError((e) => Console.error(`Error: ${e.message}`)));
          yield* cliTry(() =>
            setCached(resolvedPath, content, irs),
          ).pipe(Effect.ignore);
          yield* logProgress(`Found ${String(irs.length)} program(s)`);
        }
      } else {
        irs = yield* analyze(resolvedPath, analyzerOptions)
          .all
          .pipe(Effect.tapError((e) => Console.error(`Error: ${e.message}`)));
        yield* logProgress(`Found ${String(irs.length)} program(s)`);
      }
    } else {
      irs = yield* analyze(resolvedPath, analyzerOptions)
        .all
        .pipe(Effect.tapError((error) => Console.error(`Error: ${error.message}`)));
      yield* logProgress(`Found ${String(irs.length)} program(s)`);
    }

    const minN = options.minMeaningfulNodes;
    let filteredIrs: readonly import('./types').StaticEffectIR[] =
      minN !== undefined ? irs.filter((ir) => countMeaningfulNodes(ir.root.children) >= minN) : irs;
    if (minN !== undefined && filteredIrs.length !== irs.length) {
      yield* logProgress(
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
      if (removed > 0) {
        yield* logProgress(`Filtered ${String(removed)} trivial program(s) (use --include-trivial to see all)`);
      }
    }

    if (options.assertDiagramFidelity) {
      const reports = filteredIrs.map((ir) => ({
        programName: ir.root.programName,
        report: computeDiagramFidelity(ir),
      }));
      for (const { programName, report } of reports) {
        yield* Console.log(`\n${programName}:\n${formatDiagramFidelity(report)}`);
      }
      if (reports.some(({ report }) => !report.exact)) {
        return yield* cliFail('Diagram fidelity assertion failed');
      }
    }

    const qualityHintsByFile = yield* loadQualityHintsByFile(options, style);
    const programQualities = options.quality
      ? buildProgramQualities(filteredIrs, qualityHintsByFile, options.styleGuide)
      : new Map<string, DiagramQuality>();

    if (options.test && filteredIrs.length > 0) {
      const results = yield* writeTestStubsForFile(
        resolvedPath,
        filteredIrs,
        options.testRunner,
        options.testOverwrite,
      );
      for (const r of results) {
        if (r.skipped) {
          yield* Console.log(style.dim(`  Test (skipped, exists): ${r.path}`));
        } else {
          yield* Console.log(style.green('  Test: ') + style.cyan(r.path));
        }
      }
    }

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
          for (const sel of formats) {
            const programLabel = filteredIrs.length > 1 ? ` [${ir.root.programName}]` : '';

            if (sel.format === 'explain') {
              const rendered = renderExplanation(ir);
              if (!seenContent.has(rendered)) {
                seenContent.add(rendered);
                diagrams.push(`%% explain${programLabel}\n${rendered}`);
              }
              continue;
            }

            // Build rendered output, respecting detail level if specified
            let rendered: string;
            if (sel.detail && sel.format === 'mermaid') {
              rendered = renderStaticMermaid(ir, { direction: options.direction, detail: sel.detail });
            } else {
              const renderer = autoRenderers[sel.format];
              if (!renderer) continue;
              rendered = renderer(ir);
            }

            // Skip empty/trivial diagrams
            if (rendered.includes('((No steps))') || rendered.includes('((No errors))') || rendered.includes('((No ')) continue;
            // Skip duplicate content
            if (seenContent.has(rendered)) continue;
            seenContent.add(rendered);
            diagrams.push(`%% ${sel.format}${programLabel}\n${rendered}`);
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
          const diagram = yield* renderMermaid(ir, {
            direction: options.direction,
            ...(options.detail ? { detail: options.detail } : {}),
          });
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
          enhancedDiagrams.push(renderEnhancedMermaid(ir, {
            direction: options.direction,
            ...(options.detail ? { detail: options.detail } : {}),
          }));
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
        const sourceCode = yield* cliTry(() =>
          fs.readFile(resolvedPath, 'utf-8'),
        ).pipe(Effect.catch(() => Effect.succeed('')));
        const showcaseEntries = generateMultipleShowcase(
          filteredIrs,
          { direction: options.direction },
          sourceCode,
        );
        const showcasePayload = showcaseEntries.length === 1 ? showcaseEntries[0] : showcaseEntries;
        output = JSON.stringify(showcasePayload, null, options.pretty ? 2 : undefined);
        break;
      }
      case 'architecture': {
        output = renderProjectArchitecture(
          extractProjectArchitecture([resolvedPath], { tsconfig: options.tsconfig }),
          dirname(resolvedPath),
        );
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
      yield* cliTry(() => fs.writeFile(outputPath, output, 'utf-8'));
      yield* Console.log(`Output written to ${outputPath}`);
    } else {
      yield* Console.log(output);
    }
  });
