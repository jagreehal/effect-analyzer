/**
 * The `review` subcommand: a pull-request review of the Effect programs a
 * change touched. Parses its own flags because, like `diagnostics`, it is
 * dispatched before the main option parser and takes git pathspecs rather
 * than analyzer paths.
 */

import * as fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { Effect, Console } from 'effect';
import { cliFail, cliTry, type CliError } from './cli-support';
import { packageVersion } from './cli-help';
import { buildReview, renderReviewMarkdown } from './pr-review';

export interface ReviewInvocation {
  readonly base: string;
  readonly head?: string | undefined;
  readonly paths: readonly string[];
  readonly format: 'markdown' | 'json';
  readonly output?: string | undefined;
  readonly failOnRegression: boolean;
  readonly includeTests: boolean;
  readonly errors: readonly string[];
}

export const parseReviewArgs = (args: readonly string[]): ReviewInvocation => {
  let base = 'HEAD';
  let head: string | undefined;
  let format: ReviewInvocation['format'] = 'markdown';
  let output: string | undefined;
  let failOnRegression = false;
  let includeTests = false;
  const paths: string[] = [];
  const errors: string[] = [];

  const valueOf = (i: number, flag: string): [string | undefined, number] => {
    const arg = args[i] ?? '';
    if (arg.startsWith(`${flag}=`)) return [arg.slice(flag.length + 1), i];
    const next = args[i + 1];
    if (next === undefined || next.startsWith('-')) {
      errors.push(`${flag} requires a value`);
      return [undefined, i];
    }
    return [next, i + 1];
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--base' || arg.startsWith('--base=')) {
      const [v, j] = valueOf(i, '--base');
      if (v !== undefined) base = v;
      i = j;
    } else if (arg === '--head' || arg.startsWith('--head=')) {
      const [v, j] = valueOf(i, '--head');
      head = v;
      i = j;
    } else if (arg === '--format' || arg === '-f' || arg.startsWith('--format=')) {
      const [v, j] = valueOf(i, arg === '-f' ? '-f' : '--format');
      if (v === 'markdown' || v === 'json') format = v;
      else if (v !== undefined) errors.push(`Invalid value for --format: ${v} (expected markdown or json)`);
      i = j;
    } else if (arg === '--output' || arg === '-o' || arg.startsWith('--output=')) {
      const [v, j] = valueOf(i, arg === '-o' ? '-o' : '--output');
      output = v;
      i = j;
    } else if (arg === '--fail-on-regression') {
      failOnRegression = true;
    } else if (arg === '--include-tests') {
      includeTests = true;
    } else if (arg.startsWith('-')) {
      errors.push(`Unknown option: ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  return { base, head, paths, format, output, failOnRegression, includeTests, errors };
};

export const runReviewCommand = (args: readonly string[]): Effect.Effect<void, CliError> =>
  Effect.gen(function* () {
    const invocation = parseReviewArgs(args);
    if (invocation.errors.length > 0) {
      return yield* cliFail(invocation.errors.join('\n'));
    }

    const report = yield* buildReview({
      base: invocation.base,
      head: invocation.head,
      paths: invocation.paths,
      includeTests: invocation.includeTests,
    }).pipe(Effect.catch((e) => cliFail(e.message, e)));

    const markdown = renderReviewMarkdown(report, { version: packageVersion() });
    // JSON carries the rendering too, so a bot needs one run for the gate and the comment.
    const rendered =
      invocation.format === 'json' ? JSON.stringify({ ...report, markdown }, null, 2) : markdown;

    const outputPath = invocation.output;
    if (outputPath !== undefined) {
      yield* cliTry(() => fs.writeFile(resolve(outputPath), rendered, 'utf-8'));
    } else {
      yield* Console.log(rendered);
    }

    if (invocation.failOnRegression && report.risk === 'high') {
      return yield* cliFail(
        `Review found ${String(report.regressions.length)} structural regression(s) and ${String(report.newFindings.filter((f) => f.severity === 'error').length)} new lint error(s)`,
      );
    }
  });
