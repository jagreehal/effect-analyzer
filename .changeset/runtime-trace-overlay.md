---
'effect-analyzer': minor
---

Overlay a captured runtime trace on a diagram: `--runtime-trace <file>` colors a
`--format mermaid` diagram by span status and reports how each span matched.
`traceFromSpanTree()` decodes traces exported as a nested span tree, and span
matching resolves the longest unique path suffix, so spans opened above the
analyzed program still light up everything that ran beneath them.
