---
"effect-analyzer": patch
---

Add improve mode, fix generators, and new analyzers; refresh HTML output and docs.

New analyzers and tooling
-------------------------
- `improve-mode.ts`: produces actionable, prioritized patches for improving Effect codebases.
- `fix-generators.ts`: deterministic fixers for common source-linter rules.
- `performance-antipatterns.ts`: detects common Effect performance pitfalls.
- `service-health.ts`: surfaces service/layer dependency health issues.
- `error-channel.ts`: dedicated error-channel analysis.
- `agent-report.ts`: structured report output tailored for AI agents.
- CLI: new flags and entry wiring to drive the above.

HTML output
-----------
- Refreshed styling, theme variables, and typography for headers, toolbars, and buttons.
- New `DiagnosticPanel` component renders terminal-style command examples and results.

Docs
----
- New pages: `project/app-shape`, `project/health`, `project/improve`, `project/source-linter`.
- Updated CLI reference, introduction, and landing page.
- Playground refresh and new `CompareShowcase` component.
