export { diffPrograms } from './diff-engine';
export { renderDiffMarkdown } from './render-markdown';
export { renderDiffJSON } from './render-json';
export { renderDiffMermaid } from './render-mermaid';
export { parseSourceArg, resolveGitHubPR, resolveGitSource } from './resolve-source';
export type {
  ProgramDiff,
  StepDiffEntry,
  StepChangeKind,
  StructuralChange,
  DiffSummary,
  DiffOptions,
  DiffMarkdownOptions,
  DiffMermaidOptions,
} from './types';
