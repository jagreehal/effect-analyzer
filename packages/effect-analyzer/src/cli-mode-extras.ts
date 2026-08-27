/**
 * Modes that sit beside the main analysis: semantic diff between two versions,
 * the migration assistant, and the opt-in extra analyzers.
 */

/**
 * CLI entry point for effect-analyzer
 */

import './register-node-ts-morph';
import * as fs from 'node:fs/promises';
import { Effect, Console, Option } from 'effect';
import { analyzeEffectSource, analyzeEffectFile } from './static-analyzer';
import {
  CliError,
  cliFail,
  cliTry,
} from './cli-support';
import {
  type CLIOptions,
} from './cli-options';
import { diffPrograms, renderDiffMarkdown, renderDiffJSON, renderDiffMermaid, parseSourceArg, resolveGitSource, resolveGitHubPR } from './diff';
import {
  findMigrationOpportunities,
  findMigrationOpportunitiesInProject,
  formatMigrationReport,
} from './migration-assistant';

/** Diff mode: compare two versions of Effect programs and render the diff. */
export const runDiffMode = (
  options: CLIOptions,
) =>
  Effect.gen(function* () {
    const sources = options.diffSources;

    if (sources.length === 0) {
      yield* Console.error('--diff requires at least one source argument');
      return;
    }

    const resolveSource = (arg: ReturnType<typeof parseSourceArg>) => {
      if (arg.kind === 'git-ref' && arg.ref && arg.filePath) {
        const { ref, filePath: fp } = arg;
        return Effect.gen(function* () {
          const src = yield* Effect.try(() => resolveGitSource(ref, fp));
          return yield* analyzeEffectSource(src, fp);
        });
      }
      if (arg.kind === 'github-pr' && arg.prUrl) {
        const { prUrl } = arg;
        return Effect.gen(function* () {
          yield* Console.error('GitHub PR diff requires two resolved refs. Use: --diff <base-ref>:<path> <head-ref>:<path>');
          yield* Console.error(`To resolve PR refs: gh pr view "${prUrl}" --json baseRefName,headRefName`);
          return [] as readonly import('./types').StaticEffectIR[];
        });
      }
      if (!arg.filePath) {
        return Effect.gen(function* () {
          yield* Console.error(`Cannot resolve source: ${JSON.stringify(arg)}`);
          return [] as readonly import('./types').StaticEffectIR[];
        });
      }
      return analyzeEffectFile(arg.filePath);
    };

    let beforeIRs: readonly import('./types').StaticEffectIR[];
    let afterIRs: readonly import('./types').StaticEffectIR[];

    // Check for GitHub PR URL — resolve both sides automatically
    const firstSource = sources[0];
    if (!firstSource) {
      yield* Console.error('No sources specified for diff');
      return;
    }
    const firstParsed = parseSourceArg(firstSource);
    if (firstParsed.kind === 'github-pr' && firstParsed.prUrl) {
      const prUrl = firstParsed.prUrl;
      const prInfo = yield* Effect.try(() => resolveGitHubPR(prUrl));
      // For PR diffs, we need a specific file path
      if (sources.length < 2) {
        yield* Console.error('GitHub PR diff requires a file path: --diff <pr-url> <file-path>');
        return;
      }
      const filePath = sources[1] ?? '';
      const baseSrc = yield* Effect.try(() => resolveGitSource(prInfo.baseRef, filePath));
      const headSrc = yield* Effect.try(() => resolveGitSource(prInfo.headRef, filePath));
      beforeIRs = yield* analyzeEffectSource(baseSrc, filePath);
      afterIRs = yield* analyzeEffectSource(headSrc, filePath);
    } else if (sources.length === 1) {
      // Single source: compare HEAD vs working copy
      const filePath = firstSource;
      const headSrc = yield* Effect.try(() => resolveGitSource('HEAD', filePath));
      beforeIRs = yield* analyzeEffectSource(headSrc, filePath);
      afterIRs = yield* analyzeEffectFile(filePath);
    } else {
      beforeIRs = yield* resolveSource(parseSourceArg(firstSource));
      afterIRs = yield* resolveSource(parseSourceArg(sources[1] ?? ''));
    }

    // Match programs by name and diff each pair
    const sections: string[] = [];
    const matchedBeforeNames = new Set<string>();

    for (const afterIR of afterIRs) {
      const beforeIR = beforeIRs.find(b => b.root.programName === afterIR.root.programName);

      if (beforeIR) {
        matchedBeforeNames.add(beforeIR.root.programName);
        const diff = diffPrograms(beforeIR, afterIR, {
          regressionMode: options.regression,
        });

        if (options.format === 'json') {
          sections.push(renderDiffJSON(diff, { pretty: options.pretty }));
        } else if (options.format === 'mermaid' || options.format === 'mermaid-enhanced') {
          sections.push(`%% diff: ${afterIR.root.programName}\n${renderDiffMermaid(afterIR, diff, { direction: options.direction })}`);
        } else {
          sections.push(renderDiffMarkdown(diff));
        }
      } else {
        // Program only in after — wholly added
        const addedSteps = afterIR.root.children.map(c => {
          const callee = c.type === 'effect' ? (c as { callee?: string }).callee : c.displayName ?? c.name ?? c.type;
          return callee ?? c.type;
        });
        if (options.format === 'json') {
          sections.push(JSON.stringify({ added: afterIR.root.programName, steps: addedSteps }));
        } else {
          sections.push(`## Added program: \`${afterIR.root.programName}\`\n\nSteps: ${addedSteps.map(s => `\`${s}\``).join(', ')}`);
        }
      }
    }

    // Programs only in before — wholly removed
    for (const beforeIR of beforeIRs) {
      if (!matchedBeforeNames.has(beforeIR.root.programName)) {
        const removedSteps = beforeIR.root.children.map(c => {
          const callee = c.type === 'effect' ? (c as { callee?: string }).callee : c.displayName ?? c.name ?? c.type;
          return callee ?? c.type;
        });
        if (options.format === 'json') {
          sections.push(JSON.stringify({ removed: beforeIR.root.programName, steps: removedSteps }));
        } else {
          const warning = options.regression ? '⚠️ ' : '';
          sections.push(`## ${warning}Removed program: \`${beforeIR.root.programName}\`\n\nSteps: ${removedSteps.map(s => `\`${s}\``).join(', ')}`);
        }
      }
    }

    // Use \n\n for Mermaid (splitDiagrams in MermaidDiagram.tsx handles multi-diagram),
    // --- for markdown (valid markdown HR), JSON array for json
    const isMermaid = options.format === 'mermaid' || options.format === 'mermaid-enhanced';
    const separator = options.format === 'json' ? ',\n' : isMermaid ? '\n\n' : '\n\n---\n\n';
    const output = options.format === 'json'
      ? `[${sections.join(separator)}]`
      : sections.join(separator);
    if (options.output) {
      const outputPath = options.output;
      yield* cliTry(() => fs.writeFile(outputPath, output, 'utf-8'));
      yield* Console.log(`Diff output written to ${outputPath}`);
    } else {
      yield* Console.log(output);
    }
  });

