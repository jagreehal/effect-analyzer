/** Full static-analysis interface for Effect v4. */

export * from "./analysis-session"
export { analyze, type AnalyzeResult } from "./analyze"
export * from "./audit-assessment"
export * from "./audit-policy"
export * from "./complexity"
export * from "./data-flow"
export * from "./error-flow"
export * from "./fidelity-findings"
export * from "./ir"
export * as LayerGraph from "./layer-graph"
export * from "./observability"
export * from "./output/coverage-report"
export * from "./output/test-matrix"
export * from "./path-generator"
export {
  analyzeProject,
  analyzeProjectCorpus,
  type AnalyzeProjectOptions,
  type CoverageAuditResult,
  type FileOutcome,
  type ProjectAnalysisResult,
  type ProjectFidelityFinding,
  runCoverageAudit,
  runCoverageAuditFromCorpus,
  type ZeroProgramCategory,
  type ZeroProgramClassification
} from "./project-analyzer"
export {
  type ProjectCorpus,
  type ProjectCorpusFile,
  type ProjectCorpusFileStatus,
  scanProjectCorpus,
  type ScanProjectCorpusOptions
} from "./project-corpus"
export * from "./scope-resource"
export * from "./service-flow"
export * from "./state-flow"
export { analyzeEffectFile, analyzeEffectSource } from "./static-analyzer"
// Statechart analysis: extract from source, ingest MachineJSON, verify coverage.
export {
  analyzeStateMachines,
  type StateInvoke,
  type StateMachine,
  type StateMachineAnalysis,
  type StateTransition
} from "./state-machine"
export {
  computeStateMachineCoverage,
  type CoverageFinding,
  type CoverageKind,
  type StateMachineCoverage
} from "./state-machine-coverage"
export {
  fromMachineJSON,
  type FromMachineJSONOptions,
  type MachineJSON,
  type MachineJSONAction,
  type MachineJSONExpression,
  type MachineJSONGuard,
  type MachineJSONInitial,
  type MachineJSONInvoke,
  type MachineJSONStateNode,
  type MachineJSONTransition,
  type MachineJSONUnserializable,
  type MachineJSONValue
} from "./state-machine-json"
// Statechart renderers, so MachineJSON machines (which the CLI does not
// discover in source) can be rendered programmatically too.
export { renderStatechartMermaid, renderStatechartsMermaid } from "./output/mermaid-statechart"
export { renderStatechartSVG } from "./output/svg-statechart"
export { renderXStateConfig } from "./output/xstate-config"
export type * from "./types"
