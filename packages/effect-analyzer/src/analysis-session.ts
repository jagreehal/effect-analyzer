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
  analyzeProjectCorpus,
  runCoverageAudit,
  runCoverageAuditFromCorpus,
  type AnalyzeProjectOptions,
  type CoverageAuditResult,
  type ProjectAnalysisResult,
} from './project-analyzer';
import { clearProjectCache } from './ts-morph-loader';
import {
  scanProjectCorpus,
  type ProjectCorpus,
  type ScanProjectCorpusOptions,
} from './project-corpus';

export interface AnalysisSession {
  readonly file: (
    filePath: string,
    options?: AnalyzerOptions,
  ) => ReturnType<typeof analyzeFile>;
  readonly source: (
    code: string,
    options?: AnalyzerOptions,
  ) => ReturnType<typeof analyzeFile.source>;
  readonly corpus: (
    dirPath: string,
    options?: ScanProjectCorpusOptions,
  ) => Effect.Effect<ProjectCorpus>;
  readonly project: (
    dirPath: string,
    options?: AnalyzeProjectOptions,
  ) => Effect.Effect<ProjectAnalysisResult>;
  readonly projectFromCorpus: (
    corpus: ProjectCorpus,
    options?: AnalyzeProjectOptions,
  ) => Effect.Effect<ProjectAnalysisResult>;
  readonly audit: (
    dirPath: string,
    options?: AnalyzeProjectOptions,
  ) => Effect.Effect<CoverageAuditResult>;
  readonly auditFromCorpus: (
    corpus: ProjectCorpus,
    options?: AnalyzeProjectOptions,
  ) => Effect.Effect<CoverageAuditResult>;
  readonly clearCaches: () => void;
}

export const createAnalysisSession = (): AnalysisSession => ({
  file: analyzeFile,
  source: analyzeFile.source,
  corpus: scanProjectCorpus,
  project: analyzeProject,
  projectFromCorpus: analyzeProjectCorpus,
  audit: runCoverageAudit,
  auditFromCorpus: runCoverageAuditFromCorpus,
  clearCaches: clearProjectCache,
});

/** Default session for ordinary Node callers. */
export const analysis = createAnalysisSession();

export type AnalysisEffect = Effect.Effect<
  readonly StaticEffectIR[],
  AnalysisError
>;
