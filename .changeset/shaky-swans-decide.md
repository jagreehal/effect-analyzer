---
"effect-analyzer": patch
---

- **Alias resolution**: Follow multi-level re-export chains so Effect-like imports resolve through barrels and nested re-exports.
- **Control-flow & patterns**: Match `COLLECTION` / `CONDITIONAL` patterns using the final method name only; merge `Effect.withSpan` into the parent node as metadata instead of a standalone child; stop treating `Schema.decodeUnknown` as a loop; resolve generic error type `E` from inner expression types where applicable.
- **Generator IR**: Use clearer labels for `yield*` steps (e.g. from assigned names).
- **Diff**: Match programs with content-based fingerprints for stability; cap verbose node labels and `iterSource` text length (60 chars) to keep diffs readable.
- **Output**: Truncate user-visible labels (mermaid, explain, docs, HTML, timeline, concurrency, railway, causes) to the same default length as IR display names via `truncateDisplayText` / `DEFAULT_LABEL_MAX`.
- **Types**: When error type is parsed from type text as a single-letter generic (e.g. `E`), run the same inner-expression resolution as for checker-based extraction.
- **Tests**: Expand `quality-fixes` (Schema.decode, multi-withSpan, chained `pipe`), add `type-extractor-generic-e` tests, and cap Vitest `maxWorkers` at 50% to reduce flaky timeouts on heavy ts-morph suites.
