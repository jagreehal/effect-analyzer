/**
 * Static Effect Analysis
 *
 * Tools for analyzing Effect code without executing it.
 * Uses ts-morph for full TypeScript type information.
 * Built entirely with Effect for composability.
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { analyze, renderMermaid, renderJSON } from "effect-analyzer";
 *
 * // Analyze an Effect file
 * const ir = await Effect.runPromise(analyze("./src/program.ts").single());
 *
 * // Generate Mermaid diagram
 * const diagram = await Effect.runPromise(renderMermaid(ir));
 * console.log(diagram);
 *
 * // Export as JSON
 * const json = await Effect.runPromise(renderJSON(ir));
 * console.log(json);
 * ```
 */

import './register-node-ts-morph';

// =============================================================================
// Static Analysis - Primary API
// =============================================================================

export { analyze, type AnalyzeResult } from './analyze';

// Project-wide analysis (GAP 17)
export { analyzeProject, runCoverageAudit } from './project-analyzer';
export type {
  ProjectAnalysisResult,
  AnalyzeProjectOptions,
  ProjectFileFailure,
  FileOutcome,
  CoverageAuditResult,
} from './project-analyzer';
export {
  extractProjectArchitecture,
  renderProjectArchitecture,
} from './project-architecture';
export type {
  ProjectArchitectureSummary,
  RuntimeArchitectureSummary,
  RuntimeArchitectureStage,
  CommandDefinitionSummary,
  LayerAssemblySummary,
} from './project-architecture';

// Migration assistant (GAP 29)
export {
  findMigrationOpportunities,
  findMigrationOpportunitiesInProject,
  formatMigrationReport,
} from './migration-assistant';
export type {
  MigrationOpportunity,
  MigrationReport,
} from './migration-assistant';

// =============================================================================
// Static Analysis - Core API
// =============================================================================

export {
  analyzeEffectFile,
  analyzeEffectSource,
  resetIdCounter,
} from './static-analyzer';

// =============================================================================
// Output Generators
// =============================================================================

// Mermaid diagrams
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
export type {
  PathsMermaidOptions,
  PathSummaryResult,
  DisplayPathStep,
  EnhancedMermaidOptions,
} from './output/mermaid';

// Specialized Mermaid renderers
export { renderRailwayMermaid } from './output/mermaid-railway';
export { renderServicesMermaid, renderServicesMermaidFromMap } from './output/mermaid-services';
export { renderErrorsMermaid } from './output/mermaid-errors';
export { renderDecisionsMermaid } from './output/mermaid-decisions';
export { renderCausesMermaid } from './output/mermaid-causes';
export { renderConcurrencyMermaid } from './output/mermaid-concurrency';
export { renderTimelineMermaid } from './output/mermaid-timeline';
export { renderLayersMermaid } from './output/mermaid-layers';
export { renderRetryMermaid } from './output/mermaid-retry';
export { renderTestabilityMermaid } from './output/mermaid-testability';
export { renderDataflowMermaid } from './output/mermaid-dataflow';

// Diagram auto-detection
export { inferBestDiagramType, type DiagramType } from './output/auto-diagram';

// Diagram quality
export {
  computeProgramDiagramQuality,
  computeFileDiagramQuality,
  buildTopOffendersReport,
} from './diagram-quality';
export { loadDiagramQualityHintsFromEslintJson } from './diagram-quality-eslint';

// Explain output (plain-English narrative)
export { renderExplanation, renderMultipleExplanations } from './output/explain';

// Summary output (one-liner per program)
export { renderSummary, renderMultipleSummaries } from './output/summary';

// Dependency matrix
export { renderDependencyMatrix, renderDependencyMatrixFromServiceMap } from './output/matrix';

// JSON output
export { renderJSON, renderMultipleJSON } from './output/json';

// HTML output (GAP 22)
export { renderInteractiveHTML } from './output/html';
export type { HtmlOutputOptions } from './output/html';

// Documentation generation (Phase 7)
export { renderDocumentation, renderMultiProgramDocs } from './output/docs';
export type { DocumentationOptions, DocSection } from './output/docs';

// Showcase output (awaitly-analyze parity)
export { generateShowcase, generateMultipleShowcase } from './output/showcase';
export type { ShowcaseOptions } from './output/showcase';

