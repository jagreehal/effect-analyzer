# effect-analyzer-docs

## 0.0.8

### Patch Changes

- 69ae884: Added effect.retry

## 0.0.7

### Patch Changes

- 0de93ce: Improve Effect-specific analysis for real-world codebases and refresh the docs case studies.

  `effect-analyzer`:

  - reduce wrapper noise in explain output for service-construction files, so named operations surface instead of repeated `fn`/function-lift chatter
  - improve loop and callback summaries for traversal-heavy programs, including better `forEach` callback compression and simple predicate/body recovery
  - separate production layer assemblies from test layer assemblies in project architecture output
  - normalize built-in service names in user-facing summaries so dependencies render consistently, for example `FileSystem.FileSystem`

  `effect-analyzer-docs`:

  - refresh the `foldkit`, `t3code`, and `course-video-manager` case studies against current analyzer output
  - restore Mermaid examples in the case studies
  - switch visible commands and examples to repo-relative paths instead of local absolute filesystem paths
  - remove old-vs-new comparison language so the docs describe the current behavior directly

- 1d951e6: Update GitHub workflows: fix npm upgrade command to avoid MODULE_NOT_FOUND error and upgrade Node.js from 22 to 24

## 0.0.6

### Patch Changes

- a3637cf: Added more case studies

## 0.0.5

### Patch Changes

- 08bd948: Fixes Issue #25

## 0.0.4

### Patch Changes

- 81e2c99: Added case study for foldkit

## 0.0.3

### Patch Changes

- 36a7f40: Updated case studies

## 0.0.2

### Patch Changes

- 659891b: fix: interactive HTML viewer theme switching and playground improvements

  - Fix mermaid "Syntax error in text" when changing themes in the interactive HTML viewer — the diagram source text is now restored before re-rendering
  - Eliminate green flash on initial load by using MutationObserver to retheme SVG nodes immediately after mermaid renders, with CSS visibility gate to prevent any flash of default classDef colors
  - Replace arbitrary setTimeout delays (500ms/1000ms) with deterministic observer-based timing
  - Make sidebar responsive with minmax(260px, 380px) instead of fixed 380px
  - Add breadcrumb navigation bar to the standalone playground page
  - Add "Full page" button to open the interactive viewer in a new browser tab
  - Add favicon to the standalone playground page
  - Add debounced auto-analyze (1.5s) on textarea input with proper empty/error/success states
  - Add Playground link to README nav
  - Regenerate transfer-analysis.html demo with fixed theme switching code
  - Rewrite Semantic Diff docs with a worked example framed as reviewing an AI agent's PR, including real before/after code, railway diagrams, actual diff output, and CI regression detection patterns
