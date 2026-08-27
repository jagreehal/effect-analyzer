---
'effect-analyzer': patch
---

Fix the railway diagram collapsing to `Empty((No steps))` for generator programs.

`renderRailwayMermaid` recursed into a generator through `getStaticChildren`,
which maps yields to their effect nodes and drops each yield's variable name. A
`const x = yield* deps.call(...).pipe(...)` therefore reached the step filter as
an unnamed node inside a pipe wrapper, was judged "anonymous plumbing", and was
skipped — taking every step of the workflow with it.

The generator's yields are now walked directly so the binding survives, steps are
labelled `x <- deps.call`, and anything a generator awaited counts as a step
whether or not it was bound.
