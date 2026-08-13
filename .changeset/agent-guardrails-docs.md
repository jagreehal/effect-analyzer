---
'effect-analyzer': patch
---

Document the analyzer as a guardrail for coding agents.

The README and the docs now lead with the check that no expression-level tool covers:
a program's shape (what it requires, what it can fail with, how it retries) changing in
a way that still compiles, still passes `oxlint`, and still satisfies the official
`@effect/tsgo` diagnostics.

- New **Guardrails for Coding Agents** page walking through `--agent-report` for the
  backlog, `--lint-source --baseline --fail-on-new` for the gate, and `--diff` for
  review, with a GitHub Actions job.
- README gains the same three commands as a section, and the introduction names coding
  agents as consumers of the output.
- Every command and output sample in the new docs was run against the committed
  fixtures first. `--diff` is documented as always exiting `0`, since it reports rather
  than gates.
