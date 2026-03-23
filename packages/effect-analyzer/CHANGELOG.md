# effect-analyzer

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
