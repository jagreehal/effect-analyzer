---
'effect-analyzer': minor
---

Delegate type-aware Effect linting to `@effect/tsgo` instead of reimplementing it.

- New `--tsgo [tsconfig]` flag merges the official Effect language service's ~95
  type-aware diagnostics into `--lint-source` findings. `@effect/tsgo` is an
  optional dependency; without it the flag is a silent no-op.
- **Breaking for linting:** five source rules that duplicated a type-aware
  `@effect/tsgo` equivalent were removed — `effect-fail-untagged`,
  `raw-side-effect-in-gen`, `run-effect-in-gen`, `console-log-in-effect`,
  `useless-pipe`. Their tsgo counterparts (`globalErrorInEffectFailure`,
  `globalFetchInEffect` / `processEnvInEffect` / `newPromise` and friends,
  `runEffectInsideEffect`, `globalConsoleInEffect`, `unnecessaryPipe`) use the
  type checker rather than AST heuristics. The `--improve` fix generators for
  those rules were removed with them.
