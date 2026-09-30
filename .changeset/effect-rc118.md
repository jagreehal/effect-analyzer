---
"effect-analyzer": minor
---

Support Effect `4.0.0-rc.118` and `@effect/tsgo` `0.46.1`. The `effect` peer range is now `^4.0.0-rc.118`.

- The secret linter, config leak checks and fixes use the PascalCase constructors (`Config.String`, `Config.Redacted`, `Config.Int`). Migration hints point to `effect/http`, `effect/socket` and the other top-level modules.
- Error paths come from each program's error channel, so `catchTag`, `catchTags` and `catch` remove the errors they handle. `yield* new MyError()` counts as a failure for any `Data.TaggedError` subclass.
- Explain lists each `catchTags` handler under its tag.
- `Effect.forEach` and `Effect.all` show their `concurrency` setting, including named constants, in explain and `mermaid-concurrency`.
- Stream programs show both sides of `Stream.merge` and the sink passed to `.pipe`.
- A program built from one `.pipe` chain, loop or Stream pipeline shows by default.
- `-o <file>` writes only that file for a single input. Add `--colocate` to also write the adjacent `.effect-analysis.md`.
