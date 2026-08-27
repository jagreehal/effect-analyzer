---
'effect-analyzer': patch
---

Structural cleanups from a maintainability review of the state-machine, railway
and probe work.

- `schema-to-json-schema.ts`: the converter dispatched through a predicate that
  meant "callee is X" for calls and "the source text mentions X anywhere" for
  everything else, at nine call sites. Constructs now live in one table keyed by
  the call's own name, and the text heuristics exist in exactly one function
  used only where there is no callee to read.
- `state-machine.ts` was pushed to 1070 lines. The generic ts-morph plumbing
  moved to `state-machine-ast.ts`, which the diagnostics scanner now shares for
  import resolution instead of keeping a second copy of it.
- Watch mode moved out of `cli.ts` into `watch-mode.ts`, with the decision of
  what a refresh shows extracted as a pure `frameFor` and tested directly.
  `cli.ts` is now smaller than before this work began.
- `walkthrough.ts` used `as unknown as` to read error-handler nodes that already
  have a type and a guard (`isStaticErrorHandlerNode`), and exposed its cursor
  on the public `Walkthrough` type. Both fixed.
- `probeRuntime` returned a caller-chosen type for unvalidated JSON that crossed
  a process boundary. It returns `unknown`; `probeJsonSchema` decodes it and
  fails with a typed error when the shape is wrong.
- The railway walker threaded a `binding` and a `yielded` boolean through every
  step. Both collapse into one `Arrival` value, and the skip predicate splits
  into `isDefinitionNode` and `isAnonymousEffect`.
