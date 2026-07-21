---
'effect-analyzer': minor
---

Statechart modeling depth: much of XState's modeling value, no extra runtime.

- **Named actions**: transitions take `actions: [...]`; states take `entry` /
  `exit` action labels — in transition tables and MachineJSON. Rendered on
  mermaid edges and state boxes, carried into the exported XState config.
- **Invoke annotations**: `invoke: { src, onDone, onError }` in tables and
  MachineJSON (shape matches XState v6 `InvokeJSON`). Completions become
  automatic `done`/`error` transitions — reachability edges excluded from
  event coverage — and the exported config rebuilds the invoke block.
- **Explicit finals**: `type: 'final'` in tables and MachineJSON. An explicit
  marker turns off no-outgoing inference, and explicitly-final states are no
  longer reported as dead-end findings.
- **Hierarchy**: dotted state names (`'Playing.Paused'`) nest as composite
  states in mermaid and as nested `states` with absolute `#id.path` targets in
  the exported config; `@initial` accepts dotted paths.
- **Automatic transitions in tables**: reserved `always` and `'after 500ms'`
  keys, matching the MachineJSON labels.
- **Parallel states** carry through to the exported config as
  `type: 'parallel'` instead of collapsing to one region's initial.
- **Match extraction**: `new StateClass()` handler returns resolve to the
  class's declared `Schema.TaggedClass` tag (class name and tag need not
  match).
- **Public API**: `effect-analyzer/analysis` now exports the statechart
  renderers (`renderStatechartMermaid`, `renderStatechartsMermaid`,
  `renderXStateConfig`, `renderStatechartSVG`) alongside `fromMachineJSON`,
  `computeStateMachineCoverage`, and the `MachineJSON` types, so MachineJSON
  machines can be rendered programmatically.
- **Fixed conventions**: the nested `Match.tags` style now closes its matchers
  (`Match.tagsExhaustive` + `Match.orElse`) and compiles on Effect v4;
  `Schema.TaggedRequest` (removed in Effect v4) replaced with
  `Schema.TaggedClass` throughout docs and fixtures.
