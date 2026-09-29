export { diffPrograms } from "./diff-engine"
export { renderDiffJSON } from "./render-json"
export { renderDiffMarkdown } from "./render-markdown"
export { renderDiffMermaid } from "./render-mermaid"
export { parseSourceArg, resolveGitHubPR, resolveGitSource } from "./resolve-source"
export type {
  DiffMarkdownOptions,
  DiffMermaidOptions,
  DiffOptions,
  DiffSummary,
  ProgramDiff,
  StepChangeKind,
  StepDiffEntry,
  StructuralChange
} from "./types"
