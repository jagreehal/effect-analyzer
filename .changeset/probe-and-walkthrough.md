---
'effect-analyzer': minor
---

Four additions drawn from the effect-machine devtools, aimed at Effect in
general rather than any one library.

**Isolated runtime probes** (`runtime-probe.ts`). Static analysis has to
re-derive what Effect already knows exactly. A probe asks the real value
instead, importing one module in a separate short-lived process so a target that
throws, hangs, or calls `process.exit` cannot take the analyzer with it. Every
failure comes back as a typed `RuntimeProbeError`. Importing a module runs its
top-level code, so probing is opt-in and says so — see `SECURITY_NOTE`.

**Exact JSON Schema** — `--format json-schema --export <Name>` returns what
`Schema.toJsonSchemaDocument` produces, including refinements, annotations and
transformations that no AST walker can see.

**Last-good retention** (`analysis-retention.ts`). A file saved mid-edit does not
parse. `--watch` used to clear the screen before every run, so each keystroke
blanked the diagram and left a bare error. The render is now buffered
(`captureStdout`) and the screen is cleared only once a run succeeds; a failure
that follows a success keeps the last valid analysis on screen and marks it
`partial`.

**Walkthroughs** (`walkthrough.ts`). `generatePaths` enumerates every path at
once, which explodes combinatorially and cannot be steered. A walkthrough is the
other half: one step at a time, every branch offered as an explicit choice
rather than guessed, an immutable timeline, and `rewind` to truncate the future
and explore a different branch. Nodes the IR cannot see into are reported as
`opaque` instead of invented.

**Versioned JSON.** `--format json` now stamps `schemaVersion` so consumers can
validate and migrate. Additive: the document shape is otherwise unchanged.
