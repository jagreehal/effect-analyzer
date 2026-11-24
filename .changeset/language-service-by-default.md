---
"effect-analyzer": minor
"effect-analyzer-docs": patch
---

The Effect language service runs by default, with no setup. Plain runs (on stderr), `--lint-source`, `--agent-report`, `diagnostics` and `review` report an Effect you forgot to yield, or a `yield` that needs a star. Your `@effect/language-service` plugin severities apply when you configure them, and `--no-tsgo` turns the checks off.

If you gate on `--fail-on` or `--fail-on-new`, expect new findings and regenerate your baseline. `--fail-on-regression` now gates on these rules too.

- `review` reads types for base and an explicit `--head` from git. Its JSON gains `typeAwareSkipped`.
- `summary.tsgo` gains `skipped`, with reasons for the files in `unchecked`.
- Diagrams label a `yield` that needs a star as `yield without *`.
- The LSP server publishes language service findings on open and save.
- Updates `@effect/tsgo` to 0.73.4 and bundles TypeScript 7.0.2.
