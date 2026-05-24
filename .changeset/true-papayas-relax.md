---
"effect-analyzer": minor
---

Add module coupling analyzer and consistent JSON output across health analyzers.

**New: `--coupling` analyzer.** Reports per-file fan-in (incoming imports) and fan-out (outgoing imports) across a project, with TypeScript AST-based parsing that handles regular imports, type-only imports, re-exports, dynamic `import()`, and side-effect imports. Surfaces three issue types: `high-fanin` (≥15 dependents), `critical-fanin` (≥30 dependents), and `high-fanout` (≥20 internal imports).

**New: in-source hub annotations.** Mark intentional hubs (central type files, public API entry points, service registries) with either:

```typescript
/** @known-hub central registry */
```

or:

```typescript
// effect-analyzer-known-hub central registry
```

Annotated hubs are excluded from `high-fanin` issues but still tracked, so unexpected growth is flagged. The annotation lives next to the code, is grep-able, and carries a written reason.

**New: `--format json` support on `--error-channel`, `--service-health`, `--performance`, and `--coupling`.** The JSON renderers existed in the library but weren't wired through the CLI; now they are.

**New public exports** from `effect-analyzer`:

- `analyzeCoupling(files, projectRoot, options?)` — accepts an optional prebuilt `ts-morph` `Project` for in-memory analysis (test- and browser-friendly)
- `renderCouplingReport(analysis)` and `renderCouplingJson(analysis, pretty?)`
- Types: `FileCouplingMetrics`, `CouplingIssue`, `CouplingAnalysis`, `CouplingSummary`, `AnalyzeCouplingOptions`
- `CouplingPriorityMap` on `BuildAgentReportOptions` for overriding the default coupling issue priorities in agent reports

**Agent report integration.** Coupling issues fold into the prioritized agent backlog alongside lint, coverage, error channel, service health, and performance findings.
