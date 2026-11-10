---
"effect-analyzer": minor
"effect-analyzer-docs": patch
---

Statechart formats such as `--format machine-json` now accept plain Effect programs. When a file has no explicit machine, `irToStateMachine` turns each railway step into a state with `ok` and `err` events, chains error taps in callback order, and tags finals `success` or `error`.

Pass a `mermaid-*` format on a single file to write only that diagram to the adjacent `.effect-analysis.md`. Colocated reports now come out the same on every run: they name the source file without its absolute path and drop the timestamp and TypeScript version.
