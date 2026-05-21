---
"effect-analyzer": patch
---

Add 16 deterministic source-linter rules with docs links and Bad/Good examples.

**New rules:**

- `console-log-in-effect` — `console.log` inside `Effect.gen` (loses span/fiber context)
- `promise-api-in-gen` — `Promise.all/race/resolve/...` inside `Effect.gen` (bypasses interruption)
- `effect-fail-untagged` — `Effect.fail(new Error(...))` (use `Data.TaggedError`)
- `run-effect-in-gen` — `Effect.runPromise/runSync/runFork` inside `Effect.gen` (nested runtime)
- `forEach-without-concurrency` — `Effect.forEach` with no options (silent sequential default)
- `identity-catch` — `Effect.catchAll(e => Effect.fail(e))` and tag variants (no-op)
- `empty-effect-all` — `Effect.all([])` / `Effect.all({})` (always-succeeds dead branch)
- `layer-duplicate-merge` — `Layer.merge(A, A)` (last-wins; usually a typo)
- `schedule-unbounded` — `Schedule.forever`/`Schedule.spaced` without bounding combinator
- `config-secret-without-redacted` — `Config.string("API_TOKEN")` etc. (use `Config.redacted`)
- `return-effect-from-sync` — `Effect.sync(() => Effect.succeed(x))` (`Effect<Effect<...>>`)
- `yield-promise` — `yield* fetch(...)` / `yield* Promise.all(...)` (runtime crash)
- `useless-pipe` — `pipe(x)` with a single argument
- `tryPromise-without-catch` — `Effect.tryPromise(fn)` short form (errors collapse to `UnknownException`)
- `barrel-import-from-effect` — `import { Effect } from "effect"` (mirrors `@effect/eslint-plugin`)
- `array-push-spread` — `arr.push(...xs)` (V8 stack-overflow footgun; mirrors Effect repo's own `no-restricted-syntax`)

**Per-rule docs & examples.** Every emitted `LintIssue` now optionally carries:

- `docsUrl` — link to the most relevant page on `effect.website`
- `example` — `{ bad, good }` copy-pasteable snippet illustrating the fix

URLs verified against the Effect website MDX tree. Renderers (CLI/LSP/HTML) can surface this without per-rule logic.

**Disable pragmas.** The runner honors:

- `// eslint-disable-next-line <rule>` and `// eslint-disable-line <rule>`
- `// effect-analyzer-disable-next-line <rule>` and `// effect-analyzer-disable-line <rule>`
- Bare directives (no rule name) disable all rules on that line
- `no-restricted-syntax` is recognised as an alias for `array-push-spread`

**Scoping & noise reduction.**

- `.tst.ts` (dtslint type-test) files are skipped entirely — their degenerate runtime patterns are type assertions, not code.
- `barrel-import-from-effect` matches the Effect team's own ESLint scope (`packages/*/src/**/*` only — not test files).

**False positives caught during dogfooding on real Effect codebases.** Validated against `effect/packages`, `alchemy-effect`, `t3code`, the EffectPatterns docs, and 10 example/getting-started repos — ~5,000 files. Seven FP categories were found and fixed before release:

| FP | Fix |
| --- | --- |
| `yield-promise` on shadowed `fetch` (local binding) | resolve identifier symbol; skip if locally declared |
| `live-layer-in-test` matching `runLive` / `describeTimeToLive` | require PascalCase; exclude `*TimeToLive` |
| `untagged-throw` inside `Effect.try({ try, catch })` | detect catch field; only flag throws with no handler |
| `schedule-unbounded` inside `Stream.repeat` / `Stream.fromSchedule` / `Stream.tick` | consumer-controlled streams are intentionally unbounded |
| `barrel-import-from-effect` in test files | scope to src files only |
| `array-push-spread` on lines with `// eslint-disable-next-line no-restricted-syntax` | honor disable pragmas |
| `.tst.ts` runtime patterns | skip dtslint files |
