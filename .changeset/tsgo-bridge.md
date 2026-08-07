---
'effect-analyzer': major
---

Delegate type-aware Effect linting to `@effect/tsgo` instead of reimplementing it.

- **Breaking:** the zero-argument members of the fluent `analyze()` /
  `analyze.source()` / `analyzeSource()` results are now Effects rather than
  functions returning Effects — Effect is already lazy, so the wrapper was
  redundant indirection. `named(name)` takes an argument and is unchanged.

  ```diff
  - const programs = yield* analyze(file).all()
  + const programs = yield* analyze(file).all
  ```

  Applies to `single`, `singleOption`, `all`, `first`, `firstOption`.

- New `--tsgo[=<tsconfig>]` flag merges the official Effect language service's ~95
  type-aware diagnostics into `--lint-source` findings. `@effect/tsgo` is a
  required dependency, while its native diagnostic runner resolves the target
  project's own TypeScript 7 installation so its compiler generation and rules
  agree with the user's editor.
- **Breaking for linting:** five source rules that duplicated a type-aware
  `@effect/tsgo` equivalent were removed — `effect-fail-untagged`,
  `raw-side-effect-in-gen`, `run-effect-in-gen`, `console-log-in-effect`,
  `useless-pipe`. Their tsgo counterparts (`globalErrorInEffectFailure`,
  `globalFetchInEffect` / `processEnvInEffect` / `newPromise` and friends,
  `runEffectInsideEffect`, `globalConsoleInEffect`, `unnecessaryPipe`) use the
  type checker rather than AST heuristics. The `--improve` fix generators for
  those rules were removed with them. Note that most of these tsgo rules default
  to `off` — enable them in your plugin options (or `.oxlintrc.json`) or you
  will lose the coverage rather than upgrade it.
- Toolchain: TypeScript 6 → 7. Declarations are now emitted by
  `tsc --emitDeclarationOnly` because tsup's `dts` bundling drives the
  TypeScript JS compiler API, which the native port no longer exposes. The four
  aliased subpath exports therefore resolve types from `*-entry.d.ts`.
- Toolchain: ESLint → oxlint, because `typescript-eslint` refuses TypeScript 7
  in every published version. oxlint also hosts the `effecttsgo/*` rules.
