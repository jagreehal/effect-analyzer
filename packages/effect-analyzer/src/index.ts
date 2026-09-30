/** Canonical Effect v4 interface. */

export { analysis, type AnalysisSession, createAnalysisSession } from "./analysis-session"

export {
  computeDiagramFidelity,
  type DiagramFidelityIssue,
  type DiagramFidelityIssueKind,
  type DiagramFidelityReport,
  formatDiagramFidelity
} from "./diagram-fidelity"

export {
  assessIRFidelity,
  type FidelityDimension,
  type FidelityFinding,
  type FidelityFindingKind,
  type IRFidelityAssessment
} from "./fidelity-findings"

export {
  type OpenTelemetryReadableSpan,
  type RuntimeSpanStatus,
  type RuntimeTrace,
  type RuntimeTraceSpan,
  type SpanTree,
  type SpanTreeNode,
  traceFromEffectSpans,
  traceFromOpenTelemetry,
  traceFromSpanTree
} from "./runtime-trace"

export { renderMermaidWithRuntimeTrace, renderStaticMermaid, type RuntimeOverlayResult } from "./output/mermaid"

export {
  advance,
  advanceWhileLinear,
  beginWalkthrough,
  type ChoiceKind,
  rewind,
  type WalkChoice,
  type WalkStep,
  type Walkthrough
} from "./walkthrough"

export type { AnalyzerOptions, SourceLocation, StaticEffectIR, StaticEffectProgram, StaticFlowNode } from "./types"
