/**
 * Node analysis session.
 *
 * This is the single Node seam for configuring ts-morph and running file,
 * source, project, or coverage analysis. Importing internal analyzer modules is
 * deliberately not required to initialize the runtime.
 */

import './register-node-ts-morph';

import type { Effect } from 'effect';
import type { AnalysisError, AnalyzerOptions, StaticEffectIR } from './types';
import { analyze as analyzeFile } from './analyze';
import {
  analyzeProject,
  runCoverageAudit,
  type AnalyzeProjectOptions,
  type CoverageAuditResult,
  type ProjectAnalysisResult,
} from './project-analyzer';
import { clearProjectCache } from './ts-morph-loader';

export interface AnalysisSession {
  readonly file: (
    filePath: string,
    options?: AnalyzerOptions,
  ) => ReturnType<typeof analyzeFile>;
  readonly source: (
    code: string,
    options?: AnalyzerOptions,
  ) => ReturnType<typeof analyzeFile.source>;
  readonly project: (
    dirPath: string,
    options?: AnalyzeProjectOptions,
  ) => Effect.Effect<ProjectAnalysisResult>;
  readonly audit: (
    dirPath: string,
    options?: AnalyzeProjectOptions,
  ) => Effect.Effect<CoverageAuditResult>;
  readonly clearCaches: () => void;
}

export const createAnalysisSession = (): AnalysisSession => ({
  file: analyzeFile,
  source: analyzeFile.source,
  project: analyzeProject,
  audit: runCoverageAudit,
  clearCaches: clearProjectCache,
});

/** Default session for ordinary Node callers. */
export const analysis = createAnalysisSession();

export type AnalysisEffect = Effect.Effect<
  readonly StaticEffectIR[],
  AnalysisError
>;