// Composition analysis (Phase 6)
export {
  analyzeProgramGraph,
  analyzeProjectComposition,
  getTopologicalOrder,
  getDependencies,
  getDependents,
  calculateGraphComplexity,
  renderGraphMermaid,
  renderCompositionMermaid,
  renderCompositionWithServicesMermaid,
} from './composition-resolver';
export type {
  ProgramGraph,
  ProgramGraphNode,
  ProgramCallEdge,
  UnresolvedProgramRef,
  CompositionResolverOptions,
  ProjectCompositionOptions,
  YieldStarCall,
} from './composition-resolver';

// =============================================================================
// Data Flow Analysis
// =============================================================================

export {
  buildDataFlowGraph,
  getDataFlowOrder,
  getProducers,
  getConsumers,
  getTransitiveDependencies,
  findCycles,
  validateDataFlow,
  renderDataFlowMermaid,
} from './data-flow';
export type {
  DataFlowGraph,
  DataFlowNode,
  DataFlowEdge,
  UndefinedRead,
  DuplicateWrite,
  DataFlowValidation,
  DataFlowIssue,
} from './data-flow';

// =============================================================================
// Error Flow Analysis
// =============================================================================

export {
  analyzeErrorFlow,
  analyzeErrorPropagation,
  getErrorsAtPoint,
  getErrorProducers,
  validateWorkflowErrors,
  renderErrorFlowMermaid,
  formatErrorSummary,
} from './error-flow';
export type {
  ErrorFlowAnalysis,
  StepErrorInfo,
  ErrorFlowEdge,
  ErrorValidation,
  ErrorPropagation,
  ErrorPropagationAnalysis,
} from './error-flow';

// =============================================================================
// Layer dependency graph (GAP 2)
// =============================================================================

export {
  buildLayerDependencyGraph,
  renderLayerGraphMermaid,
  detectLayerCycles,
  detectDiamondDependencies,
  findUnsatisfiedServices,
} from './layer-graph';
export type {
  LayerNodeInfo,
  LayerGraphEdge,
  LayerDependencyGraph,
  LayerCycle,
  DiamondDependency,
} from './layer-graph';

// =============================================================================
// Service flow / R tracking (GAP 3)
// =============================================================================

export { analyzeServiceFlow } from './service-flow';

// Service registry (whole-codebase mapping)
export { buildProjectServiceMap } from './service-registry';
export type { ProjectServiceMap, ServiceArtifact } from './service-registry';
export type {
  ServiceProvision,
  UnsatisfiedService,
  ServiceLifecycleEntry,
  ServiceFlowAnalysis,
} from './service-flow';

// =============================================================================
// State flow / Ref analysis (GAP 7)
// =============================================================================

export { analyzeStateFlow } from './state-flow';
export type {
  RefInfo,
  RefMutation,
  RaceCondition,
  StateFlowAnalysis,
} from './state-flow';

// =============================================================================
// Scope & resource lifecycle (GAP 10)
// =============================================================================

export { analyzeScopeResource } from './scope-resource';
export type {
  ResourceAcquisition,
  ScopeBoundary,
  ScopeResourceAnalysis,
} from './scope-resource';

// =============================================================================
// Observability (GAP 11)
// =============================================================================

export { analyzeObservability } from './observability';
export type {
  SpanInfo,
  LogPointInfo,
  MetricInfo,
  ObservabilityAnalysis,
} from './observability';

// =============================================================================
// DI completeness (GAP 27)
// =============================================================================

export { checkDICompleteness, formatDICompletenessReport } from './di-completeness';
export type {
  ServiceCompletenessEntry,
  DICompletenessReport,
} from './di-completeness';

// =============================================================================
// Strict Diagnostics
// =============================================================================

export {
  validateStrict,
  formatDiagnostics,
  formatDiagnosticsJSON,
  getSummary,
} from './strict-diagnostics';
export type {
  StrictDiagnostic,
  StrictRule,
  StrictValidationResult,
  StrictValidationOptions,
} from './strict-diagnostics';

// =============================================================================
// Path Generation
// =============================================================================

export {
  generatePaths,
  generatePathsWithMetadata,
  calculatePathStatistics,
  filterPaths,
} from './path-generator';
export type {
  PathGeneratorOptions,
  PathGenerationResult,
  PathStatistics,
  PathStatisticsOptions,
} from './path-generator';

