/**
 * Project mode: analyze a directory.
 *
 * Walks the tree, analyzes every file that contains Effect programs, writes a
 * colocated markdown doc beside each, and reports the coverage audit.
 */

/**
 * CLI entry point for effect-analyzer
 */

import './register-node-ts-morph';
import {
  buildProgramQualities,
  loadQualityHintsByFile,
  writeTestStubsForFile,
} from './cli-mode-analysis';
import { resolve, join } from 'path';
import * as fs from 'node:fs/promises';
import { Project } from 'ts-morph';
import { Effect, Console, DateTime } from 'effect';
import {
  type DiagramQuality,
} from './types';
import { renderServicesMermaid, renderServicesMermaidFromMap } from './output/mermaid-services';
import {
  cliFail,
  cliTry,
  createStyle,
} from './cli-support';
import {
  type CLIOptions,
} from './cli-options';
import { runCoverageAudit, analyzeProject } from './project-analyzer';
import { evaluateAuditPolicy, type AuditPolicy } from './audit-policy';
import { renderCoverageReport as renderProjectCoverageReport } from './output/coverage-report';
import { writeColocatedOutputForFile, writeAllServiceArtifacts } from './output/colocate';
import { renderMultipleExplanations } from './output/explain';
import { renderMultipleSummaries } from './output/summary';
import { renderDependencyMatrix, renderDependencyMatrixFromServiceMap } from './output/matrix';
import { renderServiceGraphMermaid } from './output/mermaid';
import { renderApiDocsMarkdown } from './output/api-docs';
import { extractHttpApiStructure, type HttpApiStructure } from './http-api-extractor';
import {
  renderProjectArchitecture,
} from './project-architecture';
import {
  computeFileDiagramQuality,
  buildTopOffendersReport,
} from './diagram-quality';
import {
  computeDiagramFidelity,
  formatDiagramFidelity,
} from './diagram-fidelity';

/** Format and print coverage audit result; optionally write JSON to output path. */
export const runCoverageAuditCli = (
  resolvedPath: string,
  options: CLIOptions,
) =>
  Effect.gen(function* () {
    const audit = yield* runCoverageAudit(resolvedPath, {
      tsconfig: options.tsconfig,
      includePerFileTiming: options.perFileTiming,
      excludeFromSuspiciousZeros: options.excludeFromSuspiciousZeros,
      knownEffectInternalsRoot: options.knownEffectInternalsRoot,
    });
    const policy: AuditPolicy = {
      maxFailedFiles: options.maxAuditFailedFiles,
      maxSuspiciousZeros: options.maxAuditSuspiciousZeros,
      minEffectAdoption: options.minAuditEffectAdoption,
      minSourceResolution: options.minAuditSourceResolution,
    };
    const hasPolicy = Object.values(policy).some((value) => value !== undefined);
    const decision = hasPolicy
      ? evaluateAuditPolicy({
          assessment: audit.assessment,
          failedFiles: audit.failed,
          suspiciousZeros: audit.suspiciousZeros.length,
        }, policy)
      : undefined;
    const timestamp = DateTime.formatIso(yield* DateTime.now);
    const render = (mode: 'human' | 'quiet' | 'json') => renderProjectCoverageReport(audit, {
      mode,
      root: resolvedPath,
      decision,
      pretty: options.pretty,
      showSuspiciousZeros: options.showSuspiciousZeros,
      showTopUnknown: options.showTopUnknown,
      showTopUnknownReasons: options.showTopUnknownReasons,
      showByFolder: options.showOkZeroFailByFolder,
      timestamp,
    });

    yield* Console.log(render(options.jsonSummary ? 'json' : options.quiet ? 'quiet' : 'human'));

    const outputPath = options.output;
    if (outputPath) {
      yield* cliTry(() => fs.writeFile(outputPath, render('json'), 'utf-8'));
      if (!options.quiet && !options.jsonSummary) {
        yield* Console.log(`Audit written to ${outputPath}`);
      }
    }
    if (decision?.passed === false) {
      process.exitCode = 1;
    }
  });

