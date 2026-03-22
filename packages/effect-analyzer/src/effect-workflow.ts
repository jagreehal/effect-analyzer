/**
 * effect-workflow analyzer entrypoint
 *
 * Same API as the main analyzer but with effect-workflow patterns enabled
 * (Workflow.make / Workflow.run). Use this when analyzing code that uses
 * the effect-workflow library.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { analyze } from "effect-analyzer/effect-workflow";
 *
 * const ir = await Effect.runPromise(
 *   analyze.source(source).named("runCheckout")
 * );
 * ```
 */

import { analyze as baseAnalyze } from './analyze';
import type { AnalyzerOptions } from './types';

const workflowOptions: AnalyzerOptions = { enableEffectWorkflow: true };

/**
 * Analyze a file with effect-workflow patterns enabled (Workflow.make / Workflow.run).
 */
export const analyze = (
  filePath: string,
  options?: AnalyzerOptions,
): ReturnType<typeof baseAnalyze> =>
  baseAnalyze(filePath, { ...workflowOptions, ...options });

analyze.source = (
  code: string,
  options?: AnalyzerOptions,
): ReturnType<typeof baseAnalyze.source> =>
  baseAnalyze.source(code, { ...workflowOptions, ...options });

export type { AnalyzeResult } from './analyze';
export type { StaticEffectIR, AnalyzerOptions } from './types';
