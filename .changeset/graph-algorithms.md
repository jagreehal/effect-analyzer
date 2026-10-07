---
"effect-analyzer": patch
---

Cycle detection for layers and data flow reports each cycle once, including cycles that pass back through a layer you reached earlier. `detectLayerCycles` and `findCycles` take an optional `limit` (default 100). `getTransitiveDependencies` returns each step once, nearest first. The `mermaid-layers` diagram labels cycle edges `⚠ CYCLE` and renders densely connected layer graphs in milliseconds.
