/**
 * Browser-safe entrypoint.
 *
 * This entrypoint intentionally omits file-system and project-wide APIs. It is
 * limited to source-string analysis plus pure renderers. Call
 * `setTsMorphModule()` or `setTsMorphLoader()` before running analysis.
 */

export { analyzeSource, type AnalyzeSourceResult } from "./analyze-source"
export { analyzeEffectSource, resetIdCounter } from "./static-analyzer"
export { resetTsMorphRuntime, setTsMorphLoader, setTsMorphModule } from "./ts-morph-loader"

export type {
  AnalysisStats,
  AnalysisWarning,
  AnalyzerOptions,
  SourceLocation,
  StaticEffectIR,
  StaticEffectNode,
  StaticEffectProgram,
  StaticFlowNode
} from "./types"

export { type DiagramType, inferBestDiagramType } from "./output/auto-diagram"
export { renderExplanation, renderMultipleExplanations } from "./output/explain"
export { renderInteractiveHTML } from "./output/html"
export { renderJSON, renderMultipleJSON } from "./output/json"
export {
  renderEnhancedMermaid,
  renderEnhancedMermaidEffect,
  renderMermaid,
  renderPathsMermaid,
  renderRetryGanttMermaid,
  renderSequenceMermaid,
  renderServiceGraphMermaid,
  renderStaticMermaid,
  summarizePathSteps
} from "./output/mermaid"
export { renderCausesMermaid } from "./output/mermaid-causes"
export { renderConcurrencyMermaid } from "./output/mermaid-concurrency"
export { renderDataflowMermaid } from "./output/mermaid-dataflow"
export { renderDecisionsMermaid } from "./output/mermaid-decisions"
export { renderErrorsMermaid } from "./output/mermaid-errors"
export { renderLayersMermaid } from "./output/mermaid-layers"
export { renderRailwayMermaid } from "./output/mermaid-railway"
export { renderRetryMermaid } from "./output/mermaid-retry"
export { renderServicesMermaid, renderServicesMermaidFromMap } from "./output/mermaid-services"
export { renderTestabilityMermaid } from "./output/mermaid-testability"
export { renderTimelineMermaid } from "./output/mermaid-timeline"
export { renderMultipleSummaries, renderSummary } from "./output/summary"
