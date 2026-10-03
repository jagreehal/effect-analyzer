---
"effect-analyzer": minor
---

Clearer output for docs, reviews and migrations.

- `explain` prints each program's `Effect<A, E, R>` type, lists services from yielded sub-programs, shows plain-value early returns, and names lifted steps after the call they wrap (`wallet.getBalance`).
- Retry and timeout options resolve to their schedule and duration, and shorthand `{ concurrency }` reads as concurrent.
- Diagrams draw `acquireUseRelease` as acquire, use, release, and a scoped `acquireRelease` releases on scope close. `mermaid-layers` includes layer factories, and `api-docs` reads endpoints that chain `.middleware()`.
- New flags: `--program <name>` renders one program, `--ascii` gives ASCII-only text, and `--enable-rule` turns on opt-in source rules such as `barrel-import-from-effect`.
- `--migration` supports `--format json` and `--format markdown`, and leads with pattern findings: retry loops, timeout races, `Error` subclasses, constructor injection and `try/finally` releases.
- `--diff` accepts a before file without Effect and summarises its migration opportunities against the after file's programs.
- Project reports such as `--error-channel` run on a single file, and human-readable output shows paths relative to the working directory.
