/**
 * Browser-safe entrypoint.
 *
 * This entrypoint intentionally omits file-system and project-wide APIs. It is
 * limited to source-string analysis plus pure renderers. Call
 * `setTsMorphModule()` or `setTsMorphLoader()` before running analysis.
 */

export { analyzeSource, type AnalyzeSourceResult } from './analyze-source';
export {
  analyzeEffectSource,
  resetIdCounter,
} from './static-analyzer';
export {
  setTsMorphModule,
  setTsMorphLoader,
  resetTsMorphRuntime,
} from './ts-morph-loader';

export type {
  AnalyzerOptions,
  StaticEffectIR,
  StaticFlowNode,
  StaticEffectNode,
  StaticEffectProgram,
  AnalysisWarning,
  AnalysisStats,
  SourceLocation,
} from './types';

export { renderExplanation, renderMultipleExplanations } from './output/explain';
export { renderSummary, renderMultipleSummaries } from './output/summary';
export { renderJSON, renderMultipleJSON } from './output/json';
export { renderRailwayMermaid } from './output/mermaid-railway';
export { renderServicesMermaid, renderServicesMermaidFromMap } from './output/mermaid-services';
export {
  renderMermaid,
  renderStaticMermaid,
  renderPathsMermaid,
  summarizePathSteps,
  renderEnhancedMermaid,
  renderSequenceMermaid,
  renderRetryGanttMermaid,
  renderEnhancedMermaidEffect,
  renderServiceGraphMermaid,
} from './output/mermaid';
export { renderErrorsMermaid } from './output/mermaid-errors';
export { renderDecisionsMermaid } from './output/mermaid-decisions';
export { renderCausesMermaid } from './output/mermaid-causes';
export { renderConcurrencyMermaid } from './output/mermaid-concurrency';
export { renderTimelineMermaid } from './output/mermaid-timeline';
export { renderLayersMermaid } from './output/mermaid-layers';
export { renderRetryMermaid } from './output/mermaid-retry';
export { renderTestabilityMermaid } from './output/mermaid-testability';
export { renderDataflowMermaid } from './output/mermaid-dataflow';
export { inferBestDiagramType, type DiagramType } from './output/auto-diagram';
export { renderInteractiveHTML } from './output/html';
