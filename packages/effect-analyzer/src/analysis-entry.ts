/** Full static-analysis interface for Effect v4. */

export * from './analysis-session';
export { analyze, type AnalyzeResult } from './analyze';
export { analyzeEffectFile, analyzeEffectSource } from './static-analyzer';
export { analyzeProject, runCoverageAudit } from './project-analyzer';
export * from './ir';
export * from './complexity';
export * from './path-generator';
export * from './data-flow';
export * from './error-flow';
export * from './service-flow';
export * as LayerGraph from './layer-graph';
export * from './observability';
export * from './output/test-matrix';
export * from './scope-resource';
export * from './state-flow';
export type * from './types';
