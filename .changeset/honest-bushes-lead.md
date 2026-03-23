---
"effect-analyzer": patch
---

Improve static analysis coverage for additional Effect program patterns.

- Detect exported function declarations that are typed to return `Effect` and analyze their returned effect expressions.
- Add support for top-level `Effect.fn(...)` / `Effect.fnUntraced(...)` curried program declarations, including traced metadata.
- Recognize tagged template expressions (for example SQL tagged templates) as effectful operations during expression analysis.
- Reduce false positives in project-level discovery by excluding files that only import non-program utility modules from `effect`.