// =============================================================================
// Complexity Metrics
// =============================================================================

export {
  calculateComplexity,
  assessComplexity,
  formatComplexitySummary,
  DEFAULT_THRESHOLDS,
} from './complexity';
export type {
  ComplexityAssessment,
  ComplexityWarning,
} from './complexity';

// =============================================================================
// Test Matrix
// =============================================================================

export {
  generateTestMatrix,
  formatTestMatrixMarkdown,
  formatTestMatrixAsCode,
  formatTestChecklist,
} from './output/test-matrix';
export type { TestMatrixOptions } from './output/test-matrix';

// =============================================================================
// Config Analysis (GAP 9)
// =============================================================================
export { analyzeConfig, formatConfigReport } from './config-analyzer';
export type { ConfigItem, ConfigAnalysis } from './config-analyzer';

// =============================================================================
// Match Analysis (GAP 12)
// =============================================================================
export { analyzeMatch } from './match-analyzer';
export type { MatchAnalysis, MatchSiteInfo, MatchArmInfo } from './match-analyzer';

// =============================================================================
// Platform Detection (GAP 14)
// =============================================================================
export { analyzePlatformUsage } from './platform-detection';
export type { PlatformUsageAnalysis } from './platform-detection';

// =============================================================================
// HttpApi / OpenAPI Extraction
// =============================================================================
export { extractHttpApiStructure } from './http-api-extractor';
export type {
  HttpApiStructure,
  HttpApiGroupInfo,
  HttpApiEndpointInfo,
} from './http-api-extractor';
export {
  renderApiDocsMarkdown,
  renderApiDocsMermaid,
  renderOpenApiPaths,
} from './output/api-docs';
export { schemaToJsonSchema } from './schema-to-json-schema';
export type { JsonSchemaObject } from './schema-to-json-schema';

// =============================================================================
// Testing Patterns (GAP 16)
// =============================================================================
export { analyzeTestingPatterns } from './testing-patterns';
export type { TestingPatternAnalysis } from './testing-patterns';

// =============================================================================
// Version Compatibility (GAP 25)
// =============================================================================
export { getEffectVersion, checkVersionCompat } from './version-compat';
export type { EffectVersionInfo, VersionCompatReport } from './version-compat';

// =============================================================================
// Gen Yield Analysis (GAP 28)
// =============================================================================
export { analyzeGenYields } from './gen-yield-analysis';
export type { GenYieldAnalysis, YieldBinding } from './gen-yield-analysis';

// =============================================================================
// SQL Patterns (GAP 15)
// =============================================================================
export { analyzeSqlPatterns } from './sql-patterns';
export type { SqlPatternAnalysis } from './sql-patterns';

// =============================================================================
// RPC Patterns (GAP 20)
// =============================================================================
export { analyzeRpcPatterns } from './rpc-patterns';
export type { RpcPatternAnalysis } from './rpc-patterns';

// =============================================================================
// Request Batching (GAP 19)
// =============================================================================
export { analyzeRequestBatching } from './request-batching';
export type { RequestBatchingAnalysis } from './request-batching';

// =============================================================================
// STM Analysis (GAP 13)
// =============================================================================
export { analyzeStm } from './stm-analysis';
export type { StmAnalysis } from './stm-analysis';

// =============================================================================
// Playground Export (GAP 30)
// =============================================================================
export {
  exportForPlayground,
  encodePlaygroundPayload,
  decodePlaygroundPayload,
} from './playground-export';
export type { PlaygroundPayload } from './playground-export';

// =============================================================================
// Analysis Cache
// =============================================================================
export { getCached, setCached } from './analysis-cache';

// =============================================================================
// Const Inliner
// =============================================================================

export {
  createConstCache,
  resolveConst,
  resolveNode,
  constValueToJS,
  extractStringArray,
  extractString,
  type ConstResolution,
  type ConstValue,
  type ConstCache,
} from './const-inliner';

// =============================================================================
// Diff
// =============================================================================

export { diffPrograms, renderDiffMarkdown, renderDiffJSON, renderDiffMermaid, parseSourceArg, resolveGitSource } from './diff';

// =============================================================================
// Auto-format
// =============================================================================

