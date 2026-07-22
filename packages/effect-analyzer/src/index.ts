/** Canonical Effect v4 interface. */

export {
  analysis,
  createAnalysisSession,
  type AnalysisSession,
} from './analysis-session';

export {
  computeDiagramFidelity,
  formatDiagramFidelity,
  type DiagramFidelityIssue,
  type DiagramFidelityIssueKind,
  type DiagramFidelityReport,
} from './diagram-fidelity';

export {
  assessIRFidelity,
  type FidelityDimension,
  type FidelityFinding,
  type FidelityFindingKind,
  type IRFidelityAssessment,
} from './fidelity-findings';

export {
  traceFromEffectSpans,
  traceFromOpenTelemetry,
  type RuntimeTrace,
  type RuntimeTraceSpan,
  type RuntimeSpanStatus,
  type OpenTelemetryReadableSpan,
} from './runtime-trace';

export {
  renderStaticMermaid,
  renderMermaidWithRuntimeTrace,
  type RuntimeOverlayResult,
} from './output/mermaid';

export type {
  AnalyzerOptions,
  StaticEffectIR,
  StaticEffectProgram,
  StaticFlowNode,
  SourceLocation,
} from './types';
