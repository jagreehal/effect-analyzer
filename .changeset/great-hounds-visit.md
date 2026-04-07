---
"effect-analyzer": patch
"effect-analyzer-docs": patch
---

Improve Effect-specific analysis for real-world codebases and refresh the docs case studies.

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