export const runMigration = (resolvedPath: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const s = yield* cliTry(() => fs.stat(resolvedPath)).pipe(
      Effect.option,
    );
    const isDir = Option.isSome(s) && s.value.isDirectory();
    if (isDir) {
      const report = yield* cliTry(() =>
        findMigrationOpportunitiesInProject(resolvedPath),
      ).pipe(
        Effect.catch((e) =>
          cliFail(e instanceof Error ? e.message : String(e), e),
        ),
      );
      yield* Effect.sync(() => {
        process.stdout.write(formatMigrationReport(report) + '\n');
      });
    } else {
      const opportunities = yield* Effect.try({
        try: () => findMigrationOpportunities(resolvedPath),
        catch: (cause) =>
          new CliError({ message: cause instanceof Error ? cause.message : String(cause), cause }),
      });
      yield* Effect.sync(() => {
        process.stdout.write(
          formatMigrationReport({ opportunities, fileCount: 1 }) + '\n',
        );
      });
    }
  }).pipe(
    Effect.catch((e) =>
      Console.error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`),
    ),
  );

import { analyzeEntryPointsFile } from './entry-points';
import { analyzeConfigSensitivityFile } from './config-sensitivity';
import { analyzeCliCommandsFile } from './cli-command-analyzer';

export const runExtraAnalyzers = (
  filePath: string,
  options: CLIOptions,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const out: Record<string, unknown> = {};

    if (options.entryPoints) {
      const r = yield* analyzeEntryPointsFile(filePath).pipe(
        Effect.catch((e) => Effect.sync(() => ({ filePath, entryPoints: [], error: String(e) }))),
      );
      out.entryPoints = r;
    }
    if (options.configLeaks) {
      const r = yield* analyzeConfigSensitivityFile(filePath).pipe(
        Effect.catch((e) =>
          Effect.sync(() => ({ filePath, sources: [], leaks: [], error: String(e) })),
        ),
      );
      out.configSensitivity = r;
    }
    if (options.cliCommands) {
      const r = yield* analyzeCliCommandsFile(filePath).pipe(
        Effect.catch((e) =>
          Effect.sync(() => ({ filePath, commands: [], runs: [], error: String(e) })),
        ),
      );
      out.cliCommands = r;
    }

    const text = options.pretty ? JSON.stringify(out, null, 2) : JSON.stringify(out);
    if (options.output) {
      yield* cliTry(() => fs.writeFile(options.output!, text, 'utf-8')).pipe(
        Effect.catch((e) =>
          Console.error(`Write failed: ${e instanceof Error ? e.message : String(e)}`),
        ),
      );
    } else {
      yield* Console.log(text);
    }
  });
