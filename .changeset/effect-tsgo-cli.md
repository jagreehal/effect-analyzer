---
'effect-analyzer': minor
---

`effect-analyze` is now a drop-in replacement for the `effect-tsgo` CLI.

`effect-analyze diagnostics` takes the same flags as `effect-tsgo diagnostics`
and forwards them untouched, so `@effect/tsgo` validates its own flags, reads
your project's `@effect/language-service` plugin configuration and picks its own
exit code. Its output is passed through: `text`, `pretty` and `github-actions`
are byte-identical, including diagnostic order and the summary trailer.
`setup`, `config`, `patch`, `unpatch` and `get-exe-path` are forwarded too, so a
single CLI covers both configuration and diagnostics.

What it adds is the analyzer's own AST rules in the same stream. Every JSON
entry carries a `source` (`tsgo` or `analyzer`) alongside upstream's schema, so
a consumer can tell a type-aware Effect diagnostic from one of ours — and both
from a TypeScript compiler error. Analyzer rules carry `code: 0`, outside the
`377xxx` Effect range, so filtering on that range behaves exactly as before.
`--no-analyzer` reports only the language service.

New in `--lint-source`:

- `--fail-on=error|warning|info` gates the exit status on severity. Without it a
  run stays advisory and never changes the exit code.
- Findings carry `source` and, for language service diagnostics, the `377xxx`
  `code` and end position.
- The summary reports what the language service covered
  (`summary.tsgo.filesChecked` and `unchecked`), so a partially checked run is
  distinguishable from a clean one.

Also fixes truncated output: piping a report larger than the pipe buffer cut it
mid-string, because the CLI exited before stdout had drained.

Requires `@effect/tsgo` 0.39.0.
