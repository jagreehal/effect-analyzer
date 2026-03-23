---
"effect-analyzer": patch
---

Fix Mermaid rendering edge cases to reduce diagram noise and improve correctness.

- Remove duplicate type annotations from node labels.
- Emit only `classDef` styles that are actually referenced by rendered nodes.
- Prevent duplicate yield nodes from breaking conditional branch diagrams.
- Avoid orphan rectangular nodes for decision flows.