export { selectFormats, type FormatSelection } from './output/auto-format';

// =============================================================================
// Types
// =============================================================================

export type {
  // IR nodes
  StaticEffectIR,
  StaticEffectProgram,
  StaticFlowNode,
  StaticEffectNode,
  StaticGeneratorNode,
  StaticPipeNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticErrorHandlerNode,
  StaticRetryNode,
  StaticTimeoutNode,
  StaticResourceNode,
  StaticConditionalNode,
  StaticLoopNode,
  StaticLayerNode,
  StaticStreamNode,
  StreamOperatorInfo,
  StaticConcurrencyPrimitiveNode,
  StaticFiberNode,
  ScheduleInfo,
  StaticUnknownNode,
  StaticBaseNode,
  // Round 7 IR node types
  StaticTransformNode,
  StaticMatchNode,
  StaticCauseNode,
  StaticExitNode,
  StaticScheduleNode,

  // Configuration
  SourceLocation,
  DependencyInfo,

  // Analysis metadata
  StaticAnalysisMetadata,
  ServiceDefinition,
  AnalysisWarning,
  AnalysisStats,
  AnalyzerOptions,
  AnalysisError,

  // Paths
  EffectPath,
  PathStepRef,
  PathCondition,

  // Complexity
  ComplexityMetrics,
  ComplexityThresholds,

  // Test matrix
  TestMatrix,
  TestPath,
  TestCondition,
  TestMatrixSummary,

  // Output options
  JSONRenderOptions,
  MermaidOptions,
  MermaidStyles,
  MermaidDetailLevel,
  DiagramReadabilityBand,
  DiagramQualityMetrics,
  DiagramQuality,
  DiagramTopOffenderEntry,
  DiagramTopOffendersReport,
  DiagramQualityWithFile,

  // JSDoc tags
  JSDocTags,

  // Semantic classification
  SemanticRole,

  // Type signatures
  EffectTypeSignature,
  ServiceRequirement,
  StreamTypeSignature,
  LayerTypeSignature,
  ScheduleTypeSignature,
  CauseTypeSignature,

  // Showcase types
  ShowcaseEntry,
  ShowcaseStepDetail,

  // Service artifact types
  LayerImplementation,
  ServiceConsumerRef,
  ServiceArtifact as ServiceArtifactType,
  ProjectServiceMap as ProjectServiceMapType,
} from './types';

// Type guards
export {
  isStaticEffectNode,
  isStaticGeneratorNode,
  isStaticPipeNode,
  isStaticParallelNode,
  isStaticRaceNode,
  isStaticErrorHandlerNode,
  isStaticRetryNode,
  isStaticTimeoutNode,
  isStaticResourceNode,
  isStaticConditionalNode,
  isStaticLoopNode,
  isStaticLayerNode,
  isStaticStreamNode,
  isStaticConcurrencyPrimitiveNode,
  isStaticFiberNode,
  isStaticUnknownNode,
  isStaticTransformNode,
  isStaticMatchNode,
  isStaticCauseNode,
  isStaticExitNode,
  isStaticScheduleNode,
  getStaticChildren,
} from './types';

// Fiber leak analysis
export { analyzeFiberLeaks, formatFiberLeakReport } from './fiber-analysis';
export type { FiberForkInfo, FiberLeakAnalysis } from './fiber-analysis';

// =============================================================================
// Type Extraction
// =============================================================================

export {
  extractEffectTypeSignature,
  extractStreamTypeSignature,
  extractLayerTypeSignature,
  extractScheduleTypeSignature,
  extractCauseTypeSignature,
  extractServiceRequirements,
  formatTypeSignature,
  isSchemaType,
  extractSchemaInfo,
  trackTypeTransformation,
} from './type-extractor';

// =============================================================================
// Effect Linter
// =============================================================================

export {
  lintEffectProgram,
  formatLintReport,
  DEFAULT_LINT_RULES,
  errorTypeTooWideRule,
  unboundedParallelismRule,
  redundantPipeRule,
  orDieWarningRule,
  untaggedYieldRule,
  missingErrorHandlerRule,
  deadCodeRule,
  complexLayerRule,
  catchAllVsCatchTagRule,
} from './effect-linter';
export type { LintRule, LintIssue, LintResult } from './effect-linter';