/** Project mode: analyze directory, write colocated .md per file with Effect programs (gold tier). */
export const runProjectMode = (
  resolvedPath: string,
  options: CLIOptions,
) =>
  Effect.gen(function* () {
    const useColor = options.color && process.stdout.isTTY;
    const style = createStyle(useColor);

    if (!options.quiet) {
      yield* Console.log(style.bold(`Analyzing ${resolvedPath}...`));
    }

    const projectResult = yield* analyzeProject(resolvedPath, {
      tsconfig: options.tsconfig,
      knownEffectInternalsRoot: options.knownEffectInternalsRoot,
      buildServiceMap: options.serviceMap,
      buildArchitecture: true,
    });

    const sortedEntries = [...projectResult.byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const start = Math.max(0, options.cursor);
    const end = options.maxFiles ? start + options.maxFiles : sortedEntries.length;
    const windowedEntries = sortedEntries.slice(start, Math.min(end, sortedEntries.length));
    const byFile = new Map(windowedEntries);
    if (options.assertDiagramFidelity) {
      let hasInexactDiagram = false;
      for (const [filePath, programs] of byFile) {
        for (const ir of programs) {
          const report = computeDiagramFidelity(ir);
          yield* Console.log(
            `\n${filePath} :: ${ir.root.programName}:\n${formatDiagramFidelity(report)}`,
          );
          hasInexactDiagram ||= !report.exact;
        }
      }
      if (hasInexactDiagram) {
        return yield* cliFail('Diagram fidelity assertion failed');
      }
    }
    const qualityHintsByFile = yield* loadQualityHintsByFile(options, style);
    const fileQualities = options.quality
      ? [...byFile.entries()].map(([filePath, programs]) =>
          computeFileDiagramQuality(filePath, programs, {
            styleGuideSummary: options.styleGuide,
            hints: qualityHintsByFile.get(resolve(filePath)),
          }),
        )
      : [];
    const programQualityByFile = new Map<string, Map<string, DiagramQuality>>();
    if (options.quality) {
      for (const [filePath, programs] of byFile) {
        const fileHint = qualityHintsByFile.get(resolve(filePath));
        const programQualities = buildProgramQualities(
          programs,
          new Map(fileHint ? [[resolve(filePath), fileHint]] : []),
          options.styleGuide,
        );
        programQualityByFile.set(filePath, programQualities);
      }
    }
    const fileCount = byFile.size;
    const nextCursor = start + fileCount < sortedEntries.length ? start + fileCount : null;
    const doColocate = !options.noColocate;
    const architecture = projectResult.architecture;
    const hasArchitecture = (architecture?.runtimes.length ?? 0) > 0;
    if (fileCount === 0) {
      if (doColocate && hasArchitecture) {
        const architecturePath = join(resolvedPath, 'architecture.md');
        const architectureContent = renderProjectArchitecture(
          architecture!,
          resolvedPath,
        );
        yield* cliTry(() => fs.writeFile(architecturePath, architectureContent, 'utf-8')).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        );
        if (!options.quiet) {
          yield* Console.log(
            style.green('  Architecture: ') + style.cyan(architecturePath),
          );
        }
      }
      if (options.format === 'architecture' && hasArchitecture) {
        yield* Console.log('\n' + renderProjectArchitecture(architecture!, resolvedPath));
      } else {
        yield* Console.log(
          style.yellow('No Effect programs found in discovered TypeScript files.'),
        );
      }
      if (hasArchitecture) {
        yield* Console.log(
          style.dim(
            `Detected ${String(architecture!.runtimes.length)} runtime architecture entr${architecture!.runtimes.length === 1 ? 'y' : 'ies'}.`,
          ),
        );
      }
      return;
    }

    if (!options.quiet && (options.cursor > 0 || options.maxFiles !== undefined)) {
      yield* Console.log(
        style.dim(
          `Window mode: cursor=${options.cursor}, maxFiles=${options.maxFiles ?? 'all'}, filesInWindow=${fileCount}, nextCursor=${nextCursor ?? 'none'}`,
        ),
      );
    }

    let written = 0;
    if (doColocate) {
      for (const [filePath, programs] of byFile) {
        const outputPath = yield* writeColocatedOutputForFile(
          filePath,
          programs,
          options.colocateSuffix,
          options.direction,
          options.colocateEnhanced,
          programQualityByFile.get(filePath),
          options.styleGuide,
        );
        written++;
        if (!options.quiet) {
          yield* Console.log(
            style.green('  Written: ') + style.cyan(outputPath),
          );
        }
      }
    }

    if (options.test) {
      for (const [filePath, programs] of byFile) {
        const results = yield* writeTestStubsForFile(
          filePath,
          programs,
          options.testRunner,
          options.testOverwrite,
        );
        if (!options.quiet) {
          for (const r of results) {
            if (r.skipped) {
              yield* Console.log(style.dim(`  Test (skipped, exists): ${r.path}`));
            } else {
              yield* Console.log(style.green('  Test: ') + style.cyan(r.path));
            }
          }
        }
      }
    }

    // Write service artifacts if --service-map is enabled
    if (options.serviceMap && projectResult.serviceMap) {
      const svcMap = projectResult.serviceMap;
      const serviceCount = svcMap.services.size;
      if (serviceCount > 0) {
        if (doColocate) {
          const servicePaths = yield* writeAllServiceArtifacts(svcMap).pipe(
            Effect.catch(() => Effect.succeed([] as string[])),
          );
          for (const sp of servicePaths) {
            if (!options.quiet) {
              yield* Console.log(
                style.green('  Service: ') + style.cyan(sp),
              );
            }
          }

          // Write project-level service graph (only when colocating)
          const graphMd = renderServiceGraphMermaid(svcMap, { direction: options.direction });
          const graphPath = join(resolvedPath, 'service-graph.md');
          const graphContent = `# Service Dependency Graph\n\n\`\`\`mermaid\n${graphMd}\n\`\`\`\n`;
          yield* cliTry(() => fs.writeFile(graphPath, graphContent, 'utf-8')).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          );
          if (!options.quiet) {
            yield* Console.log(
              style.green('  Service graph: ') + style.cyan(graphPath),
            );
          }
        }

        yield* Console.log(
          style.green(
            `Found ${String(serviceCount)} service(s)${svcMap.unresolvedServices.length > 0 ? `, ${String(svcMap.unresolvedServices.length)} unresolved` : ''}.`,
          ),
        );
      }
    }

    // Write API docs if HttpApi structure found (when colocating)
    if (doColocate) {
      const apiStructures = yield* cliTry(() => {
        const project = options.tsconfig
          ? new Project({ tsConfigFilePath: options.tsconfig })
          : new Project({ skipAddingFilesFromTsConfig: true });
        const allStructures: HttpApiStructure[] = [];
        for (const filePath of byFile.keys()) {
          try {
            const sf = project.addSourceFileAtPath(filePath);
            allStructures.push(...extractHttpApiStructure(sf, filePath));
          } catch {
            // skip
          }
        }
        return Promise.resolve(allStructures);
      }).pipe(Effect.catch(() => Effect.succeed([] as HttpApiStructure[])));
      if (apiStructures.length > 0) {
        const apiDocsPath = join(resolvedPath, 'api-docs.md');
        const apiDocsContent = renderApiDocsMarkdown(apiStructures);
        yield* cliTry(() => fs.writeFile(apiDocsPath, apiDocsContent, 'utf-8')).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        );
        if (!options.quiet) {
          yield* Console.log(
            style.green('  API docs: ') + style.cyan(apiDocsPath),
          );
        }
      }
    }

    if (doColocate && architecture && architecture.runtimes.length > 0) {
      const architecturePath = join(resolvedPath, 'architecture.md');
      const architectureContent = renderProjectArchitecture(
        architecture,
        resolvedPath,
      );
      yield* cliTry(() => fs.writeFile(architecturePath, architectureContent, 'utf-8')).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );
      if (!options.quiet) {
        yield* Console.log(
          style.green('  Architecture: ') + style.cyan(architecturePath),
        );
      }
    }

    // Format-specific project output
    if (options.format === 'matrix') {
      const matrixOutput = options.serviceMap && projectResult.serviceMap
        ? renderDependencyMatrixFromServiceMap(projectResult.serviceMap)
        : renderDependencyMatrix(projectResult.allPrograms);
      yield* Console.log('\n' + matrixOutput);
    } else if (options.format === 'mermaid-services') {
      const svcDir = options.direction === 'TB' ? 'LR' : options.direction;
      const svcOutput = options.serviceMap && projectResult.serviceMap
        ? renderServicesMermaidFromMap(projectResult.serviceMap, { direction: svcDir })
        : projectResult.allPrograms.map(ir => renderServicesMermaid(ir, { direction: svcDir })).join('\n\n---\n\n');
      yield* Console.log('\n' + svcOutput);
    } else if (options.format === 'explain') {
      yield* Console.log('\n' + renderMultipleExplanations(projectResult.allPrograms));
    } else if (options.format === 'summary') {
      yield* Console.log('\n' + renderMultipleSummaries(projectResult.allPrograms));
    } else if (options.format === 'architecture') {
      yield* Console.log(
        '\n' + renderProjectArchitecture(architecture ?? { runtimes: [], commandDefinitions: [], layerAssemblies: [], filesScanned: 0 }, resolvedPath),
      );
    }

    const totalPrograms = projectResult.allPrograms.length;
    const summary = doColocate
      ? style.green(
          `Analyzed ${String(fileCount)} file(s) with Effect programs, wrote ${String(written)} colocated .${options.colocateSuffix}.md file(s) (${String(totalPrograms)} program(s) total).`,
        )
      : style.dim(
          `Analyzed ${String(fileCount)} file(s), ${String(totalPrograms)} program(s). Use without --no-colocate to write .${options.colocateSuffix}.md files.`,
        );
    yield* Console.log(summary);

    if (options.quality && fileQualities.length > 0) {
      const offenders = buildTopOffendersReport(fileQualities, 10);
      const formatMetric = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
      const printBucket = (
        title: string,
        entries: readonly { filePath: string; metricValue: number; tip: string }[],
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Console.log(`\n${style.bold(title)}`);
          for (const entry of entries) {
            yield* Console.log(`  ${entry.filePath}  (${formatMetric(entry.metricValue)})`);
            yield* Console.log(`    ${style.dim(entry.tip)}`);
          }
        });

      yield* printBucket('Top offenders: largest programs', offenders.largestPrograms);
      yield* printBucket('Top offenders: most anonymous nodes', offenders.mostAnonymousNodes);
      yield* printBucket('Top offenders: most unknown nodes', offenders.mostUnknownNodes);
      yield* printBucket('Top offenders: highest log ratio', offenders.highestLogRatio);
    }
  });
