---
'effect-analyzer': minor
---

Sharpen coverage-audit unknown-node diagnostics.

- The "Located unknown nodes" list now reports truncation as
  `Located unknown nodes (showing 10 of N):` instead of silently capping at 10.
- Unresolved nodes are now classified by kind — non-Effect object literal,
  predicate/boolean expression, unrecognized constructor, unresolved
  property access or identifier, non-Effect conditional/function expression —
  so `Top unknown node reasons` is an actionable histogram rather than one
  opaque `Could not determine effect type` bucket. That default reason still
  applies to genuinely unclassifiable node kinds.
