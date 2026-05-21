# effect-analyzer

## 0.1.12

### Patch Changes

- b11d404: Add 16 deterministic source-linter rules with docs links and Bad/Good examples.

  **New rules:**

  - `console-log-in-effect` — `console.log` inside `Effect.gen` (loses span/fiber context)
  - `promise-api-in-gen` — `Promise.all/race/resolve/...` inside `Effect.gen` (bypasses interruption)
  - `effect-fail-untagged` — `Effect.fail(new Error(...))` (use `Data.TaggedError`)
  - `run-effect-in-gen` — `Effect.runPromise/runSync/runFork` inside `Effect.gen` (nested runtime)
  - `forEach-without-concurrency` — `Effect.forEach` with no options (silent sequential default)
  - `identity-catch` — `Effect.catchAll(e => Effect.fail(e))` and tag variants (no-op)
  - `empty-effect-all` — `Effect.all([])` / `Effect.all({})` (always-succeeds dead branch)
  - `layer-duplicate-merge` — `Layer.merge(A, A)` (last-wins; usually a typo)
  - `schedule-unbounded` — `Schedule.forever`/`Schedule.spaced` without bounding combinator
  - `config-secret-without-redacted` — `Config.string("API_TOKEN")` etc. (use `Config.redacted`)
  - `return-effect-from-sync` — `Effect.sync(() => Effect.succeed(x))` (`Effect<Effect<...>>`)
  - `yield-promise` — `yield* fetch(...)` / `yield* Promise.all(...)` (runtime crash)
  - `useless-pipe` — `pipe(x)` with a single argument
  - `tryPromise-without-catch` — `Effect.tryPromise(fn)` short form (errors collapse to `UnknownException`)
  - `barrel-import-from-effect` — `import { Effect } from "effect"` (mirrors `@effect/eslint-plugin`)
  - `array-push-spread` — `arr.push(...xs)` (V8 stack-overflow footgun; mirrors Effect repo's own `no-restricted-syntax`)

  **Per-rule docs & examples.** Every emitted `LintIssue` now optionally carries:

  - `docsUrl` — link to the most relevant page on `effect.website`
  - `example` — `{ bad, good }` copy-pasteable snippet illustrating the fix

  URLs verified against the Effect website MDX tree. Renderers (CLI/LSP/HTML) can surface this without per-rule logic.

  **Disable pragmas.** The runner honors:

  - `// eslint-disable-next-line <rule>` and `// eslint-disable-line <rule>`
  - `// effect-analyzer-disable-next-line <rule>` and `// effect-analyzer-disable-line <rule>`
  - Bare directives (no rule name) disable all rules on that line
  - `no-restricted-syntax` is recognised as an alias for `array-push-spread`

  **Scoping & noise reduction.**

  - `.tst.ts` (dtslint type-test) files are skipped entirely — their degenerate runtime patterns are type assertions, not code.
  - `barrel-import-from-effect` matches the Effect team's own ESLint scope (`packages/*/src/**/*` only — not test files).

  **False positives caught during dogfooding on real Effect codebases.** Validated against `effect/packages`, `alchemy-effect`, `t3code`, the EffectPatterns docs, and 10 example/getting-started repos — ~5,000 files. Seven FP categories were found and fixed before release:

  | FP                                                                                   | Fix                                                     |
  | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
  | `yield-promise` on shadowed `fetch` (local binding)                                  | resolve identifier symbol; skip if locally declared     |
  | `live-layer-in-test` matching `runLive` / `describeTimeToLive`                       | require PascalCase; exclude `*TimeToLive`               |
  | `untagged-throw` inside `Effect.try({ try, catch })`                                 | detect catch field; only flag throws with no handler    |
  | `schedule-unbounded` inside `Stream.repeat` / `Stream.fromSchedule` / `Stream.tick`  | consumer-controlled streams are intentionally unbounded |
  | `barrel-import-from-effect` in test files                                            | scope to src files only                                 |
  | `array-push-spread` on lines with `// eslint-disable-next-line no-restricted-syntax` | honor disable pragmas                                   |
  | `.tst.ts` runtime patterns                                                           | skip dtslint files                                      |

## 0.1.11

### Patch Changes

- 69ae884: Added effect.retry

## 0.1.10

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

## 0.1.9

### Patch Changes

- a3637cf: Added more case studies

## 0.1.8

### Patch Changes

- 08bd948: Fixes Issue #25

## 0.1.7

### Patch Changes

- 81e2c99: Added case study for foldkit

## 0.1.6

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

## 0.1.5

### Patch Changes

- 2a22ce9: Fix Mermaid rendering edge cases to reduce diagram noise and improve correctness.

  - Remove duplicate type annotations from node labels.
  - Emit only `classDef` styles that are actually referenced by rendered nodes.
  - Prevent duplicate yield nodes from breaking conditional branch diagrams.
  - Avoid orphan rectangular nodes for decision flows.

## 0.1.4

### Patch Changes

- bab7bc5: Improve static analysis coverage for additional Effect program patterns.

  - Detect exported function declarations that are typed to return `Effect` and analyze their returned effect expressions.
  - Add support for top-level `Effect.fn(...)` / `Effect.fnUntraced(...)` curried program declarations, including traced metadata.
  - Recognize tagged template expressions (for example SQL tagged templates) as effectful operations during expression analysis.
  - Reduce false positives in project-level discovery by excluding files that only import non-program utility modules from `effect`.

## 0.1.3

### Patch Changes

- 9545bdb: - **Alias resolution**: Follow multi-level re-export chains so Effect-like imports resolve through barrels and nested re-exports.
  - **Control-flow & patterns**: Match `COLLECTION` / `CONDITIONAL` patterns using the final method name only; merge `Effect.withSpan` into the parent node as metadata instead of a standalone child; stop treating `Schema.decodeUnknown` as a loop; resolve generic error type `E` from inner expression types where applicable.
  - **Generator IR**: Use clearer labels for `yield*` steps (e.g. from assigned names).
  - **Diff**: Match programs with content-based fingerprints for stability; cap verbose node labels and `iterSource` text length (60 chars) to keep diffs readable.
  - **Output**: Truncate user-visible labels (mermaid, explain, docs, HTML, timeline, concurrency, railway, causes) to the same default length as IR display names via `truncateDisplayText` / `DEFAULT_LABEL_MAX`.
  - **Types**: When error type is parsed from type text as a single-letter generic (e.g. `E`), run the same inner-expression resolution as for checker-based extraction.
  - **Tests**: Expand `quality-fixes` (Schema.decode, multi-withSpan, chained `pipe`), add `type-extractor-generic-e` tests, and cap Vitest `maxWorkers` at 50% to reduce flaky timeouts on heavy ts-morph suites.

## 0.1.2

### Patch Changes

- 9ea3234: Add `repository`, `bugs`, and `homepage` to package metadata so npm provenance and OIDC trusted publishing can validate the source repo.

  Resolve `@typescript-eslint/require-await` in the CLI (`Effect.tryPromise` no longer uses an `async` callback without `await`) and in a couple of tests that did not need `async`.

## 0.1.1

### Patch Changes

- f68fa1a: Tighten `Effect.gen` call detection: require the callee to end with `.gen` instead of matching `.gen` anywhere in the expression text, so unrelated identifiers are not mistaken for `gen` programs.
