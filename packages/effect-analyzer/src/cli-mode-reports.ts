/**
 * Reporting and catalogue modes.
 *
 * Each answers a single flag and returns; none of them go through the Effect IR
 * pipeline, which is why they sit apart from the analysis modes.
 */

/**
 * CLI entry point for effect-analyzer
 */

import './register-node-ts-morph';
import { resolve, join } from 'path';
import * as fs from 'node:fs/promises';
import { Effect, Console, DateTime } from 'effect';
import {
  buildSourceLinesMap,
  CliError,
  cliFail,
  cliTry,
  createStyle,
  extractBaselineFindings,
  writeAnalyzerOutput,
} from './cli-support';
import {
  type CLIOptions,
} from './cli-options';
import { analyzeProject } from './project-analyzer';
import {
  buildRuleIndex,
  explainRule,
  getRuleCodesForProfile,
  renderRuleDocsJson,
  renderRuleDocsText,
  searchRuleDocs,
} from './rule-registry';
import {
  buildLintScorecard,
  compareAgainstBaseline,
  exitCodeFor,
  runSourceLintScan,
  toSarif,
  type LintFinding,
} from './lint-session';
import {
  buildAgentReport,
  renderAgentReportJson,
  renderAgentReportMarkdown,
  renderAgentReportSummary,
} from './agent-report';
import {
  analyzeErrorChannels,
  renderErrorChannelReport,
  renderErrorChannelJson,
} from './error-channel';
import {
  analyzeServiceHealth,
  buildServiceRegistry,
  renderServiceHealthReport,
  renderServiceHealthJson,
} from './service-health';
import {
  analyzePerformance,
  renderPerformanceReport,
  renderPerformanceJson,
} from './performance-antipatterns';
import {
  analyzeCoupling,
  renderCouplingReport,
  renderCouplingJson,
} from './coupling-analysis';
import {
  generateImprovePlan,
  applyFixes,
  renderImprovePlan,
  renderImproveResult,
} from './improve-mode';

/**
 * Source-lint mode: scan a tree for Effect lint findings, optionally against a
 * baseline and with a scorecard.
 */
