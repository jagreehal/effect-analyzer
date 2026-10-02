---
"effect-analyzer": patch
---

Show what runs on the error rail: tap callbacks, `onError` cleanups, and ternaries over Effects.

- Taps (`tap`, `tapBoth`, `tapError`, `tapErrorTag`, `tapErrorCause`, `tapDefect`) record their callback as a `callback` child on the transform node. Inline functions and references like `Effect.tapError(svc.cleanup)` both work, and the standard Mermaid and explain views include it.
- The railway diagram draws error taps and `onError` as dotted branches off the guarded step, piped or data-first: `CE -.->|tapError| CT0["store.release"]`.
- `Effect.onError` and `Effect.onExit` work in a pipe and in data-first `(effect, cleanup)` form. Resource nodes name their combinator in a new `resourceOperation` field.
- Tap, handler and resource callbacks resolve service calls through the generator's service scope.
- `cond ? effectA : effectB` becomes a `raw-ternary` decision node with both branches analyzed.
