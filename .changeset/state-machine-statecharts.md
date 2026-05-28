---
"effect-analyzer": minor
---

Add state machine analysis with XState-style statecharts.

Detect plain-Effect state machines (declarative transition tables and Match.when transition functions) and render them as statecharts without an XState dependency. Renderers cover mermaid (stateDiagram-v2), a self-contained SVG, a local HTML visualizer (with `--open`), and pasteable `createMachine()` config for stately.ai/viz.

Schema-aware coverage reads the declared alphabet from tagged unions or Schema-derived types and reports unhandled events, unreachable states, and undeclared symbols, with a `--min-coverage` threshold, `--coverage-json`, and a non-zero CI exit on warnings. When a command finds no machines, near-miss diagnostics explain why each candidate was rejected.