export const runLintSourceMode = (
  pathArg: string | undefined,
  options: CLIOptions,
): Effect.Effect<void, CliError> =>
  Effect.gen(function* () {
    const targetPath = resolve(pathArg ?? '.');
    const scan = yield* cliTry(() => runSourceLintScan(targetPath, { tsgoProject: options.tsgoProject }));
    const scorecard = options.scorecard ? buildLintScorecard(scan.findings) : undefined;
    const timestamp = DateTime.formatIso(yield* DateTime.now);
    let baselineSummary:
      | {
          readonly new: number;
          readonly resolved: number;
          readonly unchanged: number;
        }
      | undefined;
    let newFindings: readonly LintFinding[] = [];

    if (options.baseline) {
      const baselinePath = resolve(options.baseline);
      const baselineRaw = yield* cliTry(() => fs.readFile(baselinePath, 'utf-8')).pipe(
        Effect.catch(() =>
          cliFail(`Failed to read baseline file: ${baselinePath}`),
        ),
      );
      const baselineJson = yield* Effect.try({
        try: () => JSON.parse(baselineRaw) as unknown,
        catch: (cause) => new CliError({ message: `Baseline is not valid JSON: ${baselinePath}`, cause }),
      });
      const baselineFindings = extractBaselineFindings(baselineJson);
      const delta = compareAgainstBaseline(scan.findings, baselineFindings);
      baselineSummary = {
        new: delta.newFindings.length,
        resolved: delta.resolvedFindings.length,
        unchanged: delta.unchangedFindings.length,
      };
      newFindings = delta.newFindings;
    }

    const dataPayload = options.sarif ? toSarif(scan.findings) : scan.findings;
    const envelope = {
      meta: {
        generatedAt: timestamp,
        command: options.sarif ? 'lint-source-sarif' : 'lint-source',
      },
      options: {
        path: targetPath,
        sarif: options.sarif,
        scorecard: options.scorecard,
        baseline: options.baseline,
        failOnNew: options.failOnNew,
      },
      summary: {
        filesScanned: scan.filesScanned,
        findings: scan.findings.length,
        staleSuppressions: scan.staleSuppressions.length,
        suppressionsMissingReason: scan.suppressionsMissingReason.length,
        baseline: baselineSummary,
        tsgo: scan.tsgo,
      },
      data: dataPayload,
      findings: scan.findings,
      scorecard,
      staleSuppressions: scan.staleSuppressions,
      suppressionsMissingReason: scan.suppressionsMissingReason,
      newFindings,
    };

    if (options.bundleOutput) {
      const outDir = resolve(options.bundleOutput);
      const sarifPayload = toSarif(scan.findings);
      const summaryLines = [
        '# effect-analyzer lint bundle',
        '',
        `- generatedAt: ${timestamp}`,
        `- path: ${targetPath}`,
        `- filesScanned: ${String(scan.filesScanned)}`,
        `- findings: ${String(scan.findings.length)}`,
        scorecard ? `- scorecardRows: ${String(scorecard.length)}` : '- scorecardRows: none',
        `- staleSuppressions: ${String(scan.staleSuppressions.length)}`,
        `- suppressionsMissingReason: ${String(scan.suppressionsMissingReason.length)}`,
        baselineSummary
          ? `- baseline: new=${String(baselineSummary.new)} resolved=${String(baselineSummary.resolved)} unchanged=${String(baselineSummary.unchanged)}`
          : '- baseline: none',
        '',
      ];
      yield* cliTry(() => fs.mkdir(outDir, { recursive: true }));
      yield* cliTry(() =>
        Promise.all([
          fs.writeFile(join(outDir, 'diagnostics.json'), JSON.stringify(scan.findings, null, 2), 'utf-8'),
          fs.writeFile(join(outDir, 'diagnostics.sarif'), JSON.stringify(sarifPayload, null, 2), 'utf-8'),
          fs.writeFile(join(outDir, 'summary.md'), summaryLines.join('\n'), 'utf-8'),
          fs.writeFile(join(outDir, 'rule-index.json'), JSON.stringify(buildRuleIndex(), null, 2), 'utf-8'),
          fs.writeFile(join(outDir, 'session.json'), JSON.stringify(envelope, null, 2), 'utf-8'),
        ]),
      );
    }

    if (options.output) {
      yield* cliTry(() =>
        fs.writeFile(resolve(options.output!), JSON.stringify(options.sarif ? dataPayload : envelope, null, options.pretty ? 2 : 0), 'utf-8'),
      );
    } else {
      yield* Console.log(JSON.stringify(options.sarif ? dataPayload : envelope, null, options.pretty ? 2 : 0));
    }

    if (options.exportSession) {
      yield* cliTry(() =>
        fs.writeFile(resolve(options.exportSession!), JSON.stringify(envelope, null, 2), 'utf-8'),
      );
    }

    if (exitCodeFor(scan.findings, options.failOn) === 1) {
      const gated = scan.findings.filter(
        (f) => exitCodeFor([f], options.failOn) === 1,
      );
      return yield* cliFail(
        `Findings at or above ${String(options.failOn)}: ${String(gated.length)}`,
      );
    }
    if (options.failOnNew && baselineSummary && baselineSummary.new > 0) {
      return yield* cliFail(`New findings detected: ${String(baselineSummary.new)}`);
    }
    if (options.failOnStaleSuppressions && scan.staleSuppressions.length > 0) {
      return yield* cliFail(
        `Stale suppressions detected: ${String(scan.staleSuppressions.length)}`,
      );
    }
    if (options.requireSuppressionReason && scan.suppressionsMissingReason.length > 0) {
      return yield* cliFail(
        `Suppressions missing reason: ${String(scan.suppressionsMissingReason.length)} (use: effect-analyzer-disable-next-line <rule> <reason>)`,
      );
    }
  });


/**
 * Agent-facing reports: agent report, error channel, service health,
 * performance, coupling, and the improve plan. One flag each, one shared walk.
 */
