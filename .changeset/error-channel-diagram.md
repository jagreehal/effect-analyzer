---
'effect-analyzer': minor
---

The error flow diagram now shows what each handler does to each error. Edges
read `caught by`, `mapped by`, `dies at` or `swallowed by`, and errors nothing
intercepts flow to a neutral `E (reaches caller)` node. Red is reserved for
`orDie`, `orDieWith` and the swallowing combinators.

When no handler touches the error channel the diagram renders a
`((No handlers - see railway))` marker and auto mode drops it in favour of the
railway view; `--format mermaid-errors` and `renderErrorsMermaid(ir, { when:
'always' })` render it regardless.

`errorDisposition(handlerType)` is exported from `effect-analyzer/analysis`.

Handler semantics are driven by one table. Effect 4's `catchReason`,
`catchReasons`, `catchFilter`, `catchCauseIf`, `catchCauseFilter`,
`catchNoSuchElement` and `catchEager` are recognised; the `filter*` operators
preserve existing errors; `catchNoSuchElement` removes exactly
`NoSuchElementError`; handler tags match qualified error names such as
`Cause.NoSuchElementError`.

Unary combinators passed uncalled in a pipe — `Effect.orDie`, `Effect.ignore`
— are analysed as handlers.

A pipe whose only transformation is `Effect.withSpan` collapses into the call
it annotates, carrying the span name; chained annotation pipes keep every span
in nesting order. Callee labels from wrapped member chains render without a
stray space.