export const runReportsMode = (
  pathArg: string | undefined,
  options: CLIOptions,
): Effect.Effect<void, CliError> =>
  Effect.gen(function* () {
    const targetPath = resolve(pathArg ?? '.');
    const style = createStyle(options.color);

    if (!options.quiet) {
      yield* Console.log(`\n${style.bold(style.cyan('Analyzing'))} ${targetPath} for agent report...\n`);
    }

    // Run lint scan
    const scan = yield* cliTry(() => runSourceLintScan(targetPath, { tsgoProject: options.tsgoProject }));

    // Analyze project to get IRs
    const projectResult = yield* analyzeProject(targetPath, {
      tsconfig: options.tsconfig,
      knownEffectInternalsRoot: options.knownEffectInternalsRoot,
    });

    const irs = projectResult.allPrograms;

    // Build source lines map for fix generation
    const sourceLinesMap = yield* buildSourceLinesMap(projectResult.byFile.keys());

    const coverageAudit = {
      discovered: projectResult.fileCount,
      analyzed: projectResult.byFile.size,
      unknownNodeRate: 0, // Would need deeper analysis to compute
    };

    // Run specialized analyses
    const errorChannelAnalysis = options.errorChannel ? analyzeErrorChannels(irs) : undefined;
    const serviceRegistry = options.serviceHealth || options.agentReport ? buildServiceRegistry(irs, new Map()) : undefined;
    const serviceHealthAnalysis = serviceRegistry ? analyzeServiceHealth(serviceRegistry, irs) : undefined;
    const performanceAnalysis = options.performance ? analyzePerformance(irs) : undefined;
    const couplingAnalysis = (options.coupling || options.agentReport)
      ? analyzeCoupling([...projectResult.byFile.keys()], targetPath, {
          tsconfig: options.tsconfig,
          transitive: options.couplingTransitive,
        })
      : undefined;

    const report = buildAgentReport({
      findings: scan.findings,
      irs,
      coverageAudit,
      errorChannelIssues: errorChannelAnalysis?.issues,
      serviceHealthIssues: serviceHealthAnalysis?.issues,
      performanceIssues: performanceAnalysis?.issues,
      couplingIssues: couplingAnalysis?.issues,
      couplingPriorityMap: options.couplingPriority,
    });

    if (options.improve) {
      const plan = generateImprovePlan(report, scan.findings, sourceLinesMap, {
        dryRun: options.improveDryRun,
        maxFixes: options.improveMaxFixes,
        rules: options.improveRules,
        excludeRules: options.improveExcludeRules,
        minPriority: options.improveMinPriority,
      });

      if (options.output) {
        yield* cliTry(() =>
          fs.writeFile(resolve(options.output!), renderImprovePlan(plan), 'utf-8'),
        );
      } else {
        yield* Console.log(renderImprovePlan(plan));
      }

      if (!options.improveDryRun) {
        const result = yield* cliTry(() => applyFixes(plan.fixes, { dryRun: false }));
        yield* Console.log('\n' + renderImproveResult(result));
      }
    } else if (options.agentReport) {
      if (options.output) {
        const output = options.output.endsWith('.json')
          ? renderAgentReportJson(report)
          : renderAgentReportMarkdown(report);
        yield* cliTry(() => fs.writeFile(resolve(options.output!), output, 'utf-8'));
      } else {
        yield* Console.log(renderAgentReportSummary(report));
        yield* Console.log('\n' + renderAgentReportMarkdown(report));
      }
    } else if (options.errorChannel && errorChannelAnalysis) {
      yield* writeAnalyzerOutput(errorChannelAnalysis, options, {
        json: renderErrorChannelJson,
        markdown: renderErrorChannelReport,
      });
    } else if (options.serviceHealth && serviceHealthAnalysis) {
      yield* writeAnalyzerOutput(serviceHealthAnalysis, options, {
        json: renderServiceHealthJson,
        markdown: renderServiceHealthReport,
      });
    } else if (options.performance && performanceAnalysis) {
      yield* writeAnalyzerOutput(performanceAnalysis, options, {
        json: renderPerformanceJson,
        markdown: renderPerformanceReport,
      });
    } else if (options.coupling && couplingAnalysis) {
      yield* writeAnalyzerOutput(couplingAnalysis, options, {
        json: renderCouplingJson,
        markdown: renderCouplingReport,
      });
    }

  });


/**
 * Rule catalogue: list, index, search, and explain the analyzer's own rules.
 */
export const runRulesMode = (
  pathArg: string | undefined,
  options: CLIOptions,
): Effect.Effect<void, CliError> =>
  Effect.gen(function* () {
  const profileCodes = options.profile ? new Set(getRuleCodesForProfile(options.profile)) : undefined;
  const profileFilter = <T extends { code: string }>(entries: readonly T[]): readonly T[] =>
    profileCodes ? entries.filter((x) => profileCodes.has(x.code)) : entries;
    let payload: unknown;
    if (options.listRules) {
      const docsJson = JSON.parse(renderRuleDocsJson(true)) as { code: string }[];
      payload = profileFilter(docsJson);
    } else if (options.indexRules) {
      payload = profileFilter(buildRuleIndex());
    } else if (options.searchRules) {
      payload = profileFilter(searchRuleDocs(options.searchRules).map((x) => x.doc));
    } else {
      const explained = options.explainRule ? explainRule(options.explainRule) : undefined;
      payload = explained ? [explained] : [];
    }
    const envelope = {
      meta: {
        generatedAt: DateTime.formatIso(yield* DateTime.now),
        command: options.listRules
          ? 'list-rules'
          : options.indexRules
            ? 'index-rules'
            : options.searchRules
              ? 'search-rules'
              : 'explain-rule',
      },
      options: {
        format: options.format,
        pretty: options.pretty,
        profile: options.profile,
        query: options.searchRules,
        rule: options.explainRule,
      },
      data: payload,
      summary: {
        count: Array.isArray(payload) ? payload.length : payload ? 1 : 0,
      },
    };
    if (options.exportSession) {
      yield* cliTry(() =>
        fs.writeFile(resolve(options.exportSession!), JSON.stringify(envelope, null, 2), 'utf-8'),
      );
    }
    if (options.format === 'json') {
      yield* Console.log(JSON.stringify(envelope, null, options.pretty ? 2 : 0));
    } else if (options.listRules && !options.profile && !options.searchRules && !options.explainRule && !options.indexRules) {
      yield* Console.log(renderRuleDocsText());
    } else {
      yield* Console.log(JSON.stringify(envelope, null, 2));
    }
  });
